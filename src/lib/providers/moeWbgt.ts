import type { Endpoint } from "@/lib/config/env";
import { available, unavailable, type Maybe, type WbgtLevel, type WbgtSample } from "@/lib/domain/types";
import { haversineM } from "@/lib/geo/geometry";
import { fetchJson, fetchText, TtlCache } from "@/lib/http/fetch";
import { toTokyoIso } from "@/lib/time/tokyo";
import type { WeatherQueryPoint } from "./types";

/**
 * 環境省「熱中症予防情報サイト」の暑さ指数（WBGT）予測値 CSV アダプター。
 *
 * CSV 形式（yohou_all.csv）:
 *   1行目: ",,YYYYMMDDHH,YYYYMMDDHH,..."  3時間ごとの予測対象時刻（HH は 03〜24）
 *   2行目以降: "地点番号,発表日時(YYYY/MM/DD HH:MM),値×10,値×10,..."
 * 地点番号は気象庁アメダス地点番号と同じ体系のため、地点の緯度経度は気象庁の地点表から引く。
 *
 * 情報提供は例年4月下旬〜10月下旬の期間のみ。期間外はファイルが更新されないため、
 * 発表日時が古いデータは「期間外または未更新」として使わない。
 * 温度・湿度からWBGTを独自計算することはしない。
 */

export interface WbgtStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface WbgtForecastTable {
  issuedAt: Date | null;
  times: Date[];
  values: Map<string, (number | null)[]>;
}

/** 発表からこの時間を超えたデータは使わない */
const MAX_AGE_HOURS = 36;
/** 予測対象時刻（3時間ごと）から何分以内なら対応付けるか */
const MAX_ALIGN_MIN = 90;

const tableCache = new TtlCache<WbgtForecastTable>(30 * 60 * 1000, 4);
const stationCache = new TtlCache<WbgtStation[]>(24 * 60 * 60 * 1000, 2);

/** 環境省「日常生活に関する指針」の区分 */
export function wbgtLevel(wbgt: number): WbgtLevel {
  if (wbgt >= 31) return "danger";
  if (wbgt >= 28) return "severe_warning";
  if (wbgt >= 25) return "warning";
  if (wbgt >= 21) return "caution";
  return "almost_safe";
}

export function parseWbgtForecastCsv(csv: string): WbgtForecastTable {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",") ?? [];
  const times = header.slice(2).map((h) => parseSlot(h.trim()));
  const values = new Map<string, (number | null)[]>();
  let issuedAt: Date | null = null;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const id = cols[0]?.trim();
    if (!id || !/^\d{5}$/.test(id)) continue;
    const issued = parseIssued(cols[1]?.trim() ?? "");
    if (issued && (!issuedAt || issued > issuedAt)) issuedAt = issued;
    values.set(
      id,
      cols.slice(2).map((c) => {
        const t = c.trim();
        if (t === "") return null;
        const n = Number(t);
        return Number.isFinite(n) ? n / 10 : null;
      }),
    );
  }
  return { issuedAt, times: times.filter((t): t is Date => t !== null), values };
}

function parseSlot(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const base = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
  return Number.isNaN(base.getTime()) ? null : new Date(base.getTime() + Number(m[4]) * 3_600_000);
}

function parseIssued(s: string): Date | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 気象庁 amedastable.json（緯度経度は [度, 分]） */
export function parseAmedasTable(json: Record<string, { lat: [number, number]; lon: [number, number]; kjName: string }>): WbgtStation[] {
  return Object.entries(json)
    .filter(([, v]) => Array.isArray(v.lat) && Array.isArray(v.lon))
    .map(([id, v]) => ({ id, name: v.kjName, lat: v.lat[0] + v.lat[1] / 60, lon: v.lon[0] + v.lon[1] / 60 }));
}

export function lookupWbgt(
  table: WbgtForecastTable,
  stations: WbgtStation[],
  points: WeatherQueryPoint[],
  now: Date,
  maxStationKm: number,
): Maybe<(WbgtSample | null)[]> {
  if (!table.issuedAt) return unavailable("provider_error", "no_issue_time");
  if (now.getTime() - table.issuedAt.getTime() > MAX_AGE_HOURS * 3_600_000) {
    return unavailable("out_of_season", toTokyoIso(table.issuedAt));
  }
  const withData = stations.filter((s) => table.values.has(s.id));
  const source = {
    provider: "moe-wbgt",
    kind: "official_forecast" as const,
    issuedAt: toTokyoIso(table.issuedAt),
    retrievedAt: now.toISOString(),
    attribution: "環境省 熱中症予防情報サイト（暑さ指数予測値）",
  };

  const samples = points.map((p): WbgtSample | null => {
    let nearest: WbgtStation | null = null;
    let nearestKm = Infinity;
    for (const s of withData) {
      const km = haversineM([p.lon, p.lat], [s.lon, s.lat]) / 1000;
      if (km < nearestKm) {
        nearestKm = km;
        nearest = s;
      }
    }
    if (!nearest || nearestKm > maxStationKm) return null;
    let slot = -1;
    let slotDiff = Infinity;
    table.times.forEach((t, i) => {
      const d = Math.abs(t.getTime() - p.time.getTime());
      if (d < slotDiff) {
        slotDiff = d;
        slot = i;
      }
    });
    if (slot < 0 || slotDiff > MAX_ALIGN_MIN * 60_000) return null;
    const v = table.values.get(nearest.id)?.[slot];
    if (v === null || v === undefined) return null;
    return {
      stationId: nearest.id,
      stationName: nearest.name,
      distanceKm: Math.round(nearestKm * 10) / 10,
      validTime: toTokyoIso(table.times[slot]!),
      wbgt: v,
      level: wbgtLevel(v),
      source,
    };
  });
  if (samples.every((s) => s === null)) return unavailable("out_of_range", "no_station_or_time");
  return available(samples, source);
}

export class MoeWbgtProvider {
  readonly id = "moe-wbgt";
  constructor(
    private readonly forecastEndpoint: Endpoint,
    private readonly stationEndpoint: Endpoint,
    private readonly maxStationKm: number,
    private readonly http: { timeoutMs: number; userAgent: string },
  ) {}

  async forecast(points: WeatherQueryPoint[]): Promise<Maybe<(WbgtSample | null)[]>> {
    const [table, stations] = await Promise.all([
      tableCache.getOrLoad(this.forecastEndpoint.url, async () =>
        // CSV は ASCII のみ（数字・記号）なので文字コード変換は不要
        parseWbgtForecastCsv(await fetchText(this.forecastEndpoint.url, { provider: this.id, ...this.http })),
      ),
      stationCache.getOrLoad(this.stationEndpoint.url, async () =>
        parseAmedasTable(await fetchJson(this.stationEndpoint.url, { provider: "jma-amedas-table", ...this.http })),
      ),
    ]);
    return lookupWbgt(table, stations, points, new Date(), this.maxStationKm);
  }
}
