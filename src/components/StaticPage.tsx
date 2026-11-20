import { getI18n } from "@/lib/i18n/server";

export async function StaticPage({ title, draft, updated, children }: { title: string; draft?: boolean; updated?: string; children: React.ReactNode }) {
  const { m } = await getI18n();
  return (
    <article className="wa-card mx-auto max-w-3xl rounded-3xl p-6 sm:p-10 shadow-sm">
      <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">{title}</h1>
      {draft && (
        <p role="note" className="mt-4 rounded-2xl border border-warn/40 bg-warn-bg/80 p-4 text-xs sm:text-sm text-warn shadow-2xs">
          <strong className="mr-1">【{m.common.draft}】</strong>
          {m.staticPage.draftNote}
        </p>
      )}
      {updated && <p className="mt-3 text-xs text-muted">{m.staticPage.updated(updated)}</p>}
      <div className="prose-ja mt-6 leading-relaxed">{children}</div>
    </article>
  );
}
