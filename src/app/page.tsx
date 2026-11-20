import Link from "next/link";
import { JourneyForm } from "@/components/JourneyForm";
import { fromQuery } from "@/lib/journey/query";
import { getConfig } from "@/lib/config/env";
import { getI18n } from "@/lib/i18n/server";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const initial = fromQuery(q) ?? undefined;
  const { m } = await getI18n();

  const featureIcons = [
    (
      <svg key="sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
    (
      <svg key="shade" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--shade)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 21h18M5 21V7l8-4v18M13 11l6-3v13" />
      </svg>
    ),
    (
      <svg key="temp" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ai)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
      </svg>
    ),
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 見出し（短く。すぐ下に検索フォーム） */}
      <section aria-labelledby="intro">
        <h1 id="intro" className="text-xl font-bold leading-snug text-ink sm:text-2xl">
          {m.home.introTitle}
          <span className="ml-0 block text-sm font-medium text-muted sm:ml-3 sm:inline sm:text-base">{m.home.heroAccent}</span>
        </h1>
        <ul className="mt-2 hidden flex-wrap gap-2 text-xs font-semibold text-ink sm:flex">
          {m.home.highlights.map((h, i) => (
            <li key={h} className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1">
              <span aria-hidden="true">{["🏢", "☀️", "🌡️"][i % 3]}</span>
              {h}
            </li>
          ))}
        </ul>
      </section>

      <JourneyForm initial={initial} transitAvailable={getConfig().transit !== null} />

      {/* 特徴（一覧） */}
      <section aria-labelledby="features" className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-surface-2 px-4 py-2.5">
          <h2 id="features" className="text-sm font-bold text-ink">
            {m.home.featuresTitle}
          </h2>
        </div>
        <ul className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
          {m.home.features.map((f, i) => (
            <li key={f.title} className="flex gap-3 p-4">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2">{featureIcons[i % featureIcons.length]}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink">{f.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 誠実性とプライバシー */}
      <section className="grid gap-3 md:grid-cols-2">
        {[
          { tag: m.home.honestyTag, title: m.home.honestyTitle, body: m.home.honestyBody, href: "/how-it-works", link: m.nav.howItWorks, color: "border-l-ai" },
          { tag: m.home.privacyTag, title: m.home.privacyTitle, body: m.home.privacyBody, href: "/privacy", link: m.nav.privacy, color: "border-l-shade" },
        ].map((c) => (
          <div key={c.href} className={`rounded-xl border border-l-4 border-line bg-surface p-4 ${c.color}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-muted">{c.tag}</span>
              <h2 className="text-sm font-bold text-ink">{c.title}</h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">{c.body}</p>
            <Link href={c.href} className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ai hover:underline underline-offset-4">
              {c.link}
              <span aria-hidden="true">›</span>
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}
