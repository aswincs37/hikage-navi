// MapLibre GL v6 は import.meta.url からワーカーの場所を求めるが、バンドル後はその位置にファイルが無い。
// ワーカー（依存なしの単一ファイル）を public/ に複製し、RouteMap で setWorkerUrl する。
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
mkdirSync("public/vendor", { recursive: true });
copyFileSync(path.join(pkgDir, "dist/maplibre-gl-worker.mjs"), "public/vendor/maplibre-gl-worker.mjs");
console.log(`copied maplibre-gl-worker.mjs (v${version})`);
