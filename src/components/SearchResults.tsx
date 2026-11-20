"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSearch, type SearchOutcome } from "@/lib/journey/client";
import { fromQuery, toQuery } from "@/lib/journey/query";
import { useI18n } from "@/lib/i18n/client";
import { AnswerCard } from "./AnswerCard";
import { NoticeList } from "./Badges";
import { DepartureComparison } from "./DepartureComparison";
import { MapOnDemand } from "./MapOnDemand";
import { ModeIcon } from "./icons";
import { RouteCard, type RouteTag } from "./RouteCard";
import { ShareButton } from "./ShareButton";
import { vehicleSunSide } from "@/lib/solar/side";

export function SearchResults() {
  const sp = useSearchParams();
  const { m, formatDate, formatTime, formatDuration, validationText } = useI18n();
  const params = useMemo(() => fromQuery(new URLSearchParams(sp.toString())), [sp]);
  const query = params ? toQuery(params) : "";
  const [attempt, setAttempt] = useState(0);
  // 結果はどの検索（クエリ＋再試行回数）に対するものかを持ち、条件が変わったら自動的に読み込み中に戻る
  const requestKey = `${query}#${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; outcome: SearchOutcome } | null>(null);
  const [picked, setPicked] = useState<{ key: string; id: string } | null>(null);
  const outcome = loaded?.key === requestKey ? loaded.outcome : null;

  useEffect(() => {
    if (!params) return;
    const ctrl = new AbortController();
    fetchSearch(query, params, ctrl.signal)
      .then((o) => setLoaded({ key: requestKey, outcome: o }))
      .catch(() => {});
    return () => ctrl.abort();
    // query が同じなら params も同じ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const firstId = outcome?.ok ? outcome.result.routes[0]?.route.id : undefined;
  const selected = picked?.key === requestKey ? picked.id : firstId;
  const setSelected = (id: string) => setPicked({ key: requestKey, id });
  const answerRef = useRef<HTMLDivElement>(null);
  /** カードから選んだときは、スマホでは切り替わった結論と地図が見える位置まで戻す */
  const selectFromCard = (id: string) => {
    setSelected(id);
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (!params) {
    return (
      <div className="wa-card rounded-3xl p-8 text-center max-w-xl mx-auto my-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger-bg text-danger">
          ⚠️
        </div>
        <p className="font-bold text-ink text-lg">{m.results.invalidRequest}</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-ai px-6 py-3 font-bold text-ai-ink shadow-sm hover:brightness-110"
        >
          {m.results.newSearch}
        </Link>
      </div>
    );
  }

  const departureIso = `${params.departure}:00+09:00`;
  const header = (
    <header className="wa-card flex items-center gap-3 rounded-2xl p-3 shadow-sm sm:p-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ai-light text-ai" aria-hidden="true">
        <ModeIcon mode={params.mode} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="line-clamp-2 text-base font-black leading-snug text-ink sm:text-xl">
          <span>{params.origin.label ?? m.form.origin}</span>
          <span className="mx-1 text-muted" aria-label={m.results.toLabel}>→</span>
          <span>{params.destination.label ?? m.form.destination}</span>
        </h1>
        <p className="num truncate text-xs font-medium text-muted">
          {m.modes[params.mode]}・{m.results.departsAt(formatDate(departureIso), formatTime(departureIso))}
          {params.preferences.length > 0 && `・${params.preferences.map((p) => m.preferences[p]).join("、")}`}
        </p>
      </div>
      <ShareButton title={`${params.origin.label ?? m.form.origin} → ${params.destination.label ?? m.form.destination}｜${m.brand.name}`} />
      <Link
        href={`/?${query}`}
        aria-label={m.results.newSearch}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-bold text-ai shadow-2xs transition-all hover:border-ai/50 hover:bg-info-bg active:scale-95"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        <span>{m.quick.edit}</span>
      </Link>
    </header>
  );

  if (!outcome) {
    return (
      <div className="space-y-4">
        {header}
        <div role="status" aria-live="polite" className="wa-card rounded-3xl p-6 sm:p-12 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-info-bg text-ai">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-ai border-t-transparent" aria-hidden="true" />
          </div>
          <p className="text-lg font-bold text-ink">{m.results.loading}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">{m.results.loadingDetail}</p>
        </div>
      </div>
    );
  }

  if (!outcome.ok) {
    const msg =
      outcome.code === "network_error"
        ? m.results.networkError
        : outcome.code === "rate_limited"
        ? m.results.rateLimited
        : outcome.code === "invalid_request"
          ? (outcome.issues ?? []).map((i) => validationText(i.code)).filter((v, i, a) => a.indexOf(v) === i).join(" ") || m.results.invalidRequest
          : m.results.genericError;
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="rounded-3xl border border-danger/40 bg-danger-bg p-6 sm:p-8 shadow-xs">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div className="flex-1">
              <p className="font-bold text-danger text-base">{msg}</p>
              {outcome.code !== "invalid_request" && (
                <button
                  type="button"
                  onClick={() => setAttempt((a) => a + 1)}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-xs font-bold text-white shadow-xs hover:brightness-110 active:scale-95"
                >
                  <span>{m.results.retry}</span>
                </button>
              )}
              {outcome.code === "network_error" && (
                <Link href="/offline" className="mt-4 ml-3 inline-flex items-center gap-1 text-xs font-bold text-ai underline underline-offset-4">
                  {m.offline.openSaved}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const result = outcome.result;
  const ranking = result.ranking;
  const selectedRoute = result.routes.find((r) => r.route.id === selected);

  if (result.status !== "ok" || result.routes.length === 0) {
    const [title, help] =
      result.status === "unsupported"
        ? [m.results.unsupported, ""]
        : result.status === "provider_error"
          ? [m.results.providerError, m.results.providerErrorHelp]
          : [m.results.noRoutes, m.results.noRoutesHelp];
    return (
      <div className="space-y-6">
        {header}
        <div role="status" className="wa-card rounded-3xl p-6 sm:p-8 shadow-sm">
          <p className="text-base font-bold text-ink">{title}</p>
          {help && <p className="mt-2 text-sm leading-relaxed text-muted">{help}</p>}
          {result.status === "unsupported" && params.mode !== "car" && (
            <Link
              href={`/search?${toQuery({ ...params, mode: "car", preferences: [] })}`}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ai px-5 py-2.5 text-sm font-bold text-ai-ink shadow-sm hover:brightness-110"
            >
              <span>{m.results.tryCar}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )}
          {result.status === "provider_error" && (
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="mt-4 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-bold text-ai shadow-2xs hover:bg-surface-2 active:scale-95"
            >
              {m.results.retry}
            </button>
          )}
        </div>
        <NoticeList notices={result.notices} />
      </div>
    );
  }

  const tagsById = routeTags(result.routes);
  const selectedIndex = result.routes.findIndex((r) => r.route.id === selected);
  const selectedRank = ranking?.ranked.find((x) => x.routeId === selected)?.rank;
  const answerLabel =
    selectedRank === 1 && result.routes.length > 1 ? m.quick.recommendedRoute : m.quick.routeN(selectedRank ?? selectedIndex + 1);

  return (
    <div className="space-y-4 sm:space-y-6">
      {header}

      {/* ルートの切り替え（乗換案内のタブのように、時刻と所要時間を並べる） */}
      {result.routes.length > 1 && (
        <div role="tablist" aria-label={m.results.candidates(result.routes.length)} className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-line bg-surface">
          {result.routes.map((r, i) => {
            const on = r.route.id === selected;
            const rank = ranking?.ranked.find((x) => x.routeId === r.route.id)?.rank ?? i + 1;
            return (
              <button
                key={r.route.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSelected(r.route.id)}
                className={`min-h-14 border-b-[3px] px-1.5 py-1.5 text-center transition-colors ${i > 0 ? "border-l border-l-line" : ""} ${
                  on ? "border-b-ai bg-ai-light text-ai" : "border-b-transparent text-ink hover:bg-surface-2"
                }`}
              >
                <span className="block text-xs font-bold">
                  {m.quick.routeN(rank)}
                  {(tagsById.get(r.route.id) ?? []).map((t) => (
                    <span key={t} className={`ml-1 rounded px-1 text-[10px] font-black text-white ${t === "fast" ? "bg-danger" : "bg-ai"}`}>
                      {m.results.tagShort[t]}
                    </span>
                  ))}
                </span>
                <span className="num block text-sm font-bold">{formatDuration(r.route.durationSec)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div ref={answerRef} className="scroll-mt-20 space-y-4 lg:sticky lg:top-20 lg:self-start">
          {selectedRoute && <AnswerCard r={selectedRoute} label={answerLabel} />}
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <MapOnDemand
              routes={result.routes.map((r) => ({ id: r.route.id, legs: r.route.legs }))}
              selectedId={selected}
              segments={selectedRoute?.segments.map((s) => ({ legIndex: s.legIndex, lat: s.lat, lon: s.lon, outdoor: s.outdoor, state: s.shade.state, side: s.outdoor ? s.relativeSun : vehicleSunSide(s.bearingDeg, s.sun) }))}
              origin={params.origin}
              destination={params.destination}
              onSelect={setSelected}
              summary={m.results.mapSummary(result.routes.length, m.modes[params.mode])}
              className="h-64 sm:h-[420px]"
            />
          </div>
          {params.mode === "car" && <p className="px-1 text-xs leading-relaxed text-muted">{m.results.roadNote}</p>}
        </div>

        <section aria-label={m.results.candidates(result.routes.length)} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
            <h2 className="text-sm font-bold text-ink">{m.results.candidates(result.routes.length)}</h2>
            {result.routes.length > 1 && <span className="text-xs text-muted">{m.quick.tapToSwitch}</span>}
          </div>
          {result.routes.map((r) => (
            <RouteCard
              key={r.route.id}
              r={r}
              ranked={ranking?.ranked.find((x) => x.routeId === r.route.id)}
              routeCount={result.routes.length}
              selected={r.route.id === selected}
              onSelect={() => selectFromCard(r.route.id)}
              detailsHref={`/route?${query}&r=${encodeURIComponent(r.route.id)}`}
              tags={tagsById.get(r.route.id)}
            />
          ))}
        </section>
      </div>

      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-bold text-ink shadow-2xs hover:bg-surface-2">
          <span className="flex items-center gap-2">
            <span aria-hidden="true">🕒</span>
            {m.departures.title}
          </span>
          <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="mt-3">
          <DepartureComparison params={params} />
        </div>
      </details>

      {result.notices.length > 0 && (
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-2xl border border-line bg-surface-2/50 px-4 py-3 text-xs font-semibold text-muted hover:bg-surface-2">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">ⓘ</span>
              {m.quick.dataStatus(result.notices.length)}
            </span>
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-2">
            <NoticeList notices={result.notices} />
          </div>
        </details>
      )}
    </div>
  );
}

/** 候補が2件以上のとき、所要時間が最短の経路に「早」、乗り換えが最少の経路に「楽」を付ける（全候補が同じなら付けない） */
export function routeTags(routes: { route: { id: string; durationSec: number; transfers?: number } }[]): Map<string, RouteTag[]> {
  const tags = new Map<string, RouteTag[]>();
  if (routes.length < 2) return tags;
  const add = (id: string, t: RouteTag) => tags.set(id, [...(tags.get(id) ?? []), t]);
  const durations = routes.map((r) => Math.round(r.route.durationSec / 60));
  const minD = Math.min(...durations);
  if (durations.some((d) => d !== minD)) routes.forEach((r, i) => durations[i] === minD && add(r.route.id, "fast"));
  const transfers = routes.map((r) => r.route.transfers);
  if (transfers.every((t): t is number => t !== undefined)) {
    const minT = Math.min(...transfers);
    if (transfers.some((t) => t !== minT)) routes.forEach((r, i) => transfers[i] === minT && add(r.route.id, "easy"));
  }
  return tags;
}
