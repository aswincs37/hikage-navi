/**
 * Asia/Tokyo の日時処理。
 * 日本は 1951 年以降サマータイムを実施していないため、UTC+09:00 の固定オフセットとして扱う。
 */

export const TOKYO_OFFSET_MIN = 9 * 60;
const OFFSET_MS = TOKYO_OFFSET_MIN * 60_000;

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-07-01T09:00" のようなタイムゾーン無しの文字列を日本時間として解釈する */
export function parseTokyoLocal(s: string): Date | null {
  const m = LOCAL_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec ?? "00"}+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  // 2月30日などの存在しない日付を弾く（Date は繰り上げてしまうため往復で確認）
  if (toTokyoLocalString(date).slice(0, 16) !== `${y}-${mo}-${d}T${h}:${mi}`) return null;
  return date;
}

/** タイムゾーン付き ISO 文字列、または日本時間のローカル文字列を受け付ける */
export function parseDateTime(s: string): Date | null {
  if (LOCAL_RE.test(s)) return parseTokyoLocal(s);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DDTHH:mm:ss"（日本時間、オフセット無し） */
export function toTokyoLocalString(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 19);
}

/** "YYYY-MM-DDTHH:mm:ss+09:00" */
export function toTokyoIso(d: Date): string {
  return `${toTokyoLocalString(d)}+09:00`;
}

export function tokyoDateString(d: Date): string {
  return toTokyoLocalString(d).slice(0, 10);
}

export function tokyoTimeString(d: Date): string {
  return toTokyoLocalString(d).slice(11, 16);
}

export function addSeconds(d: Date, sec: number): Date {
  return new Date(d.getTime() + sec * 1000);
}

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFmt = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

/** 例: 2026年7月1日(水) */
export function formatJaDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** 例: 09:05 */
export function formatJaTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
