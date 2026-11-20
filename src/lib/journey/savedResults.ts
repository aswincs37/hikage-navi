import type { JourneySearchResult } from "@/lib/domain/types";

/**
 * 直近の検索結果を、この端末のブラウザ（localStorage）にだけ保存する。サーバーには送らない。
 * 電波が無い場所（地下・山間部・機内など）でも、保存した結果と座席の答えを開けるようにするため。
 *
 * 「現在地」から調べた結果は、位置情報を残さない方針のため保存しない（タブ内の一時保存のみ）。
 * 「履歴を消す」で、最近の検索と一緒に消える。
 */

export interface SavedResult {
  /** 結果ページのクエリ（/search?… の … 部分） */
  query: string;
  savedAt: number;
  result: JourneySearchResult;
}

export interface SavedSummary {
  query: string;
  savedAt: number;
  origin: string;
  destination: string;
  mode: JourneySearchResult["request"]["mode"];
  departure: string;
}

const KEY = "hikage-navi:saved-results";
const MAX = 5;
const EVENT = "hikage-navi:saved-change";

/** 「現在地」の表示名（日本語・英語）。この出発地の結果は端末に残さない */
const CURRENT_LOCATION_LABELS = ["現在地", "Current location"];

export function isCurrentLocationLabel(label: string | undefined): boolean {
  return !!label && CURRENT_LOCATION_LABELS.includes(label);
}

function readAll(): SavedResult[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is SavedResult =>
        !!e && typeof e.query === "string" && typeof e.savedAt === "number" && !!e.result && Array.isArray(e.result.routes),
    );
  } catch {
    return [];
  }
}

function writeAll(list: SavedResult[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 容量が足りなければ古いものを減らしてもう一度
    if (list.length > 1) return writeAll(list.slice(0, list.length - 1));
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // テスト環境など
  }
}

export function readSaved(query: string): JourneySearchResult | null {
  return readAll().find((e) => e.query === query)?.result ?? null;
}

export function saveResult(query: string, result: JourneySearchResult) {
  if (isCurrentLocationLabel(result.request.origin.label)) return;
  const rest = readAll().filter((e) => e.query !== query);
  writeAll([{ query, savedAt: Date.now(), result }, ...rest].slice(0, MAX));
}

export function listSaved(): SavedSummary[] {
  return readAll().map((e) => ({
    query: e.query,
    savedAt: e.savedAt,
    origin: e.result.request.origin.label ?? "",
    destination: e.result.request.destination.label ?? "",
    mode: e.result.request.mode,
    departure: e.result.request.departure,
  }));
}

export function clearSaved() {
  writeAll([]);
}

export function subscribeSaved(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
