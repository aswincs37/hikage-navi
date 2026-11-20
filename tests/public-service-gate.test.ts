import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchText, ProviderError } from "@/lib/http/fetch";
import { PUBLIC_SERVICE_POLICIES, passPublicServiceGate, PublicServiceBusyError } from "@/lib/http/publicServiceGate";

// Redis を使わない（プロセス内で数える）経路をテストする
vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("public service gate", () => {
  it("対象外のホスト（自前のサーバー）は制限しない", async () => {
    for (let i = 0; i < 50; i++) await passPublicServiceGate("https://my-own-osrm.example/route");
  });

  it("Nominatim は全体で1秒以上の間隔を空け、待ちが長すぎる呼び出しは諦める", async () => {
    vi.useFakeTimers();
    const url = "https://nominatim.openstreetmap.org/search?q=a";
    const started = Date.now();
    const times: number[] = [];
    const calls = [0, 1, 2].map(() => passPublicServiceGate(url).then(() => times.push(Date.now() - started)));
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(calls);
    expect(times).toEqual([0, 1100, 2200]);

    // 次の空きが 4 秒（maxWaitMs）より先になる呼び出しは、外部へ送らずに諦める
    // 待ち時間: 0, 1.1, 2.2, 3.3 秒は待てる。4.4, 5.5 秒は 4 秒を超えるので諦める
    const queued = [0, 1, 2, 3, 4, 5].map(() => passPublicServiceGate(url).then(() => "ok", (e) => e));
    await vi.advanceTimersByTimeAsync(6000);
    const results = await Promise.all(queued);
    expect(results.slice(0, 4)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(results[4]).toBeInstanceOf(PublicServiceBusyError);
    expect(results[5]).toBeInstanceOf(PublicServiceBusyError);
  });

  it("1分あたりの上限を超えると外部へ送らずに busy になる", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
    const limit = PUBLIC_SERVICE_POLICIES["photon.komoot.io"]!.perMinute!;
    const url = "https://photon.komoot.io/api/?q=x";
    const opts = { provider: "photon", timeoutMs: 1000, userAgent: "test" };
    let busy: unknown;
    for (let i = 0; i <= limit + 1 && !busy; i++) {
      await fetchText(url, opts).catch((e) => (busy = e));
    }
    expect(busy).toBeInstanceOf(ProviderError);
    expect((busy as ProviderError).kind).toBe("busy");
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(limit);
  });
});
