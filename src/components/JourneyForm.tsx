
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Place, Preference, TransportMode } from "@/lib/domain/types";
import { defaultDeparture, toQuery, type SearchParamsState } from "@/lib/journey/query";
import { useI18n } from "@/lib/i18n/client";
import { clearRecent, saveRecent, useRecentTrips, type RecentTrip } from "@/lib/journey/recent";
import { haversineM } from "@/lib/geo/geometry";
import { usePreviewRoute } from "@/lib/journey/usePreviewRoute";
import type { MapRoute } from "./RouteMap";
import { ModeIcon } from "./icons";
import { MapOnDemand } from "./MapOnDemand";
import { PlaceField } from "./PlaceField";

/**
 * フォームで選べる移動手段は道路と電車のみ。「car」は道路経路として車・バス・タクシーなど道路を走る乗り物すべてに使う。
 * 時刻表が必要な「bus」（路線バス）はフォームに出さない（エンジン・API では引き続き対応）。徒歩・自転車は対象外。
 */
const FORM_MODES: readonly TransportMode[] = ["car", "train"];
const TRANSIT_MODES: readonly TransportMode[] = ["train", "bus"];
/** 移動手段ごとに順位へ反映できる希望条件（道路は屋外・徒歩がないため所要時間のみで並べる） */
const MODE_PREFERENCES: Partial<Record<TransportMode, readonly Preference[]>> = {
  train: ["minimise_time", "minimise_sun", "minimise_outdoor", "reduce_walking", "fewer_transfers"],
};

/** 定番ルートの座標。地名は表示言語の文言（m.home.presets、同じ順）から付ける */
const PRESET_ROUTES: { icon: string; origin: Place; destination: Place }[] = [
  { icon: "🌊", origin: { lat: 35.6812, lon: 139.7671 }, destination: { lat: 35.4658, lon: 139.6223 } },
  { icon: "✈️", origin: { lat: 35.6896, lon: 139.7006 }, destination: { lat: 35.5494, lon: 139.7798 } },
  { icon: "🏯", origin: { lat: 35.1709, lon: 136.8815 }, destination: { lat: 34.9858, lon: 135.7588 } },
  { icon: "🛫", origin: { lat: 34.7025, lon: 135.4959 }, destination: { lat: 34.4347, lon: 135.244 } },
];

/** 道のりを取得するまでは、地図に出発地・目的地と直線（点線）だけを示す */
const NO_ROUTES: MapRoute[] = [];
const PREVIEW_ID = "preview";

interface Props {
  initial?: Partial<SearchParamsState>;
  /** 地図プレビューを表示するか（テストでは無効にする） */
  showMap?: boolean;
  /** 電車・バスの時刻表データが設定されているか（未設定なら「準備中」として選べなくする） */
  transitAvailable?: boolean;
}

/** 「今すぐ」で検索したときの時刻（＝検索した時点）ではなく、ユーザーが選んだ日時か */
function isPickedTime(departure: string): boolean {
  const t = new Date(departure).getTime();
  return Number.isFinite(t) && Math.abs(t - Date.now()) > 30 * 60_000;
}

const inputCls =
  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-base font-medium transition-colors focus:border-ai focus:ring-2 focus:ring-ai/15";

/**
 * 検索フォーム。スマホで片手でも使えるよう、必須は「出発地・目的地」の2つだけにし、
 * 出発時刻は「今すぐ」を既定、こだわり条件は折りたたみ、送信ボタンは画面下に固定する。
 */
