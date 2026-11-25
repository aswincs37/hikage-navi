"use client";

import type { EvaluatedRoute, VehicleSideExposure } from "@/lib/domain/types";
import { useI18n } from "@/lib/i18n/client";
import { reconcileSideWithMinutes } from "@/lib/solar/side";
import { HeatWarnings } from "./Badges";

export type SeatVerdict =
  | { kind: "left" | "right" | "similar"; leftMin: number; rightMin: number; /** 区間によっては反対側に日が当たる */ changes?: boolean }
  | { kind: "mixed" | "unknown" | "no_sun" };

/**
 * 乗車区間ごとの推定（engine が判定した shadierSide）をまとめ、座席の結論を1つにする。
 * 区間によって結論が食い違う場合でも、全体で片側の日差しが明らかに少なければ（2倍以上・5分以上の差）その側を勧め、
 * 「区間によっては反対側に日が当たる」と添える。差がはっきりしなければ「区間によって変わる」とし、無理に1つに決めない。
 */
export function seatVerdict(sides: VehicleSideExposure[]): SeatVerdict {
  const known = sides.filter((s) => s.shadierSide !== "unknown");
  if (known.length === 0) return { kind: "unknown" };
  const leftMin = known.reduce((a, s) => a + s.leftMin, 0);
  const rightMin = known.reduce((a, s) => a + s.rightMin, 0);
  if (leftMin + rightMin === 0) return { kind: "no_sun" };
  const decided = new Set(known.map((s) => s.shadierSide).filter((x) => x === "left" || x === "right"));
  if (decided.size > 1) {
    const [less, more] = leftMin < rightMin ? (["left", rightMin] as const) : (["right", leftMin] as const);
    const lessMin = Math.min(leftMin, rightMin);
    if (more >= lessMin * 2 && more - lessMin >= 5) return { kind: less, leftMin, rightMin, changes: true };
    return { kind: "mixed" };
  }
  // 区間ごとの結論を合計しても、表示する左右の分数と食い違わないようにする
  const kind = decided.size === 0 ? "similar" : ([...decided][0] as "left" | "right");
  return { kind: reconcileSideWithMinutes(kind, leftMin, rightMin), leftMin, rightMin };
}

/** 上から見た車両の図。おすすめの側を緑（🌿・「おすすめ」）、日が当たる側を橙（☀）で示す */
export function SeatDiagram({ verdict }: { verdict: Extract<SeatVerdict, { leftMin: number }> }) {
  const { m } = useI18n();
  const panel = (side: "left" | "right") => {
    const min = side === "left" ? verdict.leftMin : verdict.rightMin;
    const best = verdict.kind === side;
    const sunny = verdict.kind !== "similar" && !best;
    const label = side === "left" ? m.vehicle.left : m.vehicle.right;
    return (
      <div
        className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-3 text-center ${
          best ? "border-shade bg-shade-bg text-shade" : sunny ? "border-sun-bright/50 bg-sun-bg text-sun" : "border-line bg-surface text-ink"
        }`}
      >
        <span className="text-xs font-bold">{label}</span>
        <span aria-hidden="true" className="text-2xl leading-none">
          {best ? "🌿" : sunny ? "☀️" : "⛅"}
        </span>
        <span className="num text-sm font-bold">{m.quick.sideSun(min)}</span>
        {best && <span className="rounded bg-shade px-2 py-0.5 text-[11px] font-bold text-white">{m.quick.pick}</span>}
      </div>
    );
  };
  return (
    <div
      role="img"
      aria-label={m.quick.seatDiagram(m.quick.sideSun(verdict.leftMin), m.quick.sideSun(verdict.rightMin))}
      className="relative mx-auto w-full max-w-[19rem] rounded-[2rem] border-2 border-line bg-surface-2/70 p-2 pt-7"
    >
      <span className="absolute inset-x-0 top-1.5 flex items-center justify-center gap-1 text-[11px] font-semibold text-muted">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 20V4M5 11l7-7 7 7" />
        </svg>
        {m.quick.forward}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {panel("left")}
        {panel("right")}
      </div>
    </div>
  );
}

/** 整数の割合（%）に丸め、合計がちょうど100になるよう最大剰余法で調整する */
export function percentParts(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p / total) * 100);
  const out = exact.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (rest <= 0) break;
    out[i]!++;
    rest--;
  }
  return out;
}

/** 乗車時間の内訳（左・右・前後真上・日没後）を割合と分で示す。地下鉄など判定できない区間は含めない */
export function SunShare({ sides }: { sides: VehicleSideExposure[] }) {
  const { m } = useI18n();
  const known = sides.filter((s) => s.shadierSide !== "unknown");
  const sum = (k: "leftMin" | "rightMin" | "frontOrBackMin" | "nightMin") => known.reduce((a, s) => a + s[k], 0);
  const mins = [sum("leftMin"), sum("rightMin"), sum("frontOrBackMin"), sum("nightMin")];
  if (mins.every((x) => x === 0)) return null;
  const pct = percentParts(mins);
  const rows = [
    { label: m.quick.shareLeft, color: "bg-sun-bright", text: "text-sun" },
    { label: m.quick.shareRight, color: "bg-side-right", text: "text-side-right" },
    { label: m.quick.shareFrontBack, color: "bg-muted/40", text: "text-muted" },
    { label: m.quick.shareNoSun, color: "bg-ink/80", text: "text-ink" },
  ].map((r, i) => ({ ...r, pct: pct[i]!, min: mins[i]! }));
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-muted">{m.quick.shareTitle}</p>
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2" aria-hidden="true">
        {rows.map((r) => r.pct > 0 && <span key={r.label} className={r.color} style={{ width: `${r.pct}%` }} />)}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 items-start gap-1.5">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${r.color}`} aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-[11px] leading-tight text-muted">{r.label}</dt>
              <dd className="num leading-tight">
                <span className={`text-lg font-black ${r.text}`}>{r.pct}%</span>
                <span className="ml-1 text-xs text-muted">{m.quick.shareMin(r.min)}</span>
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-relaxed text-muted">{m.quick.shareNote}</p>
    </div>
  );
}

