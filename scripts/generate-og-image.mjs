/**
 * リンク共有時のプレビュー画像（Open Graph / X カード、1200×630）を作る。
 * 文言や絵柄を変えたら `node scripts/generate-og-image.mjs` で作り直す（出力 public/og-image.png はリポジトリに含める）。
 * 日本語フォントは実行する PC のもの（Windows: Yu Gothic / Meiryo、Mac: Hiragino、Linux: Noto Sans CJK JP）を使う。
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public/og-image.png");

const W = 1200;
const H = 630;
const FONT = "'Yu Gothic UI', 'Yu Gothic', Meiryo, 'Hiragino Sans', 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";

// アイコン（src/app/icon.svg）と同じ絵柄。座標は 40×40
const ART =
  '<circle cx="27" cy="12" r="6.5" fill="#9a5200"/>' +
  '<path d="M4 34 L16 18 L16 34 Z" fill="#22604f"/>' +
  '<path d="M8 36 C 15 30, 21 28, 36 27" fill="none" stroke="#1f4766" stroke-width="3.2" stroke-linecap="round"/>';

const chips = ["建物3D日陰推定", "太陽方位・車窓の日差し", "環境省 暑さ指数(WBGT)"];

function chipRow(x, y) {
  let cx = x;
  return chips
    .map((label) => {
      // 全角は約26px・半角は約14px として幅を見積もる
      const w = 44 + [...label].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 0x80 ? 14 : 26), 0);
      const s = `<rect x="${cx}" y="${y}" width="${w}" height="56" rx="28" fill="#ffffff" stroke="#d8d2c3" stroke-width="2"/>` +
        `<text x="${cx + w / 2}" y="${y + 37}" font-size="25" font-weight="600" fill="#1f4766" text-anchor="middle">${label}</text>`;
      cx += w + 18;
      return s;
    })
    .join("");
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f6f2e8"/>
  <rect y="${H - 18}" width="${W}" height="18" fill="#1b5fae"/>
  <circle cx="1080" cy="110" r="190" fill="#f2c46d" opacity="0.25"/>
  <g font-family="${FONT}">
    <g transform="translate(80 92) scale(4.2)">
      <rect width="40" height="40" rx="8" fill="#ffffff"/>
      ${ART}
    </g>
    <text x="276" y="178" font-size="92" font-weight="700" fill="#1a2433">ひかげナビ</text>
    <text x="282" y="236" font-size="34" font-weight="600" fill="#5a6577" letter-spacing="2">Hikage Navi</text>
    <text x="80" y="370" font-size="50" font-weight="700" fill="#1a2433">暑い日の移動を、日陰と快適さで選ぶ。</text>
    <text x="80" y="428" font-size="30" fill="#3d4757">日差し・建物の日陰・暑さ指数を、経路ごとに比べられるルート案内</text>
    ${chipRow(80, 488)}
  </g>
</svg>`;

await mkdir(path.dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log("wrote public/og-image.png");
