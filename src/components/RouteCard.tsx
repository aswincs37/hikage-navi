"use client";

import Link from "next/link";
import type { EvaluatedRoute, RankedRoute, RankingReason, RouteWeatherSummary, VehicleSideExposure } from "@/lib/domain/types";
import type { Messages } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { seatVerdict } from "./AnswerCard";
import { DataKindBadge } from "./Badges";

export function reasonText(r: RankingReason, m: Messages): string | null {
  if (r.code === "only_option") return null;
  return m.reasons[r.code](r.diff ?? 0);
}

export function explanation(ranked: RankedRoute | undefined, routeCount: number, m: Messages): string | null {
  if (!ranked || ranked.rank !== 1) return null;
  if (routeCount <= 1) return m.reasons.only_option;
  const parts = ranked.reasons.map((x) => reasonText(x, m)).filter((x): x is string => x !== null);
  return parts.length ? m.reasons.summary(parts) : m.reasons.noClearReason;
}

/** 日陰・日差し・不明の内訳（棒グラフ＋数値。色だけに頼らない） */
export function ExposureBar({ r }: { r: EvaluatedRoute }) {
  const { m } = useI18n();
  const e = r.exposure;
  if (e.outdoorMin === 0) return null;
  if (e.sunUpOutdoorMin === 0) return <p className="text-sm text-muted">{m.results.sunDown}</p>;
  const total = e.shadedMin + e.potentialSunMin + e.unknownShadeMin || 1;
  const parts = [
    { key: "shaded", min: e.shadedMin, label: m.results.shaded, cls: "bg-shade", pattern: "" },
    { key: "exposed", min: e.potentialSunMin, label: m.results.exposed, cls: "bg-sun-bright", pattern: "" },
    {
      key: "unknown",
      min: e.unknownShadeMin,
      label: m.results.unknownShade,
      cls: "bg-unknown/60",
      pattern: "bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,.45)_4px_8px)]",
    },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
        {parts.map((p) =>
          p.min > 0 ? <div key={p.key} className={`${p.cls} ${p.pattern} transition-all duration-300`} style={{ width: `${(p.min / total) * 100}%` }} /> : null,
        )}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {parts.map((p) => (
          <div key={p.key} className="rounded-lg border border-line bg-surface-2 p-2.5">
            <dt className="text-muted">{p.label}</dt>
            <dd className="num font-bold text-ink mt-0.5">{m.common.approx}{m.common.minutes(p.min)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null }) {
  const { m } = useI18n();
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-bold text-ink mt-0.5">{value ?? <span className="font-normal text-muted">{m.results.noData}</span>}</dd>
    </div>
  );
}

export function WeatherSummary({ w }: { w: RouteWeatherSummary }) {
  const { m } = useI18n();
  const source = w.samples.status === "available" ? w.samples.source : null;
  const range = w.temperatureRangeC;
  const temp = range ? (range[0] === range[1] ? m.common.celsius(range[0]) : m.common.range(m.common.celsius(range[0]), m.common.celsius(range[1]))) : null;
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Item label={m.results.temperature} value={temp} />
        <Item label={m.results.uvShort} value={w.maxUvIndex !== undefined ? String(Math.round(w.maxUvIndex * 10) / 10) : null} />
        <Item label={m.results.precip} value={w.maxPrecipitationProbabilityPct !== undefined ? m.common.percent(w.maxPrecipitationProbabilityPct) : null} />
        <Item label={m.results.cloud} value={w.meanCloudCoverPct !== undefined ? m.common.percent(w.meanCloudCoverPct) : null} />
        <Item
          label="WBGT"
          value={w.maxWbgt ? `${w.maxWbgt.wbgt}${m.common.paren(m.wbgtLevels[w.maxWbgt.level])}` : null}
        />
      </dl>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {source ? (
          <>
            <DataKindBadge kind={source.kind} /> {m.results.weatherSource}
          </>
        ) : (
          <>
            <DataKindBadge kind="unavailable" />
            {w.samples.status === "unavailable" && m.unavailableReasons[w.samples.reason]}
          </>
        )}
        {w.wbgt.status === "available" ? (
          <>
            <DataKindBadge kind="official_forecast" /> {m.results.wbgtSource}
          </>
        ) : (
          <span>WBGT: {m.unavailableReasons[w.wbgt.reason]}</span>
        )}
      </p>
    </div>
  );
}

export function VehicleSideSummary({ sides }: { sides: VehicleSideExposure[] }) {
  const { m } = useI18n();
  if (sides.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {sides.map((s) => (
        <li key={s.legIndex} className="rounded-lg border border-line bg-surface-2 p-2.5">
          {s.shadierSide === "left"
            ? m.vehicle.shadierLeft
            : s.shadierSide === "right"
              ? m.vehicle.shadierRight
              : s.shadierSide === "similar"
                ? m.vehicle.similar
                : m.vehicle.unknown}
          {s.shadierSide !== "unknown" && (
            <span className="num ml-1 text-xs text-muted">
              {m.common.paren(`${m.vehicle.left} ${m.common.approx}${m.common.minutes(s.leftMin)} / ${m.vehicle.right} ${m.common.approx}${m.common.minutes(s.rightMin)}`)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** カード用の天気の要約（1行） */
function WeatherLine({ w }: { w: RouteWeatherSummary }) {
  const { m } = useI18n();
  const range = w.temperatureRangeC;
  const items = [
    range && `🌡️ ${range[0] === range[1] ? m.common.celsius(range[0]) : m.common.range(String(range[0]), m.common.celsius(range[1]))}`,
    w.maxUvIndex !== undefined && `☀️ ${m.results.uvShort} ${Math.round(w.maxUvIndex * 10) / 10}`,
    w.maxPrecipitationProbabilityPct !== undefined && `☔ ${m.common.percent(w.maxPrecipitationProbabilityPct)}`,
    w.maxWbgt && `WBGT ${w.maxWbgt.wbgt}${m.common.paren(m.wbgtLevels[w.maxWbgt.level])}`,
  ].filter((x): x is string => Boolean(x));
  if (items.length === 0) return <p className="text-xs text-muted">{m.results.weather}: {m.results.noData}</p>;
  return (
    <p className="num flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
      {items.map((x) => (
        <span key={x}>{x}</span>
      ))}
    </p>
  );
}

interface Props {
  r: EvaluatedRoute;
  ranked?: RankedRoute;
  routeCount: number;
  selected: boolean;
  onSelect: () => void;
  detailsHref: string;
  /** 「早」「楽」の印 */
  tags?: RouteTag[];
}

const HEAT_ORDER = ["danger", "warning", "caution", "info"] as const;
const HEAT_CHIP = {
  danger: "bg-danger-bg text-danger border-danger/40",
  warning: "bg-warn-bg text-warn border-warn/40",
  caution: "bg-warn-bg/70 text-warn border-warn/30",
  info: "bg-info-bg text-ink border-line",
};

/** カード用の要点チップ（日差し・日陰・座席・暑さ）。色だけでなくアイコンと文字で示す */
function KeyChips({ r }: { r: EvaluatedRoute }) {
  const { m } = useI18n();
  const e = r.exposure;
  const seat = seatVerdict(r.vehicleSides);
  const chips: { key: string; icon: string; text: string; cls: string }[] = [];
  if (seat.kind === "left" || seat.kind === "right")
    chips.push({ key: "seat", icon: "🪑", text: seat.kind === "left" ? m.quick.seatChipLeft : m.quick.seatChipRight, cls: "bg-shade-bg text-shade border-shade/30" });
  if (e.outdoorMin > 0 && e.sunUpOutdoorMin > 0) {
    if (e.potentialSunMin > 0 || e.unknownShadeMin === 0)
      chips.push({ key: "sun", icon: "☀️", text: m.quick.walkSun(e.potentialSunMin), cls: "bg-sun-bg text-sun border-sun-bright/30" });
    if (e.unknownShadeMin > 0) chips.push({ key: "unknown", icon: "❔", text: m.quick.unknownChip(e.unknownShadeMin), cls: "bg-unknown-bg text-unknown border-line" });
    if (e.shadedMin > 0) chips.push({ key: "shade", icon: "🌿", text: m.quick.shadeChip(e.shadedMin), cls: "bg-shade-bg text-shade border-shade/30" });
  }
  const top = HEAT_ORDER.map((lv) => r.heatWarnings.find((w) => w.level === lv && w.code !== "wbgt_unavailable")).find(Boolean);
  if (top) chips.push({ key: "heat", icon: "⚠️", text: m.warnings.levels[top.level], cls: HEAT_CHIP[top.level] });
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={c.key} className={`num inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${c.cls}`}>
          <span aria-hidden="true">{c.icon}</span>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

/** 乗換案内アプリのような「早」「楽」の印（候補どうしを比べて付ける） */
export type RouteTag = "fast" | "easy";

/** 検索結果のルートカード（要点のみ。詳細はルート詳細ページで表示する） */
export function RouteCard({ r, ranked, routeCount, selected, onSelect, detailsHref, tags = [] }: Props) {
  const { m, formatDuration, formatDistance, formatTime } = useI18n();
  const route = r.route;
  const recommended = ranked?.rank === 1 && routeCount > 1;
  const why = explanation(ranked, routeCount, m);
  const titleId = `route-${route.id}-title`;
  const facts = [
    route.transfers !== undefined && m.results.transfersCount(route.transfers),
    formatDistance(route.distanceM),
    route.walkingSec > 0 && `${m.results.walking} ${formatDuration(route.walkingSec)}`,
  ].filter((x): x is string => Boolean(x));
  return (
    <article
      aria-labelledby={titleId}
      onClick={onSelect}
      className={`cursor-pointer overflow-hidden rounded-xl border bg-surface transition-colors ${
        selected ? "border-ai shadow-sm ring-1 ring-ai" : "border-line hover:border-ai-mid"
      }`}
    >
      <header className={`flex items-center justify-between gap-2 border-b px-4 py-2 ${selected ? "border-ai/30 bg-ai-light" : "border-line bg-surface-2"}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold text-ink">{m.quick.routeN(ranked?.rank ?? 1)}</span>
          {recommended && (
            <span className="rounded bg-shade px-1.5 py-0.5 text-[11px] font-bold text-white">{m.results.recommended}</span>
          )}
          {tags.map((t) => (
            <span
              key={t}
              title={m.results.tagTitle[t]}
              className={`grid h-6 min-w-6 place-items-center rounded px-1 text-xs font-black text-white ${t === "fast" ? "bg-danger" : "bg-ai"}`}
            >
              {m.results.tagShort[t]}
              <span className="sr-only">{m.common.paren(m.results.tagTitle[t])}</span>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          aria-pressed={selected}
          aria-label={selected ? m.results.shownOnMap : m.results.showOnMap}
          className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-bold transition-colors ${
            selected ? "bg-ai text-ai-ink" : "border border-line bg-surface text-muted hover:border-ai hover:text-ai"
          }`}
        >
          {selected ? `✓ ${m.results.shownOnMap}` : m.results.showOnMap}
        </button>
      </header>

      <div className="space-y-2.5 px-4 py-3">
        <div>
          <h3 id={titleId} className="num flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ink">
            <span className="text-xl font-bold tracking-tight">
              {formatTime(route.startTime)}
              <span className="mx-1 text-sm font-medium text-muted">→</span>
              {formatTime(route.endTime)}
            </span>
            <span className="text-base font-bold text-ai">{formatDuration(route.durationSec)}</span>
          </h3>
          <p className="num text-xs text-muted">{facts.join(" ／ ")}</p>
        </div>

        {route.legs.length > 0 && (
          <ol className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-xs">
            {route.legs.map((l, i) => (
              <li key={i} className="flex shrink-0 items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-muted">›</span>}
                <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-medium ${l.outdoor ? "border-sun-bright/40 bg-sun-bg text-sun" : "border-ai/25 bg-ai-light text-ai"}`}>
                  {m.legModes[l.mode]}
                  {l.routeName ? ` ${l.routeName}` : ""} <span className="num">{formatDuration(l.durationSec)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}

        <KeyChips r={r} />
        <WeatherLine w={r.weather} />

        {why && (
          <p className="rounded-md border-l-4 border-shade bg-shade-bg px-3 py-2 text-xs leading-relaxed text-ink">{why}</p>
        )}
      </div>

      <Link
        href={detailsHref}
        onClick={(e) => e.stopPropagation()}
        className="flex min-h-11 items-center justify-between border-t border-line px-4 text-sm font-bold text-ai transition-colors hover:bg-ai-light"
      >
        <span>{m.results.details}</span>
        <span aria-hidden="true">›</span>
      </Link>
    </article>
  );
}
