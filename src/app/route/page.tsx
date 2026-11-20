import type { Metadata } from "next";
import { Suspense } from "react";
import { RouteDetails } from "@/components/RouteDetails";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.details.title, robots: { index: false } };
}

export default async function RoutePage() {
  const { m } = await getI18n();
  return (
    <Suspense fallback={<p role="status">{m.common.loading}</p>}>
      <RouteDetails />
    </Suspense>
  );
}
