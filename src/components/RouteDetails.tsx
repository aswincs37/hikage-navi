"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { EvaluatedRoute, SegmentEstimate, ShadeReason, ShadeState, SourceRef } from "@/lib/domain/types";
import { fetchSearch, type SearchOutcome } from "@/lib/journey/client";
import { fromQuery, toQuery } from "@/lib/journey/query";
import { useI18n } from "@/lib/i18n/client";
import { DataKindBadge, HeatWarnings, NoticeList } from "./Badges";
import { ExposureBar, explanation, VehicleSideSummary, WeatherSummary } from "./RouteCard";
import { MapOnDemand } from "./MapOnDemand";
import { vehicleSunSide } from "@/lib/solar/side";

interface Chunk {
  legIndex: number;
  start: string;
  durationSec: number;
  outdoor: boolean;
  mid: SegmentEstimate;
  states: Record<ShadeState, number>;
  mainReason: ShadeReason;
}

/** 区間を約5分ごと（区間の切れ目では区切る）にまとめる */
function chunkSegments(segs: SegmentEstimate[], windowSec = 300): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: SegmentEstimate[] = [];
  const flush = () => {
    if (!cur.length) return;
    const states: Record<ShadeState, number> = { shaded: 0, exposed: 0, unknown: 0, night: 0 };
    const reasons = new Map<ShadeReason, number>();
    let dur = 0;
    for (const s of cur) {
      states[s.shade.state] += s.durationSec;
      reasons.set(s.shade.reason, (reasons.get(s.shade.reason) ?? 0) + s.durationSec);
      dur += s.durationSec;
    }
    const mainReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    chunks.push({ legIndex: cur[0]!.legIndex, start: cur[0]!.startTime, durationSec: dur, outdoor: cur[0]!.outdoor, mid: cur[Math.floor(cur.length / 2)]!, states, mainReason });
    cur = [];
  };
  for (const s of segs) {
    const first = cur[0];
    if (first && (s.legIndex !== first.legIndex || new Date(s.startTime).getTime() - new Date(first.startTime).getTime() >= windowSec * 1000)) flush();
    cur.push(s);
  }
  flush();
  return chunks;
}

const STATE_CLASS: Record<ShadeState, string> = {
  shaded: "bg-shade-bg text-shade border border-shade/20",
  exposed: "bg-sun-bg text-sun border border-sun/20",
  unknown: "bg-unknown-bg text-unknown border border-unknown/20",
  night: "bg-unknown-bg text-unknown border border-unknown/20",
};

function ShadeCell({ c }: { c: Chunk }) {
  const { m } = useI18n();
  if (!c.outdoor) return <span className="text-muted">{m.shadeReasons.in_vehicle}</span>;
  const entries = (Object.entries(c.states) as [ShadeState, number][]).filter(([, v]) => v > 0);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {entries.map(([state, sec]) => (
        <span key={state} className={`rounded-md px-2 py-0.5 text-xs font-semibold shadow-2xs ${STATE_CLASS[state]}`}>
          {m.shadeStates[state]} {Math.round((sec / c.durationSec) * 100)}%
        </span>
      ))}
      <span className="w-full text-xs text-muted mt-0.5">{m.shadeReasons[c.mainReason]}</span>
    </span>
  );
}

function SourceLine({ s }: { s: SourceRef }) {
  const { m, formatTime } = useI18n();
  const attribution = s.attribution ? (m.attributions[s.attribution] ?? s.attribution) : s.provider;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <DataKindBadge kind={s.kind} />
      <span className="font-medium text-ink">{attribution}</span>
      {s.issuedAt && (
        <span className="num text-xs text-muted">
          {m.common.issued}: {formatTime(s.issuedAt)}
        </span>
      )}
      {s.retrievedAt && (
        <span className="num text-xs text-muted">
          {m.common.retrieved}: {formatTime(s.retrievedAt)}
        </span>
      )}
    </li>
  );
}

