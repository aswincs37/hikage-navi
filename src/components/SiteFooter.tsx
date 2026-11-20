import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { LogoMark } from "./Logo";

/**
 * フッター。スマホでは「ブランド → タップしやすい2列のリンク → 出典・注意書き」の順に縦に並べる。
 * 出典（地図・データの帰属表示）は省略せず、小さな文字でまとめて表示する。
 */
export async function SiteFooter() {
  const { m } = await getI18n();
  const links = [
    { href: "/how-it-works", label: m.nav.howItWorks },
    { href: "/data-sources", label: m.nav.dataSources },
    { href: "/about", label: m.nav.about },
    { href: "/privacy", label: m.nav.privacy },
    { href: "/terms", label: m.nav.terms },
    { href: "/contact", label: m.nav.contact },
  ];
  return (
    <footer className="mt-10 border-t border-line/70 bg-surface-2/50 sm:mt-16">
      <div className="mx-auto max-w-6xl px-4 pt-7 pb-[max(1.75rem,env(safe-area-inset-bottom))] text-sm text-muted sm:py-12">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <Link href="/" className="flex items-center gap-2.5 self-start">
            <LogoMark className="h-8 w-8 shrink-0" />
            <span className="min-w-0">
              <span className="block text-base font-black leading-tight text-ink">{m.brand.name}</span>
              <span className="block text-xs leading-snug text-muted">{m.brand.footerTagline}</span>
            </span>
          </Link>
          <nav aria-label={m.nav.footerMenu}>
            <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end sm:gap-x-5 sm:gap-y-2">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="flex min-h-11 items-center rounded-xl border border-line/70 bg-surface px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2 active:bg-surface-2 sm:min-h-0 sm:border-0 sm:bg-transparent sm:px-0 sm:font-medium sm:text-muted sm:hover:bg-transparent sm:hover:text-ink sm:hover:underline sm:underline-offset-4"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-6 space-y-3 border-t border-line/60 pt-5 sm:mt-8">
          <p className="flex items-start gap-2 rounded-xl bg-warn-bg/60 px-3 py-2.5 text-xs leading-relaxed text-ink sm:bg-transparent sm:p-0 sm:text-muted">
            <span aria-hidden="true">⚠️</span>
            <span>{m.footer.disclaimer}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-muted/90">
            {m.footer.attribution}
            {m.footer.moreBefore}
            <Link href="/data-sources" className="font-semibold text-ai underline-offset-2 hover:underline">
              {m.nav.dataSources}
            </Link>
            {m.footer.moreAfter}
          </p>
          <p className="text-xs font-medium text-muted/80">
            © {new Date().getFullYear()} {m.brand.name}
          </p>
        </div>
      </div>
    </footer>
  );
}