/** 立体風の座席アイコン（グラデーションと影で奥行きを出す） */
function Seat3D({ side }: { side: "left" | "right" }) {
  const gid = `seat-${side}`;
  return (
    <svg viewBox="0 0 64 64" className={`h-16 w-16 shrink-0 ${side === "right" ? "-scale-x-100" : ""}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${gid}-back`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#cfe9df" />
        </linearGradient>
        <linearGradient id={`${gid}-cush`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4fbf8" />
          <stop offset="1" stopColor="#a9d6c6" />
        </linearGradient>
      </defs>
      {/* 影 */}
      <ellipse cx="34" cy="58" rx="20" ry="3.5" fill="rgba(0,0,0,0.22)" />
      {/* ヘッドレスト */}
      <rect x="16" y="4" width="18" height="10" rx="5" fill={`url(#${gid}-back)`} />
      <rect x="22" y="13" width="2.5" height="5" fill="#bfe0d4" />
      <rect x="26" y="13" width="2.5" height="5" fill="#bfe0d4" />
      {/* 背もたれ（側面の厚み → 正面） */}
      <path d="M14 18 Q12 17 12 20 L10 44 Q10 47 14 47 L18 47 Z" fill="#8cc5b1" />
      <path d="M16 18 Q16 16 19 16 L33 16 Q36 16 36 19 L38 44 Q38 47 35 47 L16 47 Q13 47 13 44 Z" fill={`url(#${gid}-back)`} />
      <path d="M20 22 L32 22" stroke="#bfe0d4" strokeWidth="2" strokeLinecap="round" />
      {/* 座面 */}
      <path d="M13 45 Q13 41 18 41 L48 41 Q54 41 54 46 L54 49 Q54 52 49 52 L17 52 Q13 52 13 49 Z" fill={`url(#${gid}-cush)`} />
      <path d="M18 41 L48 41 Q53 41 54 45 L14 45 Q14 41 18 41 Z" fill="#ffffff" opacity="0.7" />
      {/* 脚 */}
      <rect x="20" y="52" width="3" height="5" rx="1" fill="#6aa892" />
      <rect x="44" y="52" width="3" height="5" rx="1" fill="#6aa892" />
    </svg>
  );
}

/** 座席の結論を大きく見せる帯。色はおすすめ＝日陰の緑（赤はこのアプリでは暑さの「危険」に使うため避ける） */
function SeatHero({ side, headline }: { side: "left" | "right"; headline: string }) {
  const { m } = useI18n();
  return (
    <div className="relative overflow-hidden rounded-lg bg-shade p-4 text-white">
      <span
        className={`pointer-events-none absolute inset-y-0 ${side === "left" ? "left-0" : "right-0"} w-1.5 bg-white/70`}
        aria-hidden="true"
      />
      <p className="sr-only">{headline}</p>
      <div className={`relative flex items-center gap-3 ${side === "right" ? "flex-row-reverse text-right" : ""}`} aria-hidden="true">
        <Seat3D side={side} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-widest text-white/85 uppercase">{m.quick.bestSeat}</p>
          <p className="flex items-baseline gap-1.5 leading-none whitespace-nowrap">
            <span className={`text-[2.6rem] font-black tracking-tight [text-shadow:0_3px_0_rgba(0,0,0,0.25)]`}>
              {side === "left" ? "◀ " : ""}
              {m.quick.sideBig[side]}
              {side === "right" ? " ▶" : ""}
            </span>
            <span className={`text-base font-bold text-white/90`}>{m.quick.seatSuffix}</span>
          </p>
          <p className="mt-1.5 text-xs font-semibold text-white/85">🌿 {m.quick.shadierSideNote}</p>
        </div>
      </div>
    </div>
  );
}

function VehicleAnswer({ sides }: { sides: VehicleSideExposure[] }) {
  const { m } = useI18n();
  const v = seatVerdict(sides);
  const headline = {
    left: m.quick.seatLeft,
    right: m.quick.seatRight,
    similar: m.quick.seatSimilar,
    mixed: m.quick.seatMixed,
    unknown: m.quick.seatUnknown,
    no_sun: m.quick.seatNoSun,
  }[v.kind];
  return (
    <div className="space-y-3">
      {v.kind === "left" || v.kind === "right" ? (
        <SeatHero side={v.kind} headline={headline} />
      ) : (
        <p className="flex items-center gap-2 text-2xl font-black leading-tight text-ink">
          <span aria-hidden="true">🪑</span>
          <span>{headline}</span>
        </p>
      )}
      {"leftMin" in v && v.kind !== "similar" && (
        <p className="num text-sm text-muted">
          {m.quick.oppositeSun(v.kind === "left" ? m.vehicle.right : m.vehicle.left, v.kind === "left" ? v.rightMin : v.leftMin)}
        </p>
      )}
      {"changes" in v && v.changes && <p className="rounded-md bg-warn-bg px-3 py-2 text-xs font-medium text-warn">{m.quick.seatChangesNote}</p>}
      {"leftMin" in v && <SeatDiagram verdict={v} />}
      <SunShare sides={sides} />
    </div>
  );
}

function OutdoorAnswer({ r }: { r: EvaluatedRoute }) {
  const { m } = useI18n();
  const e = r.exposure;
  if (e.sunUpOutdoorMin === 0) {
    return (
      <p className="flex items-center gap-2 text-xl font-black text-ink">
        <span aria-hidden="true">🌙</span>
        <span>{m.quick.walkNoSun}</span>
      </p>
    );
  }
  // 日差し0分でも、判定できない時間しかないなら「日差しが少ない」とは言わない
  const allUnknown = e.potentialSunMin === 0 && e.shadedMin === 0 && e.unknownShadeMin > 0;
  const headline = allUnknown
    ? m.quick.shadeUnknown
    : e.potentialSunMin === 0 && e.unknownShadeMin === 0
      ? m.quick.walkLowSun
      : m.quick.walkSun(e.potentialSunMin);
  const chips = [
    e.shadedMin > 0 && { key: "shade", text: m.quick.shadeChip(e.shadedMin), cls: "bg-shade-bg text-shade", icon: "🌿" },
    e.unknownShadeMin > 0 && { key: "unknown", text: m.quick.unknownChip(e.unknownShadeMin), cls: "bg-unknown-bg text-unknown", icon: "❔" },
  ].filter((x): x is { key: string; text: string; cls: string; icon: string } => Boolean(x));
  return (
    <div className="space-y-2">
      <p className="num text-xs font-semibold text-muted">{m.quick.outdoorOf(e.outdoorMin)}</p>
      <p className="num flex items-center gap-2 text-2xl font-black leading-tight text-ink">
        <span aria-hidden="true">{allUnknown ? "❔" : "☀️"}</span>
        <span>{headline}</span>
      </p>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.key} className={`num inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-bold ${c.cls}`}>
              <span aria-hidden="true">{c.icon}</span>
              {c.text}
            </li>
          ))}
        </ul>
      )}
      {e.unknownShadeMin > 0 && <p className="text-xs leading-relaxed text-muted">{m.quick.shadeUnknownNote}</p>}
    </div>
  );
}

