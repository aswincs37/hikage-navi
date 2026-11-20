import type { Metadata } from "next";
import Link from "next/link";
import { SavedResultsList } from "@/components/SavedResultsList";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.offline.title, robots: { index: false } };
}

/** 保存した結果の一覧。電波が無いときは Service Worker がこの画面を出す */
export default async function OfflinePage() {
  const { m } = await getI18n();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
        <h1 className="text-xl font-bold text-ink">{m.offline.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{m.offline.body}</p>
      </section>
      <section aria-labelledby="saved" className="space-y-2">
        <h2 id="saved" className="text-sm font-bold text-ink">
          {m.offline.savedTitle}
        </h2>
        <SavedResultsList />
        <p className="text-xs leading-relaxed text-muted">{m.offline.note}</p>
      </section>
      <Link href="/" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-ai hover:underline underline-offset-4">
        {m.results.newSearch} <span aria-hidden="true">›</span>
      </Link>
    </div>
  );
}
