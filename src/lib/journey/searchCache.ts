import "server-only";
import type { JourneySearchResult } from "@/lib/domain/types";
import { TtlCache } from "@/lib/http/memoCache";
import type { JourneyRequest } from "@/lib/validation/schemas";

/**
 * 同じ条件の検索結果をサーバーのメモリ上に30分だけ持つ（ディスク・データベースには保存しない）。
 * 共有されたリンクを開いた人は、検索をやり直さずにすぐ結果を見られる
 * （リンクには出発時刻まで含まれるので、結果は同じになる）。
 */
export const SEARCH_CACHE_MINUTES = 30;
export const searchCache = new TtlCache<JourneySearchResult>(100, SEARCH_CACHE_MINUTES * 60_000);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function searchCacheKey(r: JourneyRequest): string {
  return JSON.stringify([
    round6(r.origin.lat),
    round6(r.origin.lon),
    r.origin.label ?? "",
    round6(r.destination.lat),
    round6(r.destination.lon),
    r.destination.label ?? "",
    r.departure.toISOString(),
    r.mode,
    [...r.preferences].sort(),
  ]);
}

/** 外部サービスの一時的な失敗を含む結果は保存しない（次に開いた人には取り直す） */
export const worthKeeping = (r: JourneySearchResult) => r.status === "ok" && !r.notices.some((n) => n.status === "unavailable");
