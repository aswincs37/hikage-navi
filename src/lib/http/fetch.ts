/**
 * 外部プロバイダー呼び出しの共通処理（タイムアウト・User-Agent・エラー分類）。
 * 位置情報を含む URL はログに出さない。
 */

export class ProviderError extends Error {
  constructor(
    public readonly kind: "timeout" | "http" | "network" | "parse",
    public readonly provider: string,
    public readonly status?: number,
  ) {
    super(`${provider}: ${kind}${status ? ` ${status}` : ""}`);
  }
}

export interface FetchOptions {
  provider: string;
  timeoutMs: number;
  userAgent: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export async function fetchText(url: string, opts: FetchOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers: { "User-Agent": opts.userAgent, Accept: "*/*", ...opts.headers },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (controller.signal.aborted) throw new ProviderError("timeout", opts.provider);
    void e;
    throw new ProviderError("network", opts.provider);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ProviderError("http", opts.provider, res.status);
  return res.text();
}

export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError("parse", opts.provider);
  }
}

/** 一定時間だけ値を保持する簡易キャッシュ（プロセス内のみ。サーバーレスでは各インスタンスごと） */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expires: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value);
    return value;
  }
}
