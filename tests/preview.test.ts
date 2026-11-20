import { describe, expect, it } from "vitest";
import type { LonLat } from "@/lib/domain/types";
import { simplifyLine } from "@/lib/journey/preview";

describe("simplifyLine", () => {
  it("drops points on a straight line but keeps the ends", () => {
    const line: LonLat[] = Array.from({ length: 50 }, (_, i) => [139.7 + i * 0.001, 35.6] as LonLat);
    const out = simplifyLine(line, 5);
    expect(out).toEqual([line[0], line[49]]);
  });

  it("keeps corners larger than the tolerance", () => {
    const line: LonLat[] = [
      [139.7, 35.6],
      [139.71, 35.6],
      [139.71, 35.61],
    ];
    expect(simplifyLine(line, 50)).toHaveLength(3);
    expect(simplifyLine(line, 5000)).toHaveLength(2);
  });
});
