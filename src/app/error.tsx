"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";

/** 予期しないエラーの画面。内部情報（スタックトレース等）は表示しない */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { m } = useI18n();
  return (
    <div role="alert" className="wa-card mx-auto max-w-lg rounded-3xl p-8 sm:p-12 text-center my-12 shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-bg text-danger text-2xl">
        ⚠️
      </div>
      <h1 className="text-2xl font-black text-ink">{m.errorPage.title}</h1>
      <p className="mt-3 text-sm text-muted">{m.errorPage.body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-ai px-6 py-2.5 text-sm font-bold text-ai-ink shadow-sm transition-all hover:brightness-110 active:scale-95"
        >
          {m.results.retry}
        </button>
        <Link
          href="/"
          className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-bold text-muted shadow-2xs hover:bg-surface-2 hover:text-ink active:scale-95"
        >
          {m.common.backHome}
        </Link>
      </div>
    </div>
  );
}
