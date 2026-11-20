/**
 * サーバーのメモリ上だけの短時間キャッシュ（ディスク・データベースには書かない）。
 * - 同じ検索（共有されたリンクを開いた場合など）をすぐ返し、外部の無料サーバーへの問い合わせを減らす
 * - 同じキーの計算が実行中なら、その結果を待つ（同時に開かれても外部へは1回だけ問い合わせる）
 * - 上限件数を超えたら古いものから捨てる
 * サーバーが複数台の場合は、それぞれが別々に持つ（効果は減るが、結果は正しい）。
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string, now = Date.now()): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // 最近使ったものを末尾へ（古いものから捨てるため）
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs, now = Date.now()) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * キャッシュにあればそれを、無ければ `create` を実行して返す。
   * `keep(value)` が false の結果（外部サービスの一時的な失敗を含む結果など）は保存しない。
   */
  async getOrCreate(key: string, create: () => Promise<V>, keep: (value: V) => boolean = () => true): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = create()
      .then((value) => {
        if (keep(value)) this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  get size() {
    return this.entries.size;
  }
}
