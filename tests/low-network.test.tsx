// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import { fetchSearch } from "@/lib/journey/client";
import { apiOk } from "@/lib/http/api";
import { MapOnDemand, isSlowConnection } from "@/components/MapOnDemand";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";

const ja = getMessages("ja");

// 地図本体（maplibre）はテストでは読み込まない
vi.mock("@/components/RouteMap", () => ({ RouteMap: () => <div data-testid="real-map" /> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});

/** 応答が返らないまま止まる fetch（電波の弱い場所を想定） */
const hangingFetch = vi.fn(
  (_: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
);

describe("通信が遅い・止まったとき", () => {
  it("時間制限を過ぎたら TimeoutError で打ち切る", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch);
    const p = fetchWithTimeout("/x", { timeoutMs: 1000 });
    const check = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  });

  it("呼び出し側の中断は AbortError のまま伝える", async () => {
    vi.stubGlobal("fetch", hangingFetch);
    const ctrl = new AbortController();
    const p = fetchWithTimeout("/x", { timeoutMs: 60_000, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("検索が止まったら「通信できませんでした」（再試行できる）になる", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch);
    const params = {
      origin: { lat: 35.68, lon: 139.76 },
      destination: { lat: 35.46, lon: 139.62 },
      departure: "2026-11-18T10:00",
      mode: "train" as const,
      preferences: [],
    };
    const p = fetchSearch("q=timeout-test", params);
    await vi.advanceTimersByTimeAsync(80_000);
    await expect(p).resolves.toMatchObject({ ok: false, code: "network_error" });
  });
});

describe("API の応答", () => {
  it("自前では圧縮しない（サーバー側の圧縮と二重にならないように）", async () => {
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, name: "東京駅" })) };
    const res = apiOk(big);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(big);
    expect(apiOk({ ok: 1 }, { cacheSeconds: 60 }).headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("地図は必要になるまで読み込まない", () => {
  const props = { routes: [], summary: "map", className: "h-64" };
  const renderMap = () =>
    render(
      <I18nProvider locale="ja">
        <MapOnDemand {...props} />
      </I18nProvider>,
    );

  it("回線が遅いときは「地図を表示」ボタンを出し、押したら読み込む", async () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { effectiveType: "3g" } });
    expect(isSlowConnection()).toBe(true);
    renderMap();
    const btn = await screen.findByRole("button", { name: new RegExp(ja.results.showMap) });
    expect(screen.queryByTestId("real-map")).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByTestId("real-map")).toBeTruthy();
    // 一度表示したら、同じタブでは以後自動で表示する
    expect(sessionStorage.getItem("hikage:map")).toBe("1");
  });

  it("データセーバーが有効なときも自動では読み込まない", () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { effectiveType: "4g", saveData: true } });
    expect(isSlowConnection()).toBe(true);
  });

  it("回線が速いときは、画面に入ったら自動で読み込む", async () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { effectiveType: "4g" } });
    let trigger: (() => void) | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          trigger = () => cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    renderMap();
    expect(screen.queryByTestId("real-map")).toBeNull();
    trigger!();
    expect(await screen.findByTestId("real-map")).toBeTruthy();
  });
});
