"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * 結果ページのリンクを共有する。スマホでは OS の共有画面（LINE・メールなど）を開き、
 * 使えないブラウザではリンクをコピーする。
 * 共有されたリンクを30分以内に開くと、サーバーに残っている結果がすぐ表示される。
 */
export function ShareButton({ title }: { title: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title, text: title, url });
        return;
      } catch (e) {
        // 利用者が共有画面を閉じた場合は何もしない
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(m.results.copyThisLink, url);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label={m.results.share}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-bold text-ai transition-colors hover:border-ai/50 hover:bg-info-bg"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
      </svg>
      <span className={copied ? "" : "hidden sm:inline"}>{copied ? m.results.linkCopied : m.results.share}</span>
      <span role="status" className="sr-only">
        {copied ? m.results.linkCopied : ""}
      </span>
    </button>
  );
}
