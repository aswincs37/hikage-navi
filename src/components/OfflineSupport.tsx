"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * オフライン対応:
 * - 本番環境では Service Worker（public/sw.js）を登録し、画面を端末に保存する
 *   （開発中は登録しない。ホットリロードの邪魔になるため）
 * - 電波が切れたら、画面上部に「オフライン」と保存した結果への案内を出す
 */

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function OfflineSupport() {
  const { m } = useI18n();
  // サーバー側とハイドレーション中は「オンライン」とみなす
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    // 最初の表示を遅くしないよう、読み込みが終わってから登録する
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  if (online) return null;
  return (
    <div role="status" className="border-b border-warn/40 bg-warn-bg px-4 py-2 text-center text-sm text-ink">
      <span className="font-bold">{m.offline.banner}</span>{" "}
      <Link href="/offline" className="font-bold text-ai underline underline-offset-4">
        {m.offline.openSaved}
      </Link>
    </div>
  );
}
