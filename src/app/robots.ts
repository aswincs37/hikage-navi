import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/config/site";

/** 検索エンジン向け。API とオフライン用の画面は対象外にする */
export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/offline"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
