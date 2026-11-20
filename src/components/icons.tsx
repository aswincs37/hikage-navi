import type { TransportMode } from "@/lib/domain/types";

/** 移動手段・警告のアイコン（装飾用。意味は必ず文字でも示す） */
const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };

export function ModeIcon({ mode }: { mode: TransportMode }) {
  switch (mode) {
    case "train":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="14" rx="3" />
          <path d="M5 10h14M8 21l2-4M16 21l-2-4" />
          <circle cx="9" cy="13.5" r="0.8" fill="currentColor" />
          <circle cx="15" cy="13.5" r="0.8" fill="currentColor" />
        </svg>
      );
    case "bus":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="15" rx="2.5" />
          <path d="M4 11h16M7 18v3M17 18v3M8 6h8" />
          <circle cx="8" cy="14.5" r="0.8" fill="currentColor" />
          <circle cx="16" cy="14.5" r="0.8" fill="currentColor" />
        </svg>
      );
    case "car":
      return (
        <svg {...common}>
          <path d="M3 16v-3l2.5-5h13L21 13v3H3zM6 16v3M18 16v3M3 13h18" />
          <circle cx="7" cy="14.5" r="0.8" fill="currentColor" />
          <circle cx="17" cy="14.5" r="0.8" fill="currentColor" />
        </svg>
      );
  }
}

export function WarningIcon({ level }: { level: "danger" | "warning" | "caution" | "info" }) {
  if (level === "info")
    return (
      <svg {...common} width={18} height={18}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.5" />
      </svg>
    );
  return (
    <svg {...common} width={18} height={18}>
      <path d="M12 3l9.5 17h-19L12 3z" />
      <path d="M12 10v4.5M12 17.5v.5" />
      {level === "danger" && <path d="M12 3l9.5 17h-19L12 3z" fill="currentColor" opacity="0.15" />}
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg {...common} width={18} height={18}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function LocateIcon() {
  return (
    <svg {...common} width={18} height={18}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}
