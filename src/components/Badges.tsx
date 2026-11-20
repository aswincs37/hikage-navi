"use client";

import type { DataKind, HeatWarning, ProviderNotice } from "@/lib/domain/types";
import type { Messages } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { WarningIcon } from "./icons";

const KIND_STYLE: Record<DataKind, string> = {
  official_forecast: "border-ai/40 bg-info-bg/60 text-ai",
  official_observation: "border-ai/40 bg-info-bg/60 text-ai",
  provider_forecast: "border-line bg-surface-2/50 text-muted",
  provider_place: "border-line bg-surface-2/50 text-muted",
  provider_route: "border-line bg-surface-2/50 text-muted",
  provider_timetable: "border-line bg-surface-2/50 text-muted",
  astronomical: "border-line bg-surface-2/50 text-muted",
  modelled: "border-line bg-surface-2/50 text-muted",
  estimate: "border-line bg-surface-2/50 text-muted",
  unavailable: "border-dashed border-line bg-surface text-muted",
};

/** データの種類（公式予報・モデル予報・天文計算・推定など）を示すラベル */
export function DataKindBadge({ kind }: { kind: DataKind }) {
  const { m } = useI18n();
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 shadow-2xs ${KIND_STYLE[kind]}`}
      title={m.dataKindHelp[kind]}
    >
      {m.dataKinds[kind]}
    </span>
  );
}

const LEVEL_STYLE = {
  danger: "border-danger/60 bg-danger-bg text-danger shadow-xs",
  warning: "border-warn/60 bg-warn-bg text-warn shadow-xs",
  caution: "border-warn/40 bg-warn-bg/70 text-warn shadow-2xs",
  info: "border-line bg-info-bg text-ink shadow-2xs",
};

export function warningText(w: HeatWarning, m: Messages): string {
  const v = w.value ?? 0;
  switch (w.code) {
    case "wbgt_danger":
    case "wbgt_severe_warning":
    case "wbgt_warning":
    case "wbgt_caution":
    case "temperature_extreme":
    case "temperature_very_hot":
    case "uv_very_high":
    case "uv_high":
      return m.warnings[w.code](Math.round(v * 10) / 10);
    case "wbgt_unavailable":
      return m.warnings.wbgt_unavailable;
  }
}

/** 暑さ・紫外線の注意喚起。色だけでなく、アイコンと「危険」「警戒」などの文字で示す */
export function HeatWarnings({ warnings, compact }: { warnings: HeatWarning[]; compact?: boolean }) {
  const { m } = useI18n();
  if (warnings.length === 0) return null;
  const serious = warnings.some((w) => w.level === "danger" || w.level === "warning");
  return (
    <ul className="space-y-2" role={serious ? "alert" : undefined}>
      {warnings.map((w) => (
        <li
          key={w.code}
          className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm font-medium ${LEVEL_STYLE[w.level]}`}
        >
          <span className="mt-0.5 shrink-0">
            <WarningIcon level={w.level} />
          </span>
          <span className="leading-snug">
            <strong className="mr-1">【{m.warnings.levels[w.level]}】</strong>
            {warningText(w, m)}
            {!compact && w.source && (
              <span className="ml-1.5 inline-block align-middle">
                <DataKindBadge kind={w.source.kind} />
              </span>
            )}
          </span>
        </li>
      ))}
      {!compact && serious && (
        <li className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden="true">※</span>
          <span>{m.warnings.shadeDisclaimer}</span>
        </li>
      )}
    </ul>
  );
}

export function NoticeList({ notices }: { notices: ProviderNotice[] }) {
  const { m, noticeText } = useI18n();
  if (notices.length === 0) return null;
  return (
    <section aria-label={m.noticesLabel} className="rounded-2xl border border-line bg-surface-2/50 p-4 text-sm shadow-xs">
      <ul className="space-y-2">
        {notices.map((n) => (
          <li key={`${n.capability}-${n.messageCode}`} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/20 text-xs font-bold text-muted"
            >
              {n.status === "demo_endpoint" ? "i" : "!"}
            </span>
            <span className="text-xs leading-relaxed text-muted sm:text-sm">{noticeText(n.messageCode)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
