import { getI18n } from "@/lib/i18n/server";

/**
 * ページ移動中の表示。通信が遅いときも、リンクを押した直後に反応が見えるようにする
 * （ヘッダー・フッターはそのまま残り、本文の部分だけがこの表示になる）。
 */
export default async function Loading() {
  const { m } = await getI18n();
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted">
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-3 border-ai border-t-transparent" aria-hidden="true" />
      <span className="text-sm">{m.common.loading}</span>
    </div>
  );
}
