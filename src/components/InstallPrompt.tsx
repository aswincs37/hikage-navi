"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

/**
 * 「ホーム画面に追加」の案内（PWA のインストール）。
 * - Android・PC の Chrome / Edge: ブラウザの beforeinstallprompt を受け取り、「追加する」でインストール画面を出す
 * - iPhone・iPad の Safari: インストール画面を出す仕組みが無いため、共有ボタンからの手順を案内する
 * - インストール済み（アプリとして開いている）なら出さない
 * - 「閉じる」を押したら 30 日間は出さない（この端末のブラウザにだけ記録）
 */

/** Chrome 系だけにある beforeinstallprompt イベント（標準の型定義に無いため自前で定義） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "hikage-install-dismissed";
const DISMISS_DAYS = 30;
/** iOS では開いてすぐに出すと邪魔なので、少し待ってから案内する */
const IOS_DELAY_MS = 4000;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone / iPad の Safari（iPadOS は Mac として名乗るため、タッチ対応で見分ける） */
function isIosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // 保存できない（プライベートモードなど）ときは、このページを開いている間だけ閉じる
  }
}

type Mode = "hidden" | "prompt" | "ios";

export function InstallPrompt() {
  const { m } = useI18n();
  const [mode, setMode] = useState<Mode>("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      // ブラウザ標準の小さな案内を止め、こちらのボタンから出す
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => {
      setDeferred(null);
      setMode("hidden");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const timer = isIosSafari() ? window.setTimeout(() => setMode("ios"), IOS_DELAY_MS) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (mode === "hidden") return null;

  const close = () => {
    rememberDismissed();
    setMode("hidden");
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // prompt() は1回しか使えないため、どちらを選んでも案内を閉じる。断ったときは 30 日間出さない
    if (outcome === "dismissed") rememberDismissed();
    setDeferred(null);
    setMode("hidden");
  };

  return (
    <div
      role="dialog"
      aria-labelledby="install-title"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-2xl border border-line bg-surface p-3 shadow-lg sm:left-auto sm:right-4 sm:mx-0"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな固定アイコンのため最適化は不要 */}
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p id="install-title" className="text-sm font-bold text-ink">
            {m.install.title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{mode === "ios" ? m.install.iosHint : m.install.body}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={m.install.close}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg text-muted hover:bg-surface-2 hover:text-ink"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {mode === "prompt" && (
        <button
          type="button"
          onClick={install}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-ai px-4 text-sm font-bold text-ai-ink shadow-sm transition-colors hover:bg-ai-hover active:bg-ai-hover"
        >
          {m.install.button}
        </button>
      )}
    </div>
  );
}
