import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // 位置情報は「現在地を使う」ボタンを押したときだけ、このサイト自身が要求する
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 開発時に同じ Wi-Fi のスマホから http://192.168.x.x:3001 で確認できるようにする（本番には影響しない）
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  reactStrictMode: true,
  // 電車の経路探索に使う線路網ファイル（実行時に読み込むため、ビルド出力に明示的に含める）
  outputFileTracingIncludes: { "/**": ["./data/rail/japan-rail.json.gz"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Service Worker は常に最新を確認する（古いものが残ると更新が届かない）
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
