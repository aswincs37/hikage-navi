import { describe, expect, it } from "vitest";
import { solarPosition, SolarInputError } from "@/lib/solar/position";
import { parseDateTime, parseTokyoLocal, toTokyoIso } from "@/lib/time/tokyo";

const TOKYO = { lat: 35.6812, lon: 139.7671 };
const SAPPORO = { lat: 43.0687, lon: 141.3508 };
const NAHA = { lat: 26.2124, lon: 127.6809 };

const at = (s: string) => parseTokyoLocal(s)!;

/**
 * 検証用の独立実装（NOAA の簡易式）。ライブラリと別の方法で計算し、0.5°以内で一致することを確認する。
 */
function noaa(lat: number, lon: number, date: Date) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { el: el / rad, az: ((az / rad) % 360 + 360) % 360 };
}

describe("solarPosition", () => {
  it("夏至の南中付近、東京で高度約78°・方位はほぼ真南", () => {
    const p = solarPosition(TOKYO.lat, TOKYO.lon, at("2026-06-21T11:42"));
    expect(p.elevationDeg).toBeGreaterThan(77);
    expect(p.elevationDeg).toBeLessThan(78.5);
    expect(Math.abs(p.azimuthDeg - 180)).toBeLessThan(3);
    expect(p.aboveHorizon).toBe(true);
  });

  it("冬至の南中付近、東京で高度約31°", () => {
    const p = solarPosition(TOKYO.lat, TOKYO.lon, at("2026-12-21T11:38"));
    expect(p.elevationDeg).toBeGreaterThan(30);
    expect(p.elevationDeg).toBeLessThan(32);
  });

  it.each([
    ["2026-03-20T08:00", TOKYO],
    ["2026-07-15T15:30", SAPPORO],
    ["2026-10-01T10:15", NAHA],
    ["2026-12-01T16:00", TOKYO],
  ])("独立した計算式と0.5°以内で一致する (%s)", (time, place) => {
    const d = at(time);
    const p = solarPosition(place.lat, place.lon, d);
    const ref = noaa(place.lat, place.lon, d);
    expect(Math.abs(p.elevationDeg - ref.el)).toBeLessThan(0.5);
    const azDiff = Math.abs(((p.azimuthDeg - ref.az + 540) % 360) - 180);
    expect(azDiff).toBeLessThan(0.5);
  });

  it("同じ冬の正午でも、那覇の方が札幌より太陽が高い（緯度の違い）", () => {
    const naha = solarPosition(NAHA.lat, NAHA.lon, at("2026-12-21T12:30"));
    const sapporo = solarPosition(SAPPORO.lat, SAPPORO.lon, at("2026-12-21T11:40"));
    expect(naha.elevationDeg).toBeGreaterThan(sapporo.elevationDeg + 15);
  });

  it("日の出前は地平線より下、日の出後は上（東京・夏至 日の出は4時25分頃）", () => {
    expect(solarPosition(TOKYO.lat, TOKYO.lon, at("2026-06-21T04:15")).aboveHorizon).toBe(false);
    const after = solarPosition(TOKYO.lat, TOKYO.lon, at("2026-06-21T04:40"));
    expect(after.aboveHorizon).toBe(true);
    // 夏至の朝日は東北東から昇る
    expect(after.azimuthDeg).toBeGreaterThan(55);
    expect(after.azimuthDeg).toBeLessThan(70);
  });

  it("日没直後は見かけの高度（大気差補正あり）が幾何学的高度より高い", () => {
    const p = solarPosition(TOKYO.lat, TOKYO.lon, at("2026-06-21T19:01"));
    expect(p.apparentElevationDeg).toBeGreaterThan(p.elevationDeg);
  });

  it("深夜は地平線より下", () => {
    const p = solarPosition(TOKYO.lat, TOKYO.lon, at("2026-08-01T00:00"));
    expect(p.aboveHorizon).toBe(false);
    expect(p.elevationDeg).toBeLessThan(0);
  });

  it("不正な座標・日付を拒否する", () => {
    expect(() => solarPosition(91, 0, new Date())).toThrow(SolarInputError);
    expect(() => solarPosition(35, 181, new Date())).toThrow(SolarInputError);
    expect(() => solarPosition(Number.NaN, 139, new Date())).toThrow(SolarInputError);
    expect(() => solarPosition(35, 139, new Date("invalid"))).toThrow(SolarInputError);
  });
});

describe("日本時間の扱い", () => {
  it("タイムゾーン無しの日時は日本時間（UTC+9）として解釈する", () => {
    expect(parseTokyoLocal("2026-06-21T12:00")!.toISOString()).toBe("2026-06-21T03:00:00.000Z");
    expect(toTokyoIso(new Date("2026-06-21T15:30:00Z"))).toBe("2026-06-22T00:30:00+09:00");
  });

  it("存在しない日付・不正な形式を拒否する", () => {
    expect(parseTokyoLocal("2026-02-30T10:00")).toBeNull();
    expect(parseTokyoLocal("2026-06-21 10:00")).toBeNull();
    expect(parseDateTime("tomorrow")).toBeNull();
    expect(parseDateTime("")).toBeNull();
  });

  it("オフセット付き ISO 文字列も受け付ける", () => {
    expect(parseDateTime("2026-06-21T03:00:00Z")!.getTime()).toBe(parseTokyoLocal("2026-06-21T12:00")!.getTime());
  });
});
