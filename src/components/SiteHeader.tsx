import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { LanguageSwitch } from "./LanguageSwitch";
import { LogoMark } from "./Logo";

export async function SiteHeader() {
  const { m } = await getI18n();
  const links = [
    { href: "/how-it-works", label: m.nav.howItWorks },
    { href: "/data-sources", label: m.nav.dataSources },
    { href: "/about", label: m.nav.about },
  ];
  return (
    <header className="sticky top-0 z-30 bg-ai text-white shadow-sm">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-ai focus:bg-surface focus:px-4 focus:py-2.5 focus:font-bold focus:text-ink focus:shadow-md"
      >
        {m.nav.skipToContent}
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:gap-4 sm:py-2.5">
        <Link href="/" className="group flex min-w-0 items-center gap-2 font-bold tracking-wide text-white sm:gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white sm:h-9 sm:w-9">
            <LogoMark className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate whitespace-nowrap text-lg font-black tracking-tight text-white sm:text-xl">{m.brand.name}</span>
            <span className="hidden rounded border border-white/40 px-2 py-0.5 text-[11px] font-semibold tracking-normal text-white/90 sm:inline-block">
              {m.brand.badge}
            </span>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <nav aria-label={m.nav.mainMenu} className="hidden md:block">
            <ul className="flex items-center gap-1 text-sm font-medium">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="rounded-md px-3 py-1.5 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <LanguageSwitch />
          {/* スマホ: アイコンだけのメニューボタン。開くと画面幅いっぱいのパネル */}
          <details className="group/menu md:hidden">
            <summary
              aria-label={m.nav.menu}
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-white/40 text-white transition-colors hover:bg-white/15 [&::-webkit-details-marker]:hidden"
            >
              <svg className="group-open/menu:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
              <svg className="hidden group-open/menu:block" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </summary>
            <nav
              aria-label={m.nav.mainMenuMobile}
              className="absolute inset-x-3 top-full mt-2 rounded-xl border border-line bg-surface p-2 text-ink shadow-xl ring-1 ring-black/5"
            >
              <ul className="divide-y divide-line/60">
                {[...links, { href: "/privacy", label: m.nav.privacy }].map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="flex min-h-12 items-center justify-between rounded-xl px-3.5 text-[15px] font-semibold text-ink transition-colors hover:bg-surface-2 active:bg-surface-2"
                    >
                      {l.label}
                      <span aria-hidden="true" className="text-muted">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
