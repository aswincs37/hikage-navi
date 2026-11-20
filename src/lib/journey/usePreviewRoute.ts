"use client";

import { useEffect, useState } from "react";
import type { Place, TransportMode } from "@/lib/domain/types";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import type { JourneyPreview } from "./preview";

/**
 * 検索前の地図に描く実際の道のり（道路または線路）を取得する。
 * - 入力が落ち着いてから（0.6秒後）取得する
 * - 同じ組み合わせは再取得しない（タブを開いている間は sessionStorage にも残す。
 *   さらに応答はブラウザのキャッシュとサーバーのメモリにも残る）
 * - 道路の形は時刻で変わらないので、車は時刻をキーに含めない。電車は選んだ出発時刻で調べる
 * 取得できない間（読み込み中・失敗）は null を返し、地図は直線の点線を表示する。
 */

const STORE_KEY = "hikage:preview";
const MAX_STORED = 30;
const DEBOUNCE_MS = 600;
const TIMEOUT_MS = 20_000;

const memory = new Map<string, JourneyPreview | null>();
let loadedFromStore = false;

function loadStore() {
  if (loadedFromStore) return;
  loadedFromStore = true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as [string, JourneyPreview | null][]) : [];
    for (const [k, v] of list) memory.set(k, v);
  } catch {
    // 読めなければ使わない
  }
}

function remember(key: string, value: JourneyPreview | null) {
  memory.set(key, value);
  while (memory.size > MAX_STORED) memory.delete(memory.keys().next().value!);
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify([...memory]));
  } catch {
    // 容量超過・プライベートモードではメモリ上だけで持つ
  }
}

const usesTimetable = (mode: TransportMode) => mode !== "car";

export function previewQuery(o: Place, d: Place, mode: TransportMode, departure: string): string {
  const q = new URLSearchParams({
    olat: o.lat.toFixed(5),
    olon: o.lon.toFixed(5),
    dlat: d.lat.toFixed(5),
    dlon: d.lon.toFixed(5),
    m: mode,
    // 車は時刻に関係なく同じ形なので、キャッシュが効くよう時刻を固定値（日付だけ）にする
    t: usesTimetable(mode) ? departure : `${departure.slice(0, 10)}T12:00`,
  });
  return q.toString();
}

/**
 * @param departure 出発日時（"YYYY-MM-DDTHH:mm"）。電車の経路はこの時刻で調べる
 */
export function usePreviewRoute(origin: Place | null, destination: Place | null, mode: TransportMode, departure: string, enabled = true) {
  const query = enabled && origin && destination ? previewQuery(origin, destination, mode, departure) : null;
  // 車は日付が変わっても同じ形なので、覚えておくキーからは日付も外す
  const key = query && !usesTimetable(mode) ? query.replace(/&t=[^&]*/, "") : query;
  const [state, setState] = useState<{ key: string; preview: JourneyPreview | null } | null>(null);

  useEffect(() => {
    if (!query || !key) return;
    loadStore();
    const known = memory.has(key);
    const ctrl = new AbortController();
    // 覚えている区間はすぐ（待ち時間なしで）表示する
    const timer = setTimeout(async () => {
      if (memory.has(key)) {
        setState({ key, preview: memory.get(key) ?? null });
        return;
      }
      try {
        const res = await fetchWithTimeout(`/api/v1/journeys/preview?${query}`, { signal: ctrl.signal, timeoutMs: TIMEOUT_MS });
        const preview = res.ok ? ((await res.json()) as JourneyPreview) : null;
        // 経路が無い・入力エラーは覚えておく（サーバーの一時的な失敗は次回もう一度試す）
        if (res.ok || res.status === 400 || res.status === 404) remember(key, preview);
        setState({ key, preview });
      } catch {
        // 中断・時間切れ・通信失敗: 直線のままにする
      }
    }, known ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // query が同じなら origin / destination / mode / departure も同じ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!key) return null;
  return state?.key === key ? state.preview : null;
}