export function RouteDetails() {
  const sp = useSearchParams();
  const routeId = sp.get("r");
  const { m, formatDuration, formatDistance, formatTime } = useI18n();
  const params = useMemo(() => fromQuery(new URLSearchParams(sp.toString())), [sp]);
  const query = params ? toQuery(params) : "";
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${query}#${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; outcome: SearchOutcome } | null>(null);
  const outcome = loaded?.key === requestKey ? loaded.outcome : null;

  useEffect(() => {
    if (!params) return;
    const ctrl = new AbortController();
    fetchSearch(query, params, ctrl.signal)
      .then((o) => setLoaded({ key: requestKey, outcome: o }))
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const backHref = `/search?${query}`;
  if (!params || !routeId) return <NotFound backHref="/" />;
  if (!outcome) {
    return (
      <div className="wa-card rounded-3xl p-12 text-center shadow-sm">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-ai border-t-transparent" />
        <p className="mt-3 text-sm text-muted">{m.common.loading}</p>
      </div>
    );
  }
  if (!outcome.ok && outcome.code === "network_error") {
    return (
      <div role="alert" className="rounded-3xl border border-danger/40 bg-danger-bg p-6 text-center shadow-xs">
        <p className="font-bold text-danger">{m.results.networkError}</p>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-4 min-h-11 rounded-xl bg-danger px-5 text-sm font-bold text-white shadow-xs hover:brightness-110 active:scale-95"
        >
          {m.results.retry}
        </button>
      </div>
    );
  }
  if (!outcome.ok) return <NotFound backHref={backHref} />;
  const result = outcome.result;
  const r: EvaluatedRoute | undefined = result.routes.find((x) => x.route.id === routeId);
  if (!r) return <NotFound backHref={backHref} />;
  const ranked = result.ranking?.ranked.find((x) => x.routeId === routeId);
  const why = explanation(ranked, result.routes.length, m);
  const chunks = chunkSegments(r.segments);
  const e = r.exposure;
  const sources: SourceRef[] = [r.route.source, ...e.method.sources];
  if (r.weather.samples.status === "available") sources.push(r.weather.samples.source);
  if (r.weather.wbgt.status === "available") sources.push(r.weather.wbgt.source);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-surface-2 px-4 py-2">
          <Link href={backHref} className="inline-flex min-h-8 items-center gap-1 text-sm font-bold text-ai hover:underline underline-offset-4">
            <span aria-hidden="true">‹</span>
            <span>{m.details.back}</span>
          </Link>
        </div>
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-ink sm:text-2xl">{m.details.title}</h1>
            {ranked && <span className="rounded bg-ai px-1.5 py-0.5 text-xs font-bold text-ai-ink">{m.results.rank(ranked.rank)}</span>}
            <span className="rounded border border-line px-1.5 py-0.5 text-xs font-bold text-muted">{m.modes[r.route.mode]}</span>
          </div>
          <p className="num mt-1 text-sm text-muted">
            {m.details.summaryLine(`${formatTime(r.route.startTime)} → ${formatTime(r.route.endTime)}`, formatDuration(r.route.durationSec), formatDistance(r.route.distanceM))}
          </p>
        </div>
      </div>

      <HeatWarnings warnings={r.heatWarnings} />
      {why && (
        <div className="rounded-lg border-l-4 border-shade bg-shade-bg p-3 text-sm">
          <p className="leading-relaxed text-ink">{why}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <MapOnDemand
          routes={[{ id: r.route.id, legs: r.route.legs }]}
          selectedId={r.route.id}
          segments={r.segments.map((s) => ({ legIndex: s.legIndex, lat: s.lat, lon: s.lon, outdoor: s.outdoor, state: s.shade.state, side: s.outdoor ? s.relativeSun : vehicleSunSide(s.bearingDeg, s.sun) }))}
          origin={params.origin}
          destination={params.destination}
          summary={m.details.mapSummary}
          className="h-80 sm:h-[460px]"
        />
      </div>

      {/* 乗換案内のような、駅（地点）ごとの時刻と区間の一覧 */}
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-base font-bold text-ink">{m.details.legs}</h2>
        <ol className="mt-3">
          {r.route.legs.map((l, i) => {
            const prev = r.route.legs[i - 1];
            const stopName = l.fromName ?? (i === 0 ? params.origin.label : prev?.toName) ?? (i === 0 ? m.map.origin : "");
            const arrived = prev && prev.endTime !== l.startTime ? prev.endTime : null;
            const side = r.vehicleSides.find((s) => s.legIndex === i)?.shadierSide;
            const walk = l.outdoor;
            return (
              <li key={i}>
                <TimelineStop time={formatTime(l.startTime)} arrived={arrived ? formatTime(arrived) : null} name={stopName} first={i === 0} />
                <div className="grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] gap-x-2">
                  <span />
                  <span className="flex justify-center" aria-hidden="true">
                    <span className={`w-1.5 ${walk ? "border-l-4 border-dotted border-sun-bright" : l.mode === "subway" ? "bg-unknown" : "bg-ai"}`} />
                  </span>
                  <div className="space-y-1 py-3">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${walk ? "bg-sun-bg text-sun" : "bg-ai-light text-ai"}`}>{m.legModes[l.mode]}</span>
                      {l.routeName && <span className="font-bold text-ink">{l.routeName}</span>}
                      {l.operatorName && <span className="text-xs text-muted">{l.operatorName}</span>}
                    </p>
                    <p className="num text-xs text-muted">
                      {formatDuration(l.durationSec)}・{formatDistance(l.distanceM)}
                    </p>
                    {(side === "left" || side === "right") && (
                      <p className="inline-flex items-center gap-1 rounded bg-shade-bg px-1.5 py-0.5 text-xs font-bold text-shade">
                        <span aria-hidden="true">🪑</span>
                        {side === "left" ? m.quick.seatChipLeft : m.quick.seatChipRight}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          <li>
            <TimelineStop
              time={formatTime(r.route.endTime)}
              arrived={null}
              name={r.route.legs[r.route.legs.length - 1]?.toName ?? params.destination.label ?? m.map.destination}
              last
            />
          </li>
        </ol>
        {r.route.waitingSec !== undefined && r.route.waitingSec > 0 && (
          <p className="mt-3 text-xs text-muted">{m.details.waiting(formatDuration(r.route.waitingSec))}</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {e.outdoorMin > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="mb-3 flex items-center justify-between font-bold text-ink">
              <span>{m.results.sunlight}</span>
              <DataKindBadge kind="estimate" />
            </h2>
            <ExposureBar r={r} />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {m.details.shadeCoverage(Math.round(e.shadeCoverage * 100))} {m.details.resolution(e.resolutionSec)}
            </p>
          </div>
        )}
        <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="mb-3 font-bold text-ink">{m.results.weather}</h2>
          <WeatherSummary w={r.weather} />
        </div>
        {r.vehicleSides.length > 0 && (
          <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 md:col-span-2">
            <h2 className="mb-3 flex items-center justify-between font-bold text-ink">
              <span>{m.vehicle.title}</span>
              <DataKindBadge kind="astronomical" />
            </h2>
            <VehicleSideSummary sides={r.vehicleSides} />
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
              {[...new Set(r.vehicleSides.flatMap((s) => s.caveats))].map((c) => (
                <li key={c}>{m.vehicle.caveats[c as keyof typeof m.vehicle.caveats] ?? c}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 区間ごとの詳細表 */}
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-base font-bold text-ink">{m.details.segments}</h2>
        <p className="mt-1 text-xs text-muted">{m.details.segmentsHelp}</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="num w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-bold text-muted">
                <th scope="col" className="py-3 px-3">{m.details.time}</th>
                <th scope="col" className="py-3 pr-2">{m.details.sunPosition}</th>
                <th scope="col" className="py-3 pr-2">{m.details.sunSide}</th>
                <th scope="col" className="py-3 pr-3">{m.details.shade}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {chunks.map((c, i) => (
                <tr key={i} className="align-top hover:bg-surface-2/30 transition-colors">
                  <th scope="row" className="py-3 px-3 text-left font-normal">
                    <span className="font-bold text-ink">{formatTime(c.start)}</span>
                    <span className="block text-xs text-muted">{m.legModes[r.route.legs[c.legIndex]!.mode]}</span>
                  </th>
                  <td className="py-3 pr-2">
                    {c.mid.sun.aboveHorizon ? (
                      <div>
                        <span className="font-medium text-ink">{m.details.elevation} {Math.round(c.mid.sun.elevationDeg)}°</span>
                        <span className="block text-xs text-muted">
                          {m.details.azimuth} {Math.round(c.mid.sun.azimuthDeg)}°
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">{m.shadeReasons.sun_below_horizon}</span>
                    )}
                  </td>
                  <td className="py-3 pr-2 font-medium">{m.relativeSun[c.mid.relativeSun]}</td>
                  <td className="py-3 pr-3">
                    <ShadeCell c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 気象タイムライン */}
      {r.weather.samples.status === "available" && (
        <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="flex items-center justify-between text-base font-bold text-ink">
            <span>{m.details.weatherTimeline}</span>
            <DataKindBadge kind={r.weather.samples.source.kind} />
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="num w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-bold text-muted">
                  <th scope="col" className="py-3 px-3">{m.details.validTime}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.temperature}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.humidity}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.wind}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.cloud}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.precip}</th>
                  <th scope="col" className="py-3 pr-3">UV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {r.weather.samples.value.map((s, i) => {
                  const v = s.values;
                  const f = (x: number | undefined, fmt: (n: number) => string) => (x === undefined ? "—" : fmt(x));
                  return (
                    <tr key={i} className="hover:bg-surface-2/30 transition-colors">
                      <th scope="row" className="py-3 px-3 text-left font-bold text-ink">{formatTime(s.validTime)}</th>
                      <td className="py-3 pr-2 font-medium">{f(v.temperatureC, m.common.celsius)}</td>
                      <td className="py-3 pr-2">{f(v.relativeHumidityPct, m.common.percent)}</td>
                      <td className="py-3 pr-2">{f(v.windSpeedMs, m.common.ms)}</td>
                      <td className="py-3 pr-2">{f(v.cloudCoverPct, m.common.percent)}</td>
                      <td className="py-3 pr-2">{f(v.precipitationProbabilityPct, m.common.percent)}</td>
                      <td className="py-3 pr-3 font-semibold">{f(v.uvIndex, String)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {m.details.weatherNote}
          </p>
        </section>
      )}

      {/* WBGT タイムライン */}
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-base font-bold text-ink">{m.details.wbgtTimeline}</h2>
        {r.weather.wbgt.status === "available" ? (
          <ul className="num mt-3 space-y-2 text-sm">
            {r.weather.wbgt.value.map((w, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
                <span className="font-bold text-ink">{formatTime(w.validTime)}</span>
                <span className="font-black text-ai">WBGT {w.wbgt}</span>
                <span className="rounded-md bg-warn-bg px-2 py-0.5 text-xs font-bold text-warn border border-warn/20">
                  {m.wbgtLevels[w.level]}
                </span>
                <span className="text-xs text-muted sm:ml-auto">
                  {m.details.station}: {m.details.stationDistance(w.stationName, w.distanceKm)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {m.details.unavailableSentence(m.unavailableReasons[r.weather.wbgt.reason], m.warnings.wbgt_unavailable)}
          </p>
        )}
      </section>

      {/* 出典と制限事項 */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-base font-bold text-ink">{m.details.sources}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {sources.map((s, i) => (
              <SourceLine key={i} s={s} />
            ))}
          </ul>
          <div className="mt-4">
            <NoticeList notices={result.notices} />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-base font-bold text-ink">{m.details.limitations}</h2>
          <p className="mt-2 text-sm">
            {m.details.confidence}: <strong className="rounded-md bg-info-bg px-2 py-0.5 text-xs font-bold text-ai">{m.details.confidenceLevels[e.method.confidence]}</strong>
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs sm:text-sm leading-relaxed text-muted">
            {m.details.limitationList.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <Link
            href="/how-it-works"
            className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-ai hover:underline underline-offset-4"
          >
            <span>{m.nav.howItWorks}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}

function NotFound({ backHref }: { backHref: string }) {
  const { m } = useI18n();
  return (
    <div className="rounded-xl border border-line bg-surface p-8 text-center max-w-lg mx-auto my-12">
      <p className="font-bold text-ink text-base">{m.details.notFound}</p>
      <Link
        href={backHref}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-ai px-5 py-2.5 text-xs font-bold text-ai-ink shadow-sm hover:brightness-110"
      >
        <span>←</span>
        <span>{m.details.back}</span>
      </Link>
    </div>
  );
}

/** 時刻表のような一覧の、駅（地点）の行 */
function TimelineStop({ time, arrived, name, first, last }: { time: string; arrived: string | null; name: string; first?: boolean; last?: boolean }) {
  const { m } = useI18n();
  return (
    <div className="grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] items-center gap-x-2">
      <span className="num text-right leading-tight">
        {arrived && <span className="block text-[11px] text-muted">{arrived}{m.details.arriveMark}</span>}
        <span className="text-sm font-bold text-ink">
          {time}
          <span className="text-[11px] font-medium text-muted">{last ? m.details.arriveMark : m.details.departMark}</span>
        </span>
      </span>
      <span className="flex justify-center" aria-hidden="true">
        <span className={`h-4 w-4 rounded-full border-[3px] bg-surface ${first || last ? "border-ink" : "border-ai"}`} />
      </span>
      <span className="min-w-0 truncate py-1 text-base font-bold text-ink">{name}</span>
    </div>
  );
}
