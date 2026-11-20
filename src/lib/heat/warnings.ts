import type { HeatWarning, RouteWeatherSummary } from "@/lib/domain/types";

/**
 * 暑さ・紫外線の注意喚起。ルートの順位付けとは独立に判定し、スコアで打ち消されることはない。
 *
 * - WBGT（公式の予測値）がある場合は環境省の指針区分に従う
 * - WBGT が無い場合、温度・湿度から WBGT を計算することはせず、気温のみの目安として区別して表示する
 * - UV は WHO の区分（6以上「強い」、8以上「非常に強い」）を使う。値はモデル予報
 */

export const TEMP_EXTREME_C = 35; // 猛暑日
export const TEMP_VERY_HOT_C = 31;

export function heatWarnings(w: RouteWeatherSummary): HeatWarning[] {
  const out: HeatWarning[] = [];
  const max = w.maxWbgt;
  if (max) {
    const base = { value: max.wbgt, validTime: max.validTime, source: max.source };
    if (max.level === "danger") out.push({ level: "danger", code: "wbgt_danger", ...base });
    else if (max.level === "severe_warning") out.push({ level: "warning", code: "wbgt_severe_warning", ...base });
    else if (max.level === "warning") out.push({ level: "caution", code: "wbgt_warning", ...base });
    else if (max.level === "caution") out.push({ level: "info", code: "wbgt_caution", ...base });
  }

  const maxTemp = w.temperatureRangeC?.[1];
  const tempSource = w.samples.status === "available" ? w.samples.source : undefined;
  if (maxTemp !== undefined) {
    if (!max && maxTemp >= 25) out.push({ level: "info", code: "wbgt_unavailable" });
    if (maxTemp >= TEMP_EXTREME_C) out.push({ level: "warning", code: "temperature_extreme", value: maxTemp, source: tempSource });
    else if (maxTemp >= TEMP_VERY_HOT_C) out.push({ level: "caution", code: "temperature_very_hot", value: maxTemp, source: tempSource });
  }

  if (w.maxUvIndex !== undefined) {
    if (w.maxUvIndex >= 8) out.push({ level: "caution", code: "uv_very_high", value: w.maxUvIndex, source: tempSource });
    else if (w.maxUvIndex >= 6) out.push({ level: "info", code: "uv_high", value: w.maxUvIndex, source: tempSource });
  }

  const order = { danger: 0, warning: 1, caution: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
