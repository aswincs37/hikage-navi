"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n";
import { saveLocale, useI18n } from "@/lib/i18n/client";

/** 日本語 / English の切り替え。Cookie に保存し、サーバー側の表示を再取得する */
export function LanguageSwitch() {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    saveLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={m.nav.language}
      className={`inline-flex shrink-0 items-center rounded-lg border border-white/40 p-0.5 text-xs font-semibold transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            lang={l}
            aria-pressed={active}
            disabled={pending}
            onClick={() => choose(l)}
            className={`min-h-8 rounded-md px-2.5 transition-colors sm:px-3 ${
              active ? "bg-white text-ai" : "text-white/85 hover:bg-white/15 hover:text-white"
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
