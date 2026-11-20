"use client";

import { createContext, useContext } from "react";
import { createI18n, DEFAULT_LOCALE, LOCALE_COOKIE, type I18n, type Locale } from "./index";

const I18nContext = createContext<I18n>(createI18n(DEFAULT_LOCALE));

/** ルートレイアウトでサーバー側の言語を受け取り、クライアントコンポーネントへ渡す */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext value={createI18n(locale)}>{children}</I18nContext>;
}

/** 表示言語を Cookie に1年間保存する（反映はサーバー側の再描画で行う） */
export function saveLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** クライアントコンポーネント用（Provider の外では日本語） */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
