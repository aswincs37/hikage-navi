import type { Metadata, Viewport } from "next";
import { InstallPrompt } from "@/components/InstallPrompt";
import { OfflineSupport } from "@/components/OfflineSupport";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n, getLocale } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return {
    title: { default: `${m.brand.name} | ${m.brand.tagline}`, template: `%s | ${m.brand.name}` },
    description: m.brand.promise,
    applicationName: m.brand.name,
    formatDetection: { telephone: false, address: false },
    appleWebApp: { capable: true, title: m.brand.name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1b5fae",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Chrome（iOS）の自動入力などが <html> に属性（__gcr… など）を書き足しても、ハイドレーション警告を出さない
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale}>
          <SiteHeader />
          <OfflineSupport />
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4 sm:pb-8 sm:pt-6">
            {children}
          </main>
          <SiteFooter />
          <InstallPrompt />
        </I18nProvider>
      </body>
    </html>
  );
}
