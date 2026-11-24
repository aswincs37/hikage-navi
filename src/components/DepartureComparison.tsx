"use client";

import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import { useState } from "react";
import type { EvaluatedRoute, HeatWarning, ProviderNotice } from "@/lib/domain/types";
import type { SearchParamsState } from "@/lib/journey/query";
import { useI18n } from "@/lib/i18n/client";
import { NoticeList } from "./Badges";

interface Option {
  requestedTime: string;
  status: "ok" | "no_routes" | "unsupported" | "provider_error";
  best: EvaluatedRoute | null;
}

interface Props {
  params: SearchParamsState;
}

const LEVEL_ORDER: HeatWarning["level"][] = ["danger", "warning", "caution", "info"];

export function DepartureComparison({ params }: Props) {
  const { m, formatDuration, formatTime } = useI18n();
  const [timesText, setTimesText] = useState("09:00, 11:00, 13:00, 15:00, 17:00");
  const [state, setState] = useState<"idle" | "loading" | "error" | "invalid" | "limited" | "daily">("idle");
  const [result, setResult] = useState<{ options: Option[]; durationsAreTimeIndependent: boolean; notices: ProviderNotice[] } | null>(null);

  async function run() {
    const times = timesText
      .split(/[,、\s]+/)
      .map((s) => s.trim().normalize("NFKC"))
      .filter(Boolean)
      .map((s) => (/^\d:\d{2}$/.test(s) ? `0${s}` : s));
    if (times.length === 0 || times.length > 8 || !times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      setState("invalid");
      return;
    }
    setState("loading");
    try {
      const res = await fetchWithTimeout("/api/v1/journeys/departures", {
        timeoutMs: 90_000,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, times }),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        setState(body?.error?.code === "daily_limit_reached" ? "daily" : "limited");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setResult(await res.json());
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const ok = result?.options.filter((o) => o.best) ?? [];
  const minOf = (f: (r: EvaluatedRoute) => number) => (ok.length > 1 ? Math.min(...ok.map((o) => f(o.best!))) : null);
  const sunOf = (r: EvaluatedRoute) => r.exposure.sunUpOutdoorMin - r.exposure.shadedMin;
  const minDuration = minOf((r) => Math.round(r.route.durationSec / 60));
  const minSun = minOf(sunOf);

  return (
    <section aria-labelledby="dep-title" className="wa-card rounded-3xl p-6 sm:p-7 shadow-sm">
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ai)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <h2 id="dep-title" className="text-lg font-bold text-ink sm:text-xl">
          {m.departures.title}
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted">{m.departures.description}</p>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">{m.departures.times}</span>
          <input
            value={timesText}
            onChange={(e) => setTimesText(e.target.value)}
            inputMode="numeric"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm font-medium shadow-2xs transition-all focus:border-ai focus:ring-2 focus:ring-ai/15"
            aria-invalid={state === "invalid" ? true : undefined}
          />
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={state === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-ai px-6 py-2.5 text-sm font-bold text-ai-ink shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-60"
        >
          {state === "loading" && (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ai-ink border-t-transparent" />
          )}
          <span>{state === "loading" ? m.departures.running : m.departures.run}</span>
        </button>
      </div>

      <div aria-live="polite">
        {state === "invalid" && <p className="mt-2 text-xs font-semibold text-danger">{m.departures.invalidTimes}</p>}
        {state === "error" && <p className="mt-2 text-xs font-semibold text-danger">{m.results.genericError}</p>}
        {state === "limited" && <p className="mt-2 text-xs font-semibold text-danger">{m.results.rateLimited}</p>}
        {state === "daily" && <p className="mt-2 text-xs font-semibold text-danger">{m.results.dailyLimit}</p>}
      </div>

      {result && (
        <div className="mt-6 space-y-4">
          <NoticeList notices={result.notices} />
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
            <table className="num w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">{m.departures.title}</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-left text-xs font-bold text-muted">
                  <th scope="col" className="py-3 px-3">{m.departures.depart}</th>
                  <th scope="col" className="py-3 pr-2">{m.departures.arrive}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.duration}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.outdoor}</th>
                  <th scope="col" className="py-3 pr-2">{m.departures.sunColumn(m.results.exposed, m.results.unknownShade)}</th>
                  <th scope="col" className="py-3 pr-2">{m.results.temperature}</th>
                  <th scope="col" className="py-3 pr-2">UV</th>
                  <th scope="col" className="py-3 pr-2">WBGT</th>
                  <th scope="col" className="py-3 pr-3">{m.departures.caution}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {result.options.map((o) => {
                  const r = o.best;
                  if (!r)
                    return (
                      <tr key={o.requestedTime} className="transition-colors hover:bg-surface-2/40">
                        <th scope="row" className="py-3 px-3 text-left font-bold text-ink">{o.requestedTime}</th>
                        <td colSpan={8} className="py-3 text-muted">{m.departures.notAvailable}</td>
                      </tr>
                    );
                  const dur = Math.round(r.route.durationSec / 60);
                  const sun = sunOf(r);
                  const top = [...r.heatWarnings].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))[0];
                  const t = r.weather.temperatureRangeC;
                  return (
                    <tr key={o.requestedTime} className="transition-colors hover:bg-surface-2/40">
                      <th scope="row" className="py-3 px-3 text-left font-bold text-ink">{formatTime(r.route.startTime)}</th>
                      <td className="py-3 pr-2 text-muted">{formatTime(r.route.endTime)}</td>
                      <td className="py-3 pr-2 font-medium">
                        {formatDuration(r.route.durationSec)}
                        {minDuration === dur && (
                          <span className="ml-1.5 rounded-full bg-shade-bg px-2 py-0.5 text-[11px] font-bold text-shade border border-shade/20">
                            {m.departures.lowest}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-2">{m.common.minutes(r.exposure.outdoorMin)}</td>
                      <td className="py-3 pr-2 font-medium">
                        {r.exposure.sunUpOutdoorMin === 0 ? m.departures.noSun : m.common.minutes(sun)}
                        {minSun === sun && (
                          <span className="ml-1.5 rounded-full bg-shade-bg px-2 py-0.5 text-[11px] font-bold text-shade border border-shade/20">
                            {m.departures.lowest}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-2">{t ? m.common.range(String(t[0]), m.common.celsius(t[1])) : "—"}</td>
                      <td className="py-3 pr-2">{r.weather.maxUvIndex ?? "—"}</td>
                      <td className="py-3 pr-2 font-bold">{r.weather.maxWbgt ? `${r.weather.maxWbgt.wbgt}` : "—"}</td>
                      <td className="py-3 pr-3 font-semibold">
                        {top ? (
                          <span className={top.level === "danger" ? "text-danger" : top.level === "warning" ? "text-warn" : "text-ink"}>
                            {m.warnings.levels[top.level]}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {result.durationsAreTimeIndependent ? m.results.durationIndependent : m.departures.transitNote}
            {" "}
            {m.departures.sunColumnNote(m.results.exposed, m.results.unknownShade)}
          </p>
        </div>
      )}
    </section>
  );
}
