import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { m } = await getI18n();
  return (
    <div className="wa-card mx-auto max-w-lg rounded-3xl p-8 sm:p-12 text-center my-12 shadow-sm">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-muted font-black text-xl">
        404
      </div>
      <h1 className="text-2xl font-black text-ink">{m.errorPage.notFoundTitle}</h1>
      <p className="mt-3 text-sm text-muted">{m.errorPage.notFoundBody}</p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-ai px-6 py-3 text-sm font-bold text-ai-ink shadow-sm transition-all hover:brightness-110 active:scale-95"
      >
        <span>{m.common.backHome}</span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
