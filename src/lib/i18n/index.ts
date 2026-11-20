import { en } from "./en";
import { ja, type Messages } from "./ja";
import { formatJaDate, formatJaTime } from "@/lib/time/tokyo";

export type { Messages };

export const LOCALES = ["ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

/** 表示言語を保存する Cookie 名（言語切り替えボタンで設定する） */
export const LOCALE_COOKIE = "locale";

/** 切り替えボタンの表示名（各言語の自称で表示する） */
export const LOCALE_LABELS: Record<Locale, string> = { ja: "日本語", en: "EN" };

const catalogues: Record<Locale, Messages> = { ja, en };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function getMessages(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalogues[locale];
}

export interface I18n {
  locale: Locale;
  m: Messages;
  formatDuration: (sec: number) => string;
  formatDistance: (meters: number) => string;
  /** 日本時間の日付（例: 2026年7月1日(水) / Wed, Jul 1, 2026） */
  formatDate: (iso: string) => string;
  /** 日本時間の時刻（例: 09:05） */
  formatTime: (iso: string) => string;
  noticeText: (code: string) => string;
  validationText: (code: string) => string;
}

const enDateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "short", day: "numeric", weekday: "short" });
const enTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function build(locale: Locale): I18n {
  const m = catalogues[locale];
  return {
    locale,
    m,
    formatDuration(sec) {
      const total = Math.round(sec / 60);
      if (total < 60) return m.common.minutes(total);
      return m.common.hoursMinutes(Math.floor(total / 60), total % 60);
    },
    formatDistance(meters) {
      if (meters < 1000) return m.common.m(Math.round(meters / 10) * 10);
      return m.common.km(Math.round(meters / 100) / 10);
    },
    formatDate: locale === "ja" ? formatJaDate : (iso) => enDateFmt.format(new Date(iso)),
    formatTime: locale === "ja" ? formatJaTime : (iso) => enTimeFmt.format(new Date(iso)),
    noticeText: (code) => m.notices[code] ?? m.results.genericError,
    validationText: (code) => m.validation[code] ?? m.validation.fallback!,
  };
}

const instances = Object.fromEntries(LOCALES.map((l) => [l, build(l)])) as Record<Locale, I18n>;

/** 言語ごとの文言と書式関数。サーバーでは getI18n()、クライアントでは useI18n() から取得する */
export function createI18n(locale: Locale = DEFAULT_LOCALE): I18n {
  return instances[locale];
}
