import { redisPipeline } from "./redis";

/**
 * 無料の公開サービス（Nominatim・Overpass・Open-Meteo 無料版など）への呼び出し回数を、
 * サイト全体で各サービスの利用規約の範囲内に抑える。
 *
 * - Upstash Redis が設定されていれば、全サーバーインスタンス共通で数える
 *   （Vercel などのサーバーレスでは、インスタンスごとに数えると合計で上限を超えるため）
 * - 無い・失敗したときは、このプロセス内だけで数える（以前と同じ動き）
 * - 自前のサーバー（別のホスト名）を設定した場合は対象外（制限しない）
 *
 * 上限に達したら外部へ送らずに PublicServiceBusyError を投げ、画面では「一時的に使えません」として扱う。
 */
export interface ServicePolicy {
  /** 連続する呼び出しの最小間隔（ミリ秒）。全インスタンス合計 */
  minIntervalMs?: number;
  /** 間隔待ちで待てる最大時間（ミリ秒）。超えたら諦める */
  maxWaitMs?: number;
  perMinute?: number;
  perHour?: number;
  perDay?: number;
}

/**
 * ホスト名ごとの方針。数値は各サービスの公開ポリシーより少し低めにしてある。
 * - Nominatim: 1秒に1回まで（https://operations.osmfoundation.org/policies/nominatim/）
 * - Overpass (overpass-api.de): 1日1万回未満
 * - Open-Meteo 無料版: 1分600回・1時間5,000回・1日1万回まで、非商用のみ
 * - Photon・FOSSGIS OSRM: 明確な数値は無く「節度ある利用」。念のため1分あたりの上限だけ設ける
 */
export const PUBLIC_SERVICE_POLICIES: Record<string, ServicePolicy> = {
  "nominatim.openstreetmap.org": { minIntervalMs: 1100, maxWaitMs: 4000 },
  "overpass-api.de": { minIntervalMs: 1000, maxWaitMs: 6000, perDay: 9000 },
  "api.open-meteo.com": { perMinute: 500, perHour: 4500, perDay: 9000 },
  "photon.komoot.io": { perMinute: 120 },
  "routing.openstreetmap.de": { perMinute: 120 },
};

export class PublicServiceBusyError extends Error {
  constructor(public readonly host: string) {
    super(`public service limit reached: ${host}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ プロセス内の代替
const localNextSlot = new Map<string, number>();
const localCounts = new Map<string, number>();

function localTakeSlot(host: string, interval: number, now: number): number {
  const next = Math.max(localNextSlot.get(host) ?? 0, now);
  localNextSlot.set(host, next + interval);
  return next - now;
}

function localCount(key: string): number {
  if (localCounts.size > 1000) localCounts.clear();
  const n = (localCounts.get(key) ?? 0) + 1;
  localCounts.set(key, n);
  return n;
}

// ------------------------------------------------------------ 本体

/** 回数の上限（分・時・日）を確認し、超えていたら投げる */
async function checkBudgets(host: string, p: ServicePolicy, now: number): Promise<void> {
  const all: [tag: string, size: number, limit: number | undefined][] = [
    ["m", 60_000, p.perMinute],
    ["h", 3_600_000, p.perHour],
    ["d", 86_400_000, p.perDay],
  ];
  const windows = all.filter((w): w is [string, number, number] => typeof w[2] === "number");
  if (windows.length === 0) return;

  const keys = windows.map(([tag, size]) => `hikage:svc:${host}:${tag}:${Math.floor(now / size)}`);
  const commands = windows.flatMap(([, size], i) => [
    ["INCR", keys[i]!],
    ["PEXPIRE", keys[i]!, String(size + 60_000)],
  ]);
  const shared = await redisPipeline(commands);
  const counts = shared ? windows.map((_, i) => Number(shared[i * 2])) : keys.map((k) => localCount(k));
  if (counts.some((n, i) => !Number.isFinite(n) || n > windows[i]![2])) throw new PublicServiceBusyError(host);
}

/** 最小間隔を守る。全インスタンスで1回ずつ順番を取り、自分の番まで待つ */
async function waitForSlot(host: string, p: ServicePolicy, now: number): Promise<void> {
  const interval = p.minIntervalMs;
  if (!interval) return;
  const maxWait = p.maxWaitMs ?? 3000;
  // 次に空いている時刻を Redis 上で1回の操作（Lua）で予約する。同時に来ても同じ番は取らない。
  // 待ち時間が長すぎるときは予約せずに -1 を返す（諦めた呼び出しが後ろの人の順番を遅らせないように）
  const shared = await redisPipeline([["EVAL", SLOT_SCRIPT, "1", `hikage:svc:${host}:slot`, String(now), String(interval), String(maxWait)]]);
  const reserved = shared ? Number(shared[0]) : NaN;
  let wait: number;
  if (Number.isFinite(reserved)) {
    if (reserved < 0) throw new PublicServiceBusyError(host);
    wait = reserved - now;
  } else {
    const next = Math.max(localNextSlot.get(host) ?? 0, now);
    if (next - now > maxWait) throw new PublicServiceBusyError(host);
    wait = localTakeSlot(host, interval, now);
  }
  if (wait > 0) await sleep(wait);
}

/** KEYS[1]=順番のキー, ARGV = now, interval, maxWait。自分の番の時刻（ミリ秒）か -1 を返す */
const SLOT_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local now = tonumber(ARGV[1])
local base = math.max(cur, now)
if base - now > tonumber(ARGV[3]) then return -1 end
redis.call('SET', KEYS[1], tostring(base + tonumber(ARGV[2])), 'PX', 60000)
return base`;

/**
 * 外部へ送る直前に呼ぶ。対象外のホストなら何もしない。
 * 上限に達している・待ち時間が長すぎる場合は PublicServiceBusyError。
 */
export async function passPublicServiceGate(url: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  const policy = PUBLIC_SERVICE_POLICIES[host];
  if (!policy) return;
  const now = Date.now();
  await checkBudgets(host, policy, now);
  await waitForSlot(host, policy, now);
}
