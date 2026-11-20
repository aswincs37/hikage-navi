import type { MetadataRoute } from "next";
import { getMessages } from "@/lib/i18n";

/** ホーム画面に追加（PWA）するための Web App Manifest（マニフェストの取得には Cookie が送られないため日本語で固定） */
export default function manifest(): MetadataRoute.Manifest {
  const m = getMessages("ja");
  return {
    name: `${m.brand.name} | ${m.brand.tagline}`,
    short_name: m.brand.name,
    description: m.brand.promise,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f4f7",
    theme_color: "#1b5fae",
    lang: "ja",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
