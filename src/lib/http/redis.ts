/**
 * Upstash Redis（REST）への最小限の呼び出し。
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が無い、または遅い・失敗したときは null を返し、
 * 呼び出し側はプロセス内のメモリで代わりに数える。
 */

const REDIS_TIMEOUT_MS = 800;

export function redisConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

/** 複数のコマンドをまとめて送り、各コマンドの結果を返す。失敗時は null */
export async function redisPipeline(commands: string[][]): Promise<unknown[] | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown; error?: string }[];
    if (!Array.isArray(data) || data.some((d) => d?.error)) return null;
    return data.map((d) => d?.result);
  } catch {
    return null;
  }
}
