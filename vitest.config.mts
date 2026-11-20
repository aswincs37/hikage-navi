import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // server-only はクライアントから読み込まれた場合にエラーにするためのもの。テストでは空に置き換える
      "server-only": r("./tests/stubs/server-only.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // 外部APIへ実際に通信するテストは作らない（すべてフィクスチャ）
    testTimeout: 10000,
  },
});
