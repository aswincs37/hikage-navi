import type { Endpoint } from "@/lib/config/env";
import type { LonLat, SourceRef } from "@/lib/domain/types";
import { samplePointsAlong } from "@/lib/geo/geometry";
import { fetchJson, TtlCache } from "@/lib/http/fetch";
import { buildingHeightFromTags, type Building } from "@/lib/shade/engine";
import type { ShadeDataProvider } from "./types";

/**
 * OpenStreetMap の建物（building / building:part）を Overpass API から取得する。
 * 高さは height タグ、無ければ building:levels × 3m で推定し、どちらも無ければ「高さ不明」とする。
 * OSM のデータは ODbL。表示時に「© OpenStreetMap contributors」の帰属表示が必要。
 */

interface OverpassElement {
  type: "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

const cache = new TtlCache<Building[]>(24 * 60 * 60 * 1000, 50);

export class OverpassShadeDataProvider implements ShadeDataProvider {
  readonly id = "osm-overpass";
  constructor(
    private readonly endpoint: Endpoint,
    private readonly http: { timeoutMs: number; userAgent: string },
  ) {}

  async buildingsNear(lines: LonLat[][], radiusM: number): Promise<{ buildings: Building[]; source: SourceRef }> {
    const q = buildCorridorQuery(lines, radiusM);
    const buildings = await cache.getOrLoad(q, async () => {
      const data = await fetchJson<{ elements?: OverpassElement[] }>(this.endpoint.url, {
        provider: this.id,
        method: "POST",
        body: `data=${encodeURIComponent(q)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        ...this.http,
      });
      return parseOverpassBuildings(data.elements ?? []);
    });
    return {
      buildings,
      source: {
        provider: this.id,
        kind: "modelled",
        retrievedAt: new Date().toISOString(),
        attribution: "© OpenStreetMap contributors (ODbL)",
      },
    };
  }
}

/**
 * 経路沿いの回廊内の建物を取得する Overpass QL。
 * around フィルターに座標列を渡すと折れ線からの距離で絞り込める。座標は約50m間隔に間引く。
 */
export function buildCorridorQuery(lines: LonLat[][], radiusM: number): string {
  const r = Math.round(radiusM);
  const clauses = lines
    .filter((l) => l.length > 0)
    .flatMap((line) => {
      const pts = samplePointsAlong(line, 50, 250)
        .map(({ point: [lon, lat] }) => `${lat.toFixed(5)},${lon.toFixed(5)}`)
        .join(",");
      return [`way["building"](around:${r},${pts});`, `way["building:part"](around:${r},${pts});`, `relation["building"]["type"="multipolygon"](around:${r},${pts});`];
    });
  return `[out:json][timeout:25];(${clauses.join("")});out tags geom;`;
}

export function parseOverpassBuildings(elements: OverpassElement[]): Building[] {
  const out: Building[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const height = buildingHeightFromTags(tags);
    const rings: LonLat[][] = [];
    if (el.type === "way" && el.geometry) {
      rings.push(el.geometry.map((g) => [g.lon, g.lat]));
    } else if (el.type === "relation" && el.members) {
      for (const m of el.members) {
        if (m.role === "outer" && m.geometry) rings.push(m.geometry.map((g) => [g.lon, g.lat]));
      }
    }
    rings.forEach((ring, i) => {
      const closed = ring.length >= 4 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
      if (closed) out.push({ id: `${el.type}/${el.id}${rings.length > 1 ? `#${i}` : ""}`, ring, ...height });
    });
  }
  return out;
}
