/*
 * ひかげナビ Service Worker（オフライン対応）
 *
 * - 画面（HTML）: まずネットから取得し、取れなければ保存しておいた画面を出す
 *   （/search・/route は画面の中身をブラウザで組み立てるため、どの検索でも同じ画面で開ける）
 * - JS・CSS・アイコン（/_next/static/ など）: 一度取得したら保存したものを使う（ファイル名が内容ごとに変わる）
 * - API（/api/）: 保存しない（結果は端末の localStorage に別途保存している）
 * - 地図の画像（国土地理院）: 保存しない（量が多いため）。オフラインでは地図以外の答えを文字で表示する
 *
 * 更新時は VERSION を上げる。古い保存分は activate で消える。
 */
const VERSION = "v2";
const PAGES = `hikage-pages-${VERSION}`;
const STATIC = `hikage-static-${VERSION}`;
const OFFLINE_URL = "/offline";
/** 最初に保存しておく画面（電波の無い所で初めて開いても、結果の画面が使えるように） */
const PRECACHE_PAGES = ["/", "/search", "/route", OFFLINE_URL];

/** 画面の HTML から、その画面が使う JS・CSS の URL を取り出す */
function assetsIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/["'(](\/_next\/static\/[^"')\s]+)["')]/g)) out.add(m[1]);
  return [...out];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGES);
      const statics = await caches.open(STATIC);
      await Promise.allSettled(
        PRECACHE_PAGES.map(async (path) => {
          const res = await fetch(path, { credentials: "same-origin" });
          if (!res.ok) return;
          const html = await res.clone().text();
          await pages.put(path, res);
          await Promise.allSettled(assetsIn(html).map((a) => statics.add(a)));
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC]);
      for (const k of await caches.keys()) if (k.startsWith("hikage-") && !keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/") || /^\/(icon|apple-icon)/.test(url.pathname);
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function pageNetworkFirst(request, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    // 検索条件つきの URL（/?olat=… など）は画面に条件が入るため、条件なしの画面だけを保存する
    if (res.ok && !url.search) cache.put(url.pathname, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(url.pathname)) ||
      (await cache.match(OFFLINE_URL)) ||
      new Response("offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (isStatic(url)) {
    event.respondWith(staticFirst(request));
    return;
  }
  if (request.mode === "navigate") event.respondWith(pageNetworkFirst(request, url));
});
