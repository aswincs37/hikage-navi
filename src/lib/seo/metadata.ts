import "server-only";
import type { Metadata } from "next";
import type { Messages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

/** リンク共有時のプレビュー画像（scripts/generate-og-image.mjs で作る） */
const OG_IMAGE = { url: "/og-image.png", width: 1200, height: 630 } as const;

type PageKey = Exclude<keyof Messages["meta"], "home">;

/**
 * 検索結果・リンク共有用のメタデータ。
 * openGraph / twitter は子ページで指定すると親の設定がまるごと置き換わるため、毎回すべての項目を入れる。
 */
async function build(opts: { title?: string; description: string; path: string }): Promise<Metadata> {
  const { m, locale } = await getI18n();
  const brand = m.brand.name;
  const shareTitle = opts.title ? `${opts.title} | ${brand}` : `${brand} | ${m.brand.tagline}`;
  const image = { ...OG_IMAGE, alt: `${brand} | ${m.brand.tagline}` };
  return {
    ...(opts.title ? { title: opts.title } : {}),
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      type: "website",
      siteName: brand,
      title: shareTitle,
      description: opts.description,
      url: opts.path,
      locale: locale === "en" ? "en_US" : "ja_JP",
      images: [image],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description: opts.description, images: [image] },
  };
}

/** トップページ（タイトルはルートレイアウトの既定値を使う） */
export async function homeMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return build({ description: m.meta.home, path: "/" });
}

/** 固定ページ（このサービスについて・規約など）。path は canonical URL のパス */
export async function staticPageMetadata(page: PageKey, title: string, path: string): Promise<Metadata> {
  const { m } = await getI18n();
  return build({ title, description: m.meta[page], path });
}
