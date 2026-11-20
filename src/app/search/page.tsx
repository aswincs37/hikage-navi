import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchResults } from "@/components/SearchResults";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.results.title, robots: { index: false } };
}

export default async function SearchPage() {
  const { m } = await getI18n();
  return (
    <Suspense fallback={<p role="status">{m.common.loading}</p>}>
      <SearchResults />
    </Suspense>
  );
}
