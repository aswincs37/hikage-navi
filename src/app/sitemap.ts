import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/config/site";

/**
 * 検索エンジンに知らせる固定の画面。
 * 検索結果（/search・/route）は条件ごとに URL が変わり、位置情報も含むため載せない。
 */
const PAGES: { path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/data-sources", priority: 0.5, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteBaseUrl();
  return PAGES.map((p) => ({ url: `${base}${p.path === "/" ? "" : p.path}`, changeFrequency: p.changeFrequency, priority: p.priority }));
}
