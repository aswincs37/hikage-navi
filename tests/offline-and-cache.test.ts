// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JourneySearchResult } from "@/lib/domain/types";
import { TtlCache } from "@/lib/http/memoCache";
import { clearRecent } from "@/lib/journey/recent";
import { listSaved, readSaved, saveResult } from "@/lib/journey/savedResults";
import { previewQuery } from "@/lib/journey/usePreviewRoute";

const result = (originLabel: string): JourneySearchResult => ({
  request: {
    origin: { lat: 35.68, lon: 139.76, label: originLabel },
    destination: { lat: 35.46, lon: 139.62, label: "横浜駅" },
    departure: "2026-11-20T10:00",
    mode: "train",
    preferences: [],
  },
  status: "ok",
  routes: [],
  ranking: null,
  notices: [],
  generatedAt: "2026-11-20T01:00:00Z",
});

describe("TtlCache", () => {
  it("expires entries and drops the oldest when full", () => {
    const c = new TtlCache<number>(2, 1000);
    c.set("a", 1, 1000, 0);
    c.set("b", 2, 1000, 0);
    expect(c.get("a", 500)).toBe(1); // a は最近使った
    c.set("c", 3, 1000, 500); // 一番古い b が消える
    expect(c.get("b", 600)).toBeUndefined();
    expect(c.get("a", 600)).toBe(1);
    expect(c.get("a", 2000)).toBeUndefined(); // 期限切れ
  });

  it("runs the same work only once at a time and skips values not worth keeping", async () => {
    const c = new TtlCache<string>(10, 60_000);
    const work = vi.fn(async () => "x");
    const [a, b] = await Promise.all([c.getOrCreate("k", work), c.getOrCreate("k", work)]);
    expect([a, b]).toEqual(["x", "x"]);
    expect(work).toHaveBeenCalledTimes(1);
    await c.getOrCreate("bad", async () => "fail", () => false);
    expect(c.get("bad")).toBeUndefined();
  });
});

describe("saved results (offline)", () => {
  afterEach(() => localStorage.clear());

  it("keeps the latest 5 results on the device", () => {
    for (let i = 0; i < 7; i++) saveResult(`q${i}`, result("東京駅"));
    expect(listSaved().map((s) => s.query)).toEqual(["q6", "q5", "q4", "q3", "q2"]);
    expect(readSaved("q6")?.request.destination.label).toBe("横浜駅");
  });

  it("does not save searches from the current location", () => {
    saveResult("here-ja", result("現在地"));
    saveResult("here-en", result("Current location"));
    expect(listSaved()).toEqual([]);
  });

  it("is deleted together with the search history", () => {
    saveResult("q", result("東京駅"));
    clearRecent();
    expect(listSaved()).toEqual([]);
  });
});

describe("previewQuery", () => {
  const o = { lat: 35.1709, lon: 136.8815 };
  const d = { lat: 34.9858, lon: 135.7588 };
  it("uses the chosen time for trains", () => {
    expect(previewQuery(o, d, "train", "2026-11-21T08:30")).toContain("t=2026-11-21T08%3A30");
  });
  it("ignores the time of day for car routes so the result can be reused", () => {
    expect(previewQuery(o, d, "car", "2026-11-21T08:30")).toBe(previewQuery(o, d, "car", "2026-11-21T19:05"));
  });
});
