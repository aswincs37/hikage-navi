"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { RouteMap as RouteMapComponent } from "./RouteMap";

/**
 * 地図は通信量が大きい（地図ライブラリ 約0.4MB ＋ 地図画像）ため、必要になるまで読み込まない。
 * - 画面に近づいたときに読み込む（結論や候補の文字が先に表示される）
 * - 通信が遅い・データセーバーが有効なときは自動では読み込まず、「地図を表示」ボタンを出す
 * 一度ボタンで表示したら、同じタブの間は以後自動で表示する。
 * 地図が無くても、座席の左右・日差し・候補の比較などはすべて文字で分かる。
 */

const RouteMap = dynamic(() => import("./RouteMap").then((x) => x.RouteMap), {
  ssr: false,
  loading: () => <MapLoading />,
});

const REMEMBER_KEY = "hikage:map";

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** 回線が遅い（2G・3G 相当）か、データセーバーが有効か。判定できないブラウザ（Safari など）は false */
export function isSlowConnection(): boolean {
  const c = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return !!c && (c.saveData === true || /^(slow-2g|2g|3g)$/.test(c.effectiveType ?? ""));
}

function remembered(): boolean {
  try {
    return sessionStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

function MapLoading() {
  const { m } = useI18n();
  return (
    <div className="flex h-full min-h-40 items-center justify-center bg-surface-2/60 text-sm text-muted">
      <span>{m.results.mapLoading}</span>
    </div>
  );
}

type Props = ComponentProps<typeof RouteMapComponent>;

export function MapOnDemand(props: Props) {
  const { m } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const [asked, setAsked] = useState(false);
  const className = props.className ?? "h-72 sm:h-96";

  useEffect(() => {
    if (isSlowConnection() && !remembered()) {
      const id = setTimeout(() => setAsked(true));
      return () => clearTimeout(id);
    }
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setShow(true));
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (show) return <RouteMap {...props} />;

  const load = () => {
    try {
      sessionStorage.setItem(REMEMBER_KEY, "1");
    } catch {
      // プライベートモードなどでは覚えない
    }
    setShow(true);
  };

  return (
    <div ref={box} className={`flex flex-col items-center justify-center gap-2 bg-surface-2/60 p-4 text-center ${className}`}>
      {asked ? (
        <>
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-sm font-bold text-ai shadow-2xs hover:bg-surface-2 active:scale-95"
          >
            <span aria-hidden="true">🗺️</span>
            {m.results.showMap}
          </button>
          <p className="max-w-xs text-xs text-muted">{m.results.showMapNote}</p>
        </>
      ) : (
        <span className="text-sm text-muted">{m.results.mapLoading}</span>
      )}
    </div>
  );
}
