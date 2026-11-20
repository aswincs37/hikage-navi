"use client";

import type { JourneySearchResult } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import type { SearchParamsState } from "./query";
import { readSaved, saveResult } from "./savedResults";

/**
 * 検索結果の取得と、ブラウザでの保存。
 * - タブ内（sessionStorage）: 直前の1件。詳細ページへの移動時に使う
 * - 端末（localStorage、savedResults.ts）: 直近5件。電波が無いときにも開けるようにする
 */

export type SearchOutcome =
  | { ok: true; result: JourneySearchResult }
  | { ok: false; status: number; code: string; issues?: { field: string; code: string }[] };

const PREFIX = "hikage:search:";
/** 検索の待ち時間の上限。サーバー側の上限（60秒）に、遅い回線での送受信の分を足す */
const SEARCH_TIMEOUT_MS = 75_000;

export function readCached(query: string): JourneySearchResult | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + query);
    return raw ? (JSON.parse(raw) as JourneySearchResult) : null;
  } catch {
    return null;
  }
}

function writeCached(query: string, result: JourneySearchResult) {
  try {
    // 古い検索結果は1件だけ残す（容量節約）
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== PREFIX + query) sessionStorage.removeItem(k);
    }
    sessionStorage.setItem(PREFIX + query, JSON.stringify(result));
  } catch {
    // 容量超過・プライベートモードでは保存しない
  }
}

export async function fetchSearch(query: string, params: SearchParamsState, signal?: AbortSignal): Promise<SearchOutcome> {
  const cached = readCached(query) ?? readSaved(query);
  if (cached) return { ok: true, result: cached };
  let res: Response;
  let result: JourneySearchResult;
  try {
    res = await fetchWithTimeout("/api/v1/journeys/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code: string; issues?: { field: string; code: string }[] } } | null;
      return { ok: false, status: res.status, code: body?.error?.code ?? "unknown", issues: body?.error?.issues };
    }
    result = (await res.json()) as JourneySearchResult;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    // 回線が切れた・弱くて応答が途中で止まった
    return { ok: false, status: 0, code: "network_error" };
  }
  if (result.status === "ok") {
    writeCached(query, result);
    saveResult(query, result);
  }
  return { ok: true, result };
}
