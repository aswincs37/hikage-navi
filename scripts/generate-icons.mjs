/**
 * ホーム画面に追加（PWA）用の PNG アイコンを src/app/icon.svg の絵柄から作る。
 * 絵柄を変えたら `node scripts/generate-icons.mjs` で作り直す（出力はリポジトリに含める）。
 *
 * - public/icons/icon-192.png, icon-512.png … 通常のアイコン（角丸・背景つき）
 * - public/icons/maskable-512.png … Android の形に合わせて切り抜かれる用（余白を広く・四角い背景）
 * - src/app/apple-icon.png … iPhone のホーム画面用 180px（iOS が角を丸めるので四角いまま）
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BG = "#f6f2e8";

/** icon.svg と同じ絵柄（背景の四角を除く）。座標は 40×40 */
const ART =
  '<circle cx="27" cy="12" r="6.5" fill="#9a5200"/>' +
  '<path d="M4 34 L16 18 L16 34 Z" fill="#22604f"/>' +
  '<path d="M8 36 C 15 30, 21 28, 36 27" fill="none" stroke="#1f4766" stroke-width="3.2" stroke-linecap="round"/>';

/** scale: 絵柄の大きさ（1 = 枠いっぱい）。rounded: 背景の角を丸めるか */
function svg({ scale = 1, rounded = false }) {
  const offset = (40 - 40 * scale) / 2;
  const bg = rounded ? `<rect width="40" height="40" rx="8" fill="${BG}"/>` : `<rect width="40" height="40" fill="${BG}"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${bg}<g transform="translate(${offset} ${offset}) scale(${scale})">${ART}</g></svg>`,
  );
}

async function render(file, size, opts) {
  const out = path.join(root, file);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(svg(opts), { density: 72 * (size / 40) }).resize(size, size).png().toFile(out);
  console.log("wrote", file);
}

await render("public/icons/icon-192.png", 192, { rounded: true });
await render("public/icons/icon-512.png", 512, { rounded: true });
// maskable は中央 80% が必ず残る範囲。絵柄を 72% に縮めて収める
await render("public/icons/maskable-512.png", 512, { scale: 0.72 });
await render("src/app/apple-icon.png", 180, { scale: 0.86 });
