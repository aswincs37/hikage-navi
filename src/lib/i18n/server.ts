import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createI18n, DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type I18n, type Locale } from "./index";

/** リクエストの表示言語（Cookie で指定がなければ日本語） */
export const getLocale = cache(async (): Promise<Locale> => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
});

/** サーバーコンポーネント・generateMetadata 用 */
export async function getI18n(): Promise<I18n> {
  return createI18n(await getLocale());
}