export function JourneyForm({ initial, showMap = true, transitAvailable = false }: Props) {
  const router = useRouter();
  const { m, formatDuration } = useI18n();
  const recent = useRecentTrips();
  const presets = PRESET_ROUTES.map((p, i) => {
    const names = m.home.presets[i]!;
    return {
      ...p,
      label: `${names.origin} → ${names.destination}`,
      origin: { ...p.origin, label: names.origin },
      destination: { ...p.destination, label: names.destination },
    };
  });
  const [origin, setOrigin] = useState<Place | null>(initial?.origin ?? null);
  const [destination, setDestination] = useState<Place | null>(initial?.destination ?? null);
  const initialDeparture = initial?.departure ?? defaultDeparture();
  // 既定は常に「今すぐ出発」。「編集」で戻ってきたとき、別の日時を指定していた場合（今から30分以上ずれる）だけその日時を保つ
  const [leaveNow, setLeaveNow] = useState(() => !initial?.departure || !isPickedTime(initial.departure));
  const [date, setDate] = useState(initialDeparture.slice(0, 10));
  const [time, setTime] = useState(initialDeparture.slice(11, 16));
  const selectable = (md: TransportMode) => FORM_MODES.includes(md) && (transitAvailable || !TRANSIT_MODES.includes(md));
  const [mode, setMode] = useState<TransportMode>(initial?.mode && selectable(initial.mode) ? initial.mode : "car");
  const [prefs, setPrefs] = useState<Preference[]>(initial?.preferences ?? []);
  const [errors, setErrors] = useState<{ origin?: string; destination?: string; date?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const modePrefs = MODE_PREFERENCES[mode] ?? [];
  const activePrefs = prefs.filter((p) => modePrefs.includes(p));
  // 「今すぐ出発」の表示時刻は、ページを開いたままでも分が変わるたびに更新する
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setClock(Date.now());
      interval = setInterval(() => setClock(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, []);
  const nowDeparture = defaultDeparture(new Date(clock));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const departure = leaveNow ? defaultDeparture() : `${date}T${time}`;
    const next: typeof errors = {};
    if (!origin) next.origin = m.form.errors.originRequired;
    if (!destination) next.destination = m.form.errors.destinationRequired;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departure)) next.date = m.form.errors.dateRequired;
    setErrors(next);
    if (Object.keys(next).length > 0 || !origin || !destination) return;
    setSubmitting(true);
    saveRecent(origin, destination, mode, origin.label === m.form.currentLocation);
    router.push(`/search?${toQuery({ origin, destination, departure, mode, preferences: activePrefs })}`);
  }

  function applyPreset(preset: (typeof presets)[number]) {
    setOrigin(preset.origin);
    setDestination(preset.destination);
    setErrors({});
  }

  function applyRecent(t: RecentTrip) {
    // 現在地は保存していないので、その場合は目的地だけ入れて出発地はそのままにする
    if (t.origin) setOrigin(t.origin);
    setDestination(t.destination);
    if (selectable(t.mode)) setMode(t.mode);
    setErrors({});
  }

  function setNow() {
    const cur = defaultDeparture();
    setDate(cur.slice(0, 10));
    setTime(cur.slice(11, 16));
  }

  const tripRow = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 active:bg-surface-2";
  const straightKm = origin && destination ? haversineM([origin.lon, origin.lat], [destination.lon, destination.lat]) / 1000 : null;
  // 実際の道のり（道路・線路）。取得できるまでは直線の点線
  // 電車は選んだ出発時刻で調べる（「今すぐ」は毎分取り直さないよう、時単位にまとめる）
  const previewDeparture = leaveNow ? `${nowDeparture.slice(0, 14)}00` : `${date}T${time}`;
  const preview = usePreviewRoute(origin, destination, mode, previewDeparture, showMap);
  const previewRoutes = useMemo<MapRoute[]>(
    () => (preview ? [{ id: PREVIEW_ID, legs: preview.legs.map((l) => ({ mode: l.mode, outdoor: false, geometry: l.geometry })) }] : NO_ROUTES),
    [preview],
  );
  const distanceLabel = preview
    ? m.home.routeDistance(preview.distanceM / 1000, formatDuration(preview.durationSec))
    : straightKm !== null
      ? m.home.straightDistance(straightKm)
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        {/* ブラウザの自動入力が form / input に属性を足すことがあるため、属性の差だけは警告しない */}
        <form
          suppressHydrationWarning
          onSubmit={submit}
          noValidate
          aria-labelledby="journey-form-heading"
          className="relative rounded-xl border border-line bg-surface shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-line bg-surface-2 px-4 py-2.5">
            <h2 id="journey-form-heading" className="text-base font-bold text-ink">
              {m.form.heading}
            </h2>
            <span className="text-[11px] font-medium text-muted">{m.form.autoCalc}</span>
          </div>

          {/* ① 移動手段（タブ） */}
          <fieldset className="border-b border-line">
            <legend className="sr-only">{m.form.mode}</legend>
            <div className="grid grid-cols-2">
              {FORM_MODES.map((md) => {
                const active = mode === md;
                const enabled = selectable(md);
                return (
                  <label
                    key={md}
                    className={`relative flex min-h-12 items-center justify-center gap-1.5 border-b-[3px] px-2 text-sm font-bold transition-colors has-[:focus-visible]:bg-ai-light ${
                      !enabled
                        ? "cursor-not-allowed border-transparent text-muted/70"
                        : active
                          ? "cursor-pointer border-ai text-ai"
                          : "cursor-pointer border-transparent text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <input type="radio" name="mode" value={md} checked={active} disabled={!enabled} onChange={() => setMode(md)} className="sr-only" />
                    <span className={`[&_svg]:h-5 [&_svg]:w-5 ${!enabled ? "opacity-50" : ""}`}>
                      <ModeIcon mode={md} />
                    </span>
                    <span>{m.modes[md]}</span>
                    {!enabled && <span className="text-[10px] font-semibold">{m.form.comingSoon}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-4 p-4">
            {(mode === "car" || !transitAvailable) && (
              <p className="-mt-1 text-[11px] leading-relaxed text-muted">
                {mode === "car" ? m.quick.roadHintLong : null}
                {mode === "car" && !transitAvailable ? " / " : null}
                {!transitAvailable ? m.form.transitComingSoon : null}
              </p>
            )}

            {/* ② どこから・どこへ（右側に入れ替えボタン） */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
              <div className="space-y-3">
                <PlaceField
                  label={m.form.origin}
                  placeholder={m.form.placeholderOrigin}
                  value={origin}
                  onChange={setOrigin}
                  allowCurrentLocation
                  error={errors.origin}
                  iconType="origin"
                />
                <PlaceField
                  label={m.form.destination}
                  placeholder={m.form.placeholderDestination}
                  value={destination}
                  onChange={setDestination}
                  error={errors.destination}
                  iconType="destination"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setOrigin(destination);
                  setDestination(origin);
                }}
                disabled={!(origin || destination)}
                aria-label={m.form.swap}
                title={m.form.swap}
                className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface text-lg text-ai transition-colors hover:border-ai hover:bg-ai-light disabled:opacity-30"
              >
                <span aria-hidden="true">⇅</span>
              </button>
            </div>

            {showMap && (origin || destination) && (
              <div className="overflow-hidden rounded-lg border border-line lg:hidden">
                <MapOnDemand routes={previewRoutes} selectedId={PREVIEW_ID} origin={origin} destination={destination} summary={m.home.mapPreviewLabel} className="h-44" />
                {distanceLabel && <p className="num border-t border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">{distanceLabel}</p>}
              </div>
            )}

            {/* ③ いつ（既定は「今すぐ」） */}
            <fieldset>
              <legend className="mb-1.5 text-sm font-bold text-ink">{m.form.departureDateTime}</legend>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line">
                {[
                  { now: true, label: m.quick.leaveNow },
                  { now: false, label: m.quick.pickTime },
                ].map((o, i) => (
                  <label
                    key={String(o.now)}
                    className={`flex min-h-11 cursor-pointer items-center justify-center text-sm font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ai ${
                      i > 0 ? "border-l border-line" : ""
                    } ${leaveNow === o.now ? "bg-ai text-ai-ink" : "bg-surface text-ink hover:bg-surface-2"}`}
                  >
                    <input type="radio" name="when" className="sr-only" checked={leaveNow === o.now} onChange={() => setLeaveNow(o.now)} />
                    {o.label}
                  </label>
                ))}
              </div>
              {leaveNow ? (
                <p className="num mt-1.5 text-xs text-muted" suppressHydrationWarning>{m.quick.leaveNowHint(nowDeparture.slice(11, 16))}</p>
              ) : (
                <div className="mt-2 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                  <label className="min-w-0">
                    <span className="sr-only">{m.form.date}</span>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-invalid={errors.date ? true : undefined} className={inputCls} />
                  </label>
                  <label className="min-w-0">
                    <span className="sr-only">{m.form.time}</span>
                    <input type="time" value={time} step={60} onChange={(e) => setTime(e.target.value)} required aria-invalid={errors.date ? true : undefined} className={inputCls} />
                  </label>
                  <button type="button" onClick={setNow} className="col-span-2 min-h-9 justify-self-start rounded-md px-2 text-xs font-bold text-ai hover:bg-ai-light">
                    ↺ {m.form.now}
                  </button>
                </div>
              )}
              {errors.date && <p className="mt-1 text-xs font-semibold text-danger">{errors.date}</p>}
            </fieldset>

            {/* ④ こだわり条件（任意・折りたたみ。車では表示しない） */}
            {modePrefs.length > 0 && (
              <details className="group rounded-lg border border-line" open={activePrefs.length > 0}>
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-ink">
                  <span>
                    {m.quick.options}
                    <span className="ml-1.5 text-xs font-medium text-muted">
                      {activePrefs.length > 0 ? m.quick.selectedCount(activePrefs.length) : m.common.paren(m.quick.optional)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
                </summary>
                <fieldset className="border-t border-line px-3 pt-2.5 pb-3">
                  <legend className="sr-only">{m.form.priorities}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {modePrefs.map((p) => {
                      const on = prefs.includes(p);
                      return (
                        <label
                          key={p}
                          className={`inline-flex min-h-10 cursor-pointer items-center rounded-md border px-3 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ai ${
                            on ? "border-ai bg-ai-light text-ai" : "border-line bg-surface text-muted hover:text-ink"
                          }`}
                        >
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => setPrefs(on ? prefs.filter((x) => x !== p) : [...prefs, p])} />
                          {on && <span aria-hidden="true" className="mr-1">✓</span>}
                          {m.preferences[p]}
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">{m.form.prioritiesHelp}</p>
                </fieldset>
              </details>
            )}
          </div>

          {/* 検索ボタン（スマホでは画面下に固定） */}
          <div className="pb-safe sticky bottom-0 z-10 rounded-b-xl border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur-md sm:static sm:border-0 sm:bg-transparent sm:pt-0 sm:pb-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-13 w-full items-center justify-center gap-2 rounded-lg bg-ai px-6 text-base font-bold text-ai-ink shadow-sm transition-colors hover:bg-ai-hover active:bg-ai-hover disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ai-ink border-t-transparent" aria-hidden="true" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              )}
              <span>{submitting ? m.common.loading : m.form.submit}</span>
            </button>
          </div>
        </form>

        {/* 検索履歴（なければ定番ルート）。押すと出発地・目的地に入る */}
        <section aria-labelledby="trips-heading" className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <h2 id="trips-heading" className="text-sm font-bold text-ink">
              {recent.length > 0 ? m.quick.recent : m.quick.examples}
            </h2>
            {recent.length > 0 && (
              <button type="button" onClick={clearRecent} className="min-h-8 rounded px-2 text-xs font-semibold text-muted hover:text-ink hover:underline">
                {m.quick.clearRecent}
              </button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {recent.length > 0
              ? recent.map((t) => {
                  const to = t.destination.label ?? `${t.destination.lat}, ${t.destination.lon}`;
                  const label = t.origin ? `${t.origin.label ?? `${t.origin.lat}, ${t.origin.lon}`} → ${to}` : m.quick.recentTo(to);
                  return (
                    <li key={`${t.at}-${label}`}>
                      <button type="button" onClick={() => applyRecent(t)} title={label} className={tripRow}>
                        <span aria-hidden="true" className="shrink-0 text-ai [&_svg]:h-5 [&_svg]:w-5">
                          <ModeIcon mode={t.mode} />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{label}</span>
                        <span aria-hidden="true" className="text-muted">›</span>
                      </button>
                    </li>
                  );
                })
              : presets.map((p) => (
                  <li key={p.label}>
                    <button type="button" onClick={() => applyPreset(p)} className={tripRow}>
                      <span aria-hidden="true" className="w-5 shrink-0 text-center">{p.icon}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.label}</span>
                      <span aria-hidden="true" className="text-muted">›</span>
                    </button>
                  </li>
                ))}
          </ul>
        </section>
      </div>

      {showMap && (
        <div className="hidden overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:sticky lg:top-20 lg:block">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
            <span className="text-sm font-bold text-ink">{m.form.mapPreview}</span>
            {distanceLabel && <span className="num text-xs text-muted">{distanceLabel}</span>}
          </div>
          <MapOnDemand routes={previewRoutes} selectedId={PREVIEW_ID} origin={origin} destination={destination} summary={m.home.mapPreviewLabel} className="h-[540px]" />
        </div>
      )}
    </div>
  );
}
