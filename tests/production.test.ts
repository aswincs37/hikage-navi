import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config/env";
import { readinessIssues } from "@/lib/config/readiness";
import { legalPagesFinal, type SiteInfo } from "@/lib/config/site";
import { rateLimit, searchRateLimit } from "@/lib/http/api";
import { GET as GET_STATUS } from "@/app/api/v1/providers/status/route";

const site = (over: Partial<SiteInfo> = {}): SiteInfo => ({ legalReviewed: false, ...over });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("legal pages", () => {
  it("stay drafts until reviewed and operator + contact are set", () => {
    expect(legalPagesFinal(site({ operatorName: "A", contactEmail: "a@b.jp" }))).toBe(false);
    expect(legalPagesFinal(site({ legalReviewed: true, operatorName: "A" }))).toBe(false);
    expect(legalPagesFinal(site({ legalReviewed: true, operatorName: "A", contactFormUrl: "https://f" }))).toBe(true);
  });
});

describe("production readiness", () => {
  it("reports missing car routing and geocoding when public servers are off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_DEMO_ENDPOINTS", "");
    const issues = readinessIssues(getConfig(), site(), {} as NodeJS.ProcessEnv);
    expect(codes(issues)).toEqual(expect.arrayContaining(["no_car_routing", "no_geocoder", "user_agent", "rate_limit_per_instance", "legal_draft"]));
    expect(issues.find((i) => i.code === "no_car_routing")?.level).toBe("error");
  });

  it("is clean when everything is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PUBLIC_DEMO_ENDPOINTS", "false");
    vi.stubEnv("OSRM_CAR_URL", "http://osrm:5000");
    vi.stubEnv("NOMINATIM_URL", "http://nominatim");
    vi.stubEnv("OPEN_METEO_API_KEY", "k");
    vi.stubEnv("OVERPASS_URL", "http://overpass");
    vi.stubEnv("MOE_WBGT_FORECAST_URL", "http://wbgt");
    vi.stubEnv("JMA_AMEDAS_TABLE_URL", "http://amedas");
    const env = { UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" } as unknown as NodeJS.ProcessEnv;
    const s = site({ url: "https://hikage.example", operatorName: "A", contactEmail: "a@b.jp", legalReviewed: true });
    expect(readinessIssues(getConfig(), s, env)).toEqual([]);
  });

  it("builds the User-Agent from SITE_URL", () => {
    vi.stubEnv("HTTP_USER_AGENT", "");
    vi.stubEnv("SITE_URL", "https://hikage.example/");
    expect(getConfig().userAgent).toBe("hikage-navi/1.0 (+https://hikage.example)");
  });
});

describe("provider status endpoint", () => {
  const get = (auth?: string) =>
    GET_STATUS(new NextRequest("http://localhost/api/v1/providers/status", auth ? { headers: { authorization: auth } } : undefined));

  it("is open in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await get()).status).toBe(200);
  });

  it("is hidden in production without the right token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STATUS_TOKEN", "");
    expect((await get("Bearer anything")).status).toBe(404);
    vi.stubEnv("STATUS_TOKEN", "s3cret-token");
    expect((await get()).status).toBe(404);
    expect((await get("Bearer wrong")).status).toBe(404);
    expect((await get("Bearer s3cret-token")).status).toBe(200);
  });
});

describe("rate limit", () => {
  const req = () => new NextRequest("http://localhost/api/x", { headers: { "x-forwarded-for": "203.0.113.7" } });

  it("uses the shared Redis count when configured, without sending the raw IP", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "5");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ result: 6 }, { result: 1 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await rateLimit(req(), "test-shared");
    expect(res?.status).toBe(429);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://redis.example/pipeline");
    expect(String(init.body)).not.toContain("203.0.113.7");
  });

  it("falls back to counting in memory when Redis fails", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await rateLimit(req(), "test-fallback")).toBeNull();
    expect(await rateLimit(req(), "test-fallback")).toBeNull();
    expect((await rateLimit(req(), "test-fallback"))?.status).toBe(429);
  });

  it("caps searches per day as well as per minute, counting weight", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("RATE_LIMIT_SEARCHES_PER_MINUTE", "100");
    vi.stubEnv("RATE_LIMIT_SEARCHES_PER_DAY", "6");
    const day = (ip: string) => new NextRequest("http://localhost/api/x", { headers: { "x-forwarded-for": ip } });
    expect(await searchRateLimit(day("198.51.100.1"), 5)).toBeNull();
    expect(await searchRateLimit(day("198.51.100.1"))).toBeNull();
    const res = await searchRateLimit(day("198.51.100.1"));
    expect(res?.status).toBe(429);
    expect((await res!.json()).error.code).toBe("daily_limit_reached");
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThan(60);
    // 別の IP は影響を受けない
    expect(await searchRateLimit(day("198.51.100.2"))).toBeNull();
  });

  it("applies the per-minute search limit before the daily one", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("RATE_LIMIT_SEARCHES_PER_MINUTE", "2");
    vi.stubEnv("RATE_LIMIT_SEARCHES_PER_DAY", "100");
    const r = () => new NextRequest("http://localhost/api/x", { headers: { "x-forwarded-for": "198.51.100.9" } });
    expect(await searchRateLimit(r())).toBeNull();
    expect(await searchRateLimit(r())).toBeNull();
    const res = await searchRateLimit(r());
    expect((await res!.json()).error.code).toBe("rate_limited");
  });
});
