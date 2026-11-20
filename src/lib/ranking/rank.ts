import type {
  EvaluatedRoute,
  MetricKey,
  Preference,
  RankedRoute,
  RankingReason,
  RankingResult,
} from "@/lib/domain/types";

/**
 * 希望条件に基づく透明な重み付き順位付け。
 *
 * - 各指標を候補内で最小〜最大に正規化（0=最良, 1=最悪）し、重み付き平均で並べる。
 * - 一部の候補で指標が欠けている場合、その候補は当該指標を「最も不利」として扱う（データ欠損で有利にならない）。
 * - 全候補で欠けている指標・対象外の指標は使わず、理由とともに ignoredPreferences に入れる。
 * - スコアは候補同士の相対比較であり、安全性や快適さを保証するものではない。暑さの警告とは独立。
 */

type Weights = Partial<Record<MetricKey, number>>;

const PREFERENCE_WEIGHTS: Record<Preference, Weights> = {
  balanced: { durationMin: 1, outdoorMin: 0.5, potentialSunMin: 0.5 },
  minimise_sun: { potentialSunMin: 2 },
  prefer_shade: { shadedShare: 2 },
  minimise_outdoor: { outdoorMin: 2 },
  minimise_time: { durationMin: 2 },
  reduce_walking: { walkingMin: 2 },
  fewer_transfers: { transfers: 2 },
  scenic: {},
};

/** 指標が「大きいほど良い」か */
const HIGHER_IS_BETTER: Partial<Record<MetricKey, boolean>> = { shadedShare: true };

/** 説明文に使う最小の差（これ未満は「差が無い」とみなす） */
const MEANINGFUL_DIFF: Record<MetricKey, number> = {
  durationMin: 2,
  outdoorMin: 2,
  walkingMin: 2,
  potentialSunMin: 2,
  shadedShare: 0.1,
  transfers: 1,
};

/**
 * 経路から指標を取り出す。値が無い場合は null（0 で代用しない）。
 * potentialSunMin は「日陰と推定されなかった、太陽が出ている屋外時間」（日陰不明の時間を含む上限値）。
 */
export function routeMetrics(r: EvaluatedRoute): Record<MetricKey, number | null> {
  const e = r.exposure;
  const shadeKnown = e.sunUpOutdoorMin > 0 && e.shadeCoverage > 0;
  return {
    durationMin: r.route.durationSec / 60,
    outdoorMin: e.outdoorMin,
    walkingMin: r.route.walkingSec / 60,
    potentialSunMin: e.sunUpOutdoorMin - e.shadedMin,
    shadedShare: shadeKnown ? e.shadedMin / e.sunUpOutdoorMin : null,
    transfers: r.route.transfers ?? null,
  };
}

export function rankRoutes(routes: EvaluatedRoute[], preferences: Preference[]): RankingResult {
  const prefs: Preference[] = preferences.length > 0 ? [...new Set(preferences)] : ["balanced"];
  const metrics = routes.map(routeMetrics);
  const weights: Weights = {};
  const ignored: RankingResult["ignoredPreferences"] = [];
  const applied: Preference[] = [];

  for (const p of prefs) {
    const w = PREFERENCE_WEIGHTS[p];
    const keys = Object.keys(w) as MetricKey[];
    if (keys.length === 0) {
      ignored.push({ preference: p, reason: "no_data" });
      continue;
    }
    const usable = keys.filter((k) => metrics.some((m) => m[k] !== null));
    if (usable.length === 0) {
      ignored.push({ preference: p, reason: p === "fewer_transfers" ? "not_applicable" : "no_data" });
      continue;
    }
    applied.push(p);
    for (const k of usable) weights[k] = (weights[k] ?? 0) + w[k]!;
  }

  const used = Object.keys(weights) as MetricKey[];
  const totalWeight = used.reduce((s, k) => s + weights[k]!, 0);

  if (routes.length === 0) return { ranked: [], appliedPreferences: applied, ignoredPreferences: ignored, weights };

  // 正規化（0=最良, 1=最悪）
  const normalised = metrics.map(() => ({}) as Partial<Record<MetricKey, number>>);
  const missing = metrics.map(() => [] as MetricKey[]);
  for (const k of used) {
    const vals = metrics.map((m) => m[k]).filter((v): v is number => v !== null);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    metrics.forEach((m, i) => {
      const v = m[k];
      if (v === null) {
        normalised[i]![k] = 1;
        missing[i]!.push(k);
      } else if (max === min) {
        normalised[i]![k] = 0;
      } else {
        const n = (v - min) / (max - min);
        normalised[i]![k] = HIGHER_IS_BETTER[k] ? 1 - n : n;
      }
    });
  }

  const scored = routes.map((r, i) => {
    const cost = totalWeight > 0 ? used.reduce((s, k) => s + weights[k]! * normalised[i]![k]!, 0) / totalWeight : 0;
    return { i, id: r.route.id, cost, duration: metrics[i]!.durationMin! };
  });
  scored.sort((a, b) => a.cost - b.cost || a.duration - b.duration);

  const ranked: RankedRoute[] = scored.map((s, rank) => ({
    routeId: s.id,
    rank: rank + 1,
    score: routes.length > 1 && totalWeight > 0 ? Math.round((1 - s.cost) * 100) : null,
    metricsUsed: used,
    metricsMissing: missing[s.i]!,
    reasons: [],
  }));

  if (routes.length === 1) {
    ranked[0]!.reasons.push({ code: "only_option" });
  } else {
    const top = scored[0]!;
    const second = scored[1]!;
    ranked[0]!.reasons = explain(metrics[top.i]!, metrics[second.i]!, used, missing[top.i]!);
  }

  return { ranked, appliedPreferences: applied, ignoredPreferences: ignored, weights };
}

/** 1位の候補が2位より優れている点のうち、意味のある差があるものだけを説明に使う */
function explain(
  top: Record<MetricKey, number | null>,
  second: Record<MetricKey, number | null>,
  used: MetricKey[],
  topMissing: MetricKey[],
): RankingReason[] {
  const reasons: RankingReason[] = [];
  const codes: Record<MetricKey, RankingReason["code"]> = {
    durationMin: "shorter_duration",
    outdoorMin: "less_outdoor",
    walkingMin: "less_walking",
    potentialSunMin: "less_sun",
    shadedShare: "more_shade",
    transfers: "fewer_transfers",
  };
  for (const k of used) {
    if (topMissing.includes(k)) continue;
    const a = top[k];
    const b = second[k];
    if (a === null || b === null) continue;
    const diff = HIGHER_IS_BETTER[k] ? a - b : b - a;
    if (diff >= MEANINGFUL_DIFF[k]) {
      reasons.push({
        code: codes[k],
        diff: k === "shadedShare" ? Math.round(diff * 100) : Math.round(diff),
        unit: k === "shadedShare" ? "pct" : k === "transfers" ? "count" : "min",
      });
    }
  }
  return reasons;
}
