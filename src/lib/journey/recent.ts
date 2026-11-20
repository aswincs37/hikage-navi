import { useSyncExternalStore } from "react";
import { clearSaved } from "./savedResults";
import { TRANSPORT_MODES, type Place, type TransportMode } from "@/lib/domain/types";

/**
 * 最近の検索（この端末のブラウザにだけ保存。サーバーには送らない）。
 * 現在地は「位置情報を保存しない」方針のため座標を残さず、目的地だけを記録する（origin: null）。
 */
export interface RecentTrip {
  origin: Place | null;
  destination: Place;
  mode: TransportMode;
  at: number;
}

const KEY = "hikage-michi:recent-trips";
const MAX = 6;
const EVENT = "hikage-michi:recent-change";

const samePlace = (a: Place | null, b: Place | null) =>
  a === b || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4);

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseRecent(raw: string): RecentTrip[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const ok = (p: unknown): p is Place =>
      !!p && typeof p === "object" && Number.isFinite((p as Place).lat) && Number.isFinite((p as Place).lon);
    return data
      .filter((t): t is RecentTrip => !!t && ok(t.destination) && (t.origin === null || ok(t.origin)) && (TRANSPORT_MODES as readonly string[]).includes(t.mode))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** 新しい検索を先頭に追加する（同じ出発地・目的地の組は1つにまとめる） */
export function addRecent(list: RecentTrip[], trip: RecentTrip): RecentTrip[] {
  const rest = list.filter((t) => !(samePlace(t.origin, trip.origin) && samePlace(t.destination, trip.destination)));
  return [trip, ...rest].slice(0, MAX);
}

function write(list: RecentTrip[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // プライベートモードなどで保存できなくても、検索自体は続ける
  }
}

export function saveRecent(origin: Place, destination: Place, mode: TransportMode, isCurrentLocation: boolean) {
  const trip: RecentTrip = {
    origin: isCurrentLocation ? null : origin,
    destination,
    mode,
    at: Date.now(),
  };
  write(addRecent(parseRecent(readRaw()), trip));
}

export function clearRecent() {
  write([]);
  // 端末に保存した検索結果も一緒に消す
  clearSaved();
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

let cache: { raw: string; list: RecentTrip[] } = { raw: "", list: [] };
function snapshot(): RecentTrip[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, list: parseRecent(raw) };
  return cache.list;
}
const EMPTY: RecentTrip[] = [];

/** サーバー描画時は空（履歴はブラウザにしかない）。表示後に読み込まれる */
export function useRecentTrips(): RecentTrip[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
