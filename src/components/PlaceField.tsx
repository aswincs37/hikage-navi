"use client";

import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Place } from "@/lib/domain/types";
import { useI18n } from "@/lib/i18n/client";
import { LocateIcon } from "./icons";

interface Candidate extends Place {
  label: string;
  category?: string;
  detail?: string;
}

interface Props {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  allowCurrentLocation?: boolean;
  error?: string;
  iconType?: "origin" | "destination";
}

/** 入力が止まってから候補を取りに行くまでの時間と最小文字数（打鍵ごとに外部APIを呼ばない） */
const SUGGEST_DELAY_MS = 300;
const SUGGEST_MIN_CHARS = 2;

interface Result {
  /** どの入力に対する結果か。入力が変わったら古い結果は表示しない */
  q: string;
  kind: "suggest" | "full";
  items: Candidate[];
}

/**
 * 地名・住所の入力欄。入力に合わせて候補（Photon の地名・駅・施設と国土地理院の住所）を表示し、ユーザーが選ぶ。
 * 駅・施設名（Nominatim）は利用規約上入力補完に使えないため、Enter か「駅・施設も検索」で検索する。
 * 現在地はボタンを押したときだけブラウザに要求する。
 */
export function PlaceField({ label, placeholder, value, onChange, allowCurrentLocation, error, iconType }: Props) {
  const id = useId();
  const { m, locale } = useI18n();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "locating" | "locate_error">("idle");
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 選択済みの欄をタップすると、その地名を入れた入力欄に戻す（選び直すまで元の選択は保つ）
  const [editing, setEditing] = useState(false);
  const q = text.trim();
  const selectedLabel = value ? (value.label ?? `${value.lat}, ${value.lon}`) : "";

  // iOS はユーザー操作の中でしかキーボードを開かないため、描画直後（layout effect）にフォーカスする
  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startEditing() {
    setText(selectedLabel);
    setResult(null);
    setEditing(true);
  }

  /** 選び直さずに離れたら、元の選択に戻す */
  function stopEditing() {
    abortRef.current?.abort();
    setEditing(false);
    setText("");
    setResult(null);
    setStatus("idle");
    setSuggesting(null);
  }

  // 入力が止まったら候補を取得する。候補は補助機能なので、失敗しても何も表示しない
  useEffect(() => {
    if ((value && !editing) || q.length < SUGGEST_MIN_CHARS) return;
    // タップした直後（選択中の地名のまま）は候補を出さない
    if (editing && q === selectedLabel) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = ctrl;
      setSuggesting(q);
      try {
        const res = await fetchWithTimeout(`/api/v1/geocode?q=${encodeURIComponent(q)}&mode=suggest&lang=${locale}`, { signal: ctrl.signal, timeoutMs: 10_000 });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: Candidate[] };
        // 同じ入力で Enter の検索結果が先に出ていたら、そちらを優先する
        setResult((prev) => (prev?.q === q && prev.kind === "full" ? prev : { q, kind: "suggest", items: data.results }));
      } catch {
        // 通信エラーは表示しない（Enter／「駅・施設も検索」ではエラーを表示する）
      } finally {
        if (!ctrl.signal.aborted) setSuggesting(null);
      }
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, value, editing, selectedLabel, locale]);

  async function search() {
    if (!q) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    try {
      const res = await fetchWithTimeout(`/api/v1/geocode?q=${encodeURIComponent(q)}&lang=${locale}`, { signal: ctrl.signal, timeoutMs: 20_000 });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { results: Candidate[] };
      setResult({ q, kind: "full", items: data.results });
      setStatus("idle");
    } catch {
      if (!ctrl.signal.aborted) setStatus("error");
    }
  }

  function pick(c: Candidate) {
    abortRef.current?.abort();
    onChange({ lat: c.lat, lon: c.lon, label: c.label });
    setResult(null);
    setText("");
    setStatus("idle");
    setSuggesting(null);
    setEditing(false);
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setStatus("locate_error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("idle");
        setEditing(false);
        setText("");
        onChange({
          lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
          lon: Math.round(pos.coords.longitude * 1e5) / 1e5,
          label: m.form.currentLocation,
        });
      },
      () => setStatus("locate_error"),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  const errorId = `${id}-error`;
  const listId = `${id}-list`;
  const shown = result && result.q === q ? result : null;
  const busy = status === "loading" || (suggesting !== null && suggesting === q);

  if (value && !editing) {
    return (
      <div className="space-y-1.5">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
          {iconType === "origin" && <span className="h-2.5 w-2.5 rounded-sm bg-shade" aria-hidden="true" />}
          {iconType === "destination" && <span className="h-2.5 w-2.5 rounded-sm bg-ai" aria-hidden="true" />}
          {label}
        </span>
        <button
          type="button"
          onClick={startEditing}
          aria-label={`${label}: ${selectedLabel}（${m.form.changeField(label)}）`}
          className="flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-ai active:bg-ai-light"
        >
          <PinIcon className="h-4 w-4 shrink-0 text-ai" />
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{selectedLabel}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="space-y-1.5"
      onBlur={(e) => {
        if (!editing || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        // 候補をタップしたときは blur の後に click が来るため、少し待ってから戻す
        const el = e.currentTarget;
        setTimeout(() => {
          if (!el.contains(document.activeElement)) stopEditing();
        }, 250);
      }}
    >
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-bold text-ink">
        {iconType === "origin" && <span className="h-2.5 w-2.5 rounded-sm bg-shade" aria-hidden="true" />}
        {iconType === "destination" && <span className="h-2.5 w-2.5 rounded-sm bg-ai" aria-hidden="true" />}
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted" aria-hidden="true">
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ai/25 border-t-ai" /> : <SearchIcon />}
        </span>
        <input
          suppressHydrationWarning
          id={id}
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editing) {
              e.preventDefault();
              stopEditing();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-controls={q ? listId : undefined}
          className="min-h-12 w-full rounded-lg border border-line bg-surface py-2.5 pr-3.5 pl-10 text-base transition-colors placeholder:text-muted/60 hover:border-line/80 focus:border-ai focus:ring-2 focus:ring-ai/15"
          maxLength={100}
        />
      </div>
      {q && !(editing && q === selectedLabel) && (
        <div id={listId} className="overflow-hidden rounded-lg border border-line bg-surface shadow-md">
          {shown && shown.items.length > 0 && (
            <ul aria-label={m.form.selectCandidate} className="divide-y divide-line/60">
              {shown.items.map((c, i) => (
                <li key={`${c.lat},${c.lon},${i}`}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    aria-label={[c.label, c.detail, c.category === "station" ? m.form.station : null].filter(Boolean).join("、")}
                    className="flex min-h-12 w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/80 active:bg-surface-2"
                  >
                    <PinIcon className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        <Highlight text={c.label} query={q} />
                      </span>
                      {c.detail && <span className="block truncate text-xs text-muted">{c.detail}</span>}
                    </span>
                    {c.category === "station" && (
                      <span className="shrink-0 rounded-full bg-ai/10 px-2 py-0.5 text-[11px] font-semibold text-ai">{m.form.station}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shown?.kind === "full" && shown.items.length === 0 && <p className="px-3.5 py-3 text-xs text-muted">{m.form.noCandidates}</p>}
          {shown?.kind !== "full" && (
            <button
              type="button"
              onClick={() => void search()}
              disabled={status === "loading"}
              className={`flex min-h-12 w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm font-semibold text-ai transition-colors hover:bg-info-bg/60 active:bg-info-bg disabled:opacity-60 ${
                shown && shown.items.length > 0 ? "border-t border-line/60" : ""
              }`}
            >
              <SearchIcon />
              <span className="min-w-0 flex-1 truncate">{status === "loading" ? m.form.searching : m.form.searchMore(q)}</span>
            </button>
          )}
        </div>
      )}
      {allowCurrentLocation && !q && (
        <button
          type="button"
          onClick={locate}
          disabled={status === "locating"}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ai transition-colors hover:border-ai hover:bg-ai-light"
        >
          <LocateIcon />
          <span>{status === "locating" ? m.form.locating : m.form.useCurrentLocation}</span>
        </button>
      )}
      <div aria-live="polite">
        {status === "error" && <p className="rounded-lg bg-danger-bg/50 px-3 py-2 text-xs font-medium text-danger">{m.form.geocodeError}</p>}
        {status === "locate_error" && (
          <p className="rounded-lg bg-danger-bg/50 px-3 py-2 text-xs font-medium text-danger">{m.form.locationDenied}</p>
        )}
        {shown && <span className="sr-only">{m.form.candidateCount(shown.items.length)}</span>}
      </div>
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-xs font-semibold text-danger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PinIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** 候補の中で入力と一致する部分を太字にする（一致しなければそのまま表示） */
function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-ai">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}
