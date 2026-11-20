"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { listSaved, subscribeSaved, type SavedSummary } from "@/lib/journey/savedResults";
import { ModeIcon } from "./icons";

/** この端末に保存した検索結果の一覧（電波が無くても開ける） */
export function SavedResultsList() {
  const { m, formatDate, formatTime } = useI18n();
  const [items, setItems] = useState<SavedSummary[] | null>(null);

  useEffect(() => {
    const load = () => setItems(listSaved());
    load();
    return subscribeSaved(load);
  }, []);

  if (items === null) return <p className="text-sm text-muted">{m.common.loading}</p>;
  if (items.length === 0) return <p className="rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">{m.offline.empty}</p>;

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((s) => {
        const dep = s.departure.length === 16 ? `${s.departure}:00+09:00` : s.departure;
        return (
          <li key={s.query}>
            <Link href={`/search?${s.query}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ai-light text-ai" aria-hidden="true">
                <ModeIcon mode={s.mode} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">
                  {s.origin || m.form.origin} → {s.destination || m.form.destination}
                </span>
                <span className="num block text-xs text-muted">
                  {m.modes[s.mode]}・{m.results.departsAt(formatDate(dep), formatTime(dep))}
                </span>
              </span>
              <span aria-hidden="true" className="text-muted">›</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
