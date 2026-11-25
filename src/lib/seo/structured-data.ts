import "server-only";
import { siteBaseUrl } from "@/lib/config/site";
import { getMessages } from "@/lib/i18n";

/**
 * 検索エンジン向けの構造化データ（JSON-LD）。トップページに埋め込む。
 * WebSite の name は Google 検索結果の「サイト名」に使われる。
 * Googlebot は Cookie を持たず日本語版を見るため、日本語を正とし英語名を alternateName に入れる。
 */
export function homeStructuredData(): object {
  const ja = getMessages("ja");
  const en = getMessages("en");
  const base = siteBaseUrl();
  const url = `${base}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        url,
        name: ja.brand.name,
        alternateName: en.brand.name,
        description: ja.brand.promise,
        inLanguage: ["ja", "en"],
      },
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: ja.brand.name,
        alternateName: en.brand.name,
        url,
        description: ja.brand.promise,
        applicationCategory: "TravelApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        inLanguage: ["ja", "en"],
        image: `${base}/icons/icon-512.png`,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "JPY" },
        isPartOf: { "@id": `${url}#website` },
      },
    ],
  };
}

/** <script type="application/ld+json"> に入れる文字列。"<" をエスケープして </script> の混入を防ぐ */
export function toJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