interface Props {
  r: EvaluatedRoute;
  /** 「おすすめのルート」「ルート2」など、どの候補の結論かを示す見出し */
  label: string;
}

/**
 * 検索結果の最上部に出す「ひと目でわかる結論」。
 * 乗り物は座席の左右、屋外は日差しの時間を大きく1行で示し、暑さの警告を添える。
 */
export function AnswerCard({ r, label }: Props) {
  const { m, formatDuration, formatTime } = useI18n();
  const hasVehicle = r.vehicleSides.length > 0;
  const hasOutdoor = r.exposure.outdoorMin > 0;
  return (
    <section aria-label={`${m.quick.answer}: ${label}`} className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
          <span aria-hidden="true" className="text-shade">✓</span>
          {m.quick.answer}・{label}
        </span>
        <span className="num text-xs font-semibold text-muted">
          {formatTime(r.route.startTime)}→{formatTime(r.route.endTime)}・{formatDuration(r.route.durationSec)}
        </span>
      </div>
      <div className="space-y-4 p-4">
        {hasVehicle && <VehicleAnswer sides={r.vehicleSides} />}
        {r.route.mode === "train" && r.route.source?.kind === "estimate" && (
          <p className="text-xs leading-relaxed text-muted">ⓘ {m.quick.trainEstimate}</p>
        )}
        {hasVehicle && hasOutdoor && <hr className="border-line/70" />}
        {hasOutdoor && <OutdoorAnswer r={r} />}
        {r.heatWarnings.length > 0 && <HeatWarnings warnings={r.heatWarnings} compact />}
      </div>
    </section>
  );
}
