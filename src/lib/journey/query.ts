import { PREFERENCES, TRANSPORT_MODES, type Place, type Preference, type TransportMode } from "@/lib/domain/types";
import { toTokyoLocalString } from "@/lib/time/tokyo";

/**
 * 検索条件と URL クエリの相互変換。検索結果はサーバーに保存せず、URL だけで再現できるようにする。
 */

export interface SearchParamsState {
  origin: Place;
  destination: Place;
  /** 日本時間 "YYYY-MM-DDTHH:mm" */
  departure: string;
  mode: TransportMode;
  preferences: Preference[];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function toQuery(s: SearchParamsState): string {
  const q = new URLSearchParams({
    olat: String(round6(s.origin.lat)),
    olon: String(round6(s.origin.lon)),
    dlat: String(round6(s.destination.lat)),
    dlon: String(round6(s.destination.lon)),
    t: s.departure,
    m: s.mode,
  });
  if (s.origin.label) q.set("ol", s.origin.label);
  if (s.destination.label) q.set("dl", s.destination.label);
  if (s.preferences.length) q.set("p", s.preferences.join(","));
  return q.toString();
}

export function fromQuery(q: URLSearchParams): SearchParamsState | null {
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v.trim() === "") return NaN;
    return Number(v);
  };
  const origin = { lat: num("olat"), lon: num("olon"), label: q.get("ol") ?? undefined };
  const destination = { lat: num("dlat"), lon: num("dlon"), label: q.get("dl") ?? undefined };
  const mode = q.get("m") as TransportMode;
  const departure = q.get("t") ?? "";
  if (![origin.lat, origin.lon, destination.lat, destination.lon].every(Number.isFinite)) return null;
  if (!TRANSPORT_MODES.includes(mode) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departure)) return null;
  const preferences = (q.get("p") ?? "")
    .split(",")
    .filter((p): p is Preference => (PREFERENCES as readonly string[]).includes(p));
  return { origin, destination, departure, mode, preferences };
}

/** 現在の日本時間（分単位、丸めない）の "YYYY-MM-DDTHH:mm" */
export function defaultDeparture(now: Date = new Date()): string {
  return toTokyoLocalString(now).slice(0, 16);
}
