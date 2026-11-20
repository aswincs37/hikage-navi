"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, Marker as MlMarker, GeoJSONSource } from "maplibre-gl";
import type { LegMode, LonLat, Place, RelativeSunSide, ShadeState } from "@/lib/domain/types";
import { useI18n } from "@/lib/i18n/client";

export interface MapRoute {
  id: string;
  legs: { mode: LegMode; outdoor: boolean; geometry: LonLat[] }[];
}

export interface MapSegment {
  legIndex: number;
  lat: number;
  lon: number;
  outdoor: boolean;
  state: ShadeState;
  /** 乗車区間で、進行方向から見て太陽がどちら側にあるか（車窓の色分け用） */
  side?: RelativeSunSide;
}

interface Props {
  routes: MapRoute[];
  selectedId?: string;
  /** 選択中の経路の区間ごとの日陰推定（色分け表示用） */
  segments?: MapSegment[];
  origin?: Place | null;
  destination?: Place | null;
  onSelect?: (id: string) => void;
  /** スクリーンリーダー向けの地図の要約 */
  summary: string;
  className?: string;
}

const gsiStyle = (tilesLabel: string) => ({
  version: 8 as const,
  sources: {
    gsi: {
      type: "raster" as const,
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 18,
      attribution: `<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">${tilesLabel}</a> | © OpenStreetMap contributors`,
    },
  },
  layers: [{ id: "gsi", type: "raster" as const, source: "gsi" }],
});

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** 経路と出発地・目的地がすべて入る範囲（[[西, 南], [東, 北]]）。点が無ければ null */
function boundsOf(routes: MapRoute[], origin?: Place | null, destination?: Place | null): [LonLat, LonLat] | null {
  const pts: LonLat[] = routes.flatMap((r) => r.legs.flatMap((l) => l.geometry));
  if (origin) pts.push([origin.lon, origin.lat]);
  if (destination) pts.push([destination.lon, destination.lat]);
  if (pts.length === 0) return null;
  let [w, s] = pts[0]!;
  let [e, n] = pts[0]!;
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function RouteMap({ routes, selectedId, segments, origin, destination, onSelect, summary, className = "h-72 sm:h-96" }: Props) {
  const { m } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<MlMarker[]>([]);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // 地図を作るときの最初の表示範囲。最初から経路の範囲で開き、別の場所の地図画像を無駄に読み込まない
  const [initialBounds] = useState(() => boundsOf(routes, origin, destination));

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // 地図の初期化（クライアントでのみ。言語を切り替えたら操作ボタンの文言のため作り直す）
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    import("maplibre-gl")
      .then(({ Map, NavigationControl, setWorkerUrl }) => {
        if (cancelled || !container.current) return;
        // バンドル後は既定のワーカー位置が解決できないため、public/vendor に複製したものを使う（scripts/copy-maplibre-worker.mjs）
        setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
        map = new Map({
          container: container.current,
          style: gsiStyle(m.map.tiles),
          ...(initialBounds
            ? {
                bounds: initialBounds,
                fitBoundsOptions: { padding: Math.min(48, Math.round(container.current.clientWidth / 10)), maxZoom: 14 },
              }
            : { center: [139.767, 35.681] as LonLat, zoom: 10 }),
          attributionControl: { compact: true },
          cooperativeGestures: true,
          locale: {
            "CooperativeGesturesHandler.WindowsHelpText": m.map.windowsHelp,
            "CooperativeGesturesHandler.MacHelpText": m.map.macHelp,
            "CooperativeGesturesHandler.MobileHelpText": m.map.mobileHelp,
            "NavigationControl.ZoomIn": m.map.zoomIn,
            "NavigationControl.ZoomOut": m.map.zoomOut,
            "NavigationControl.ResetBearing": m.map.resetBearing,
          },
        });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => {
          if (!map) return;
          const ai = cssVar("--ai");
          map.addSource("routes", { type: "geojson", data: EMPTY });
          map.addSource("segments", { type: "geojson", data: EMPTY });
          map.addSource("vehicle-sides", { type: "geojson", data: EMPTY });
          // 検索前（経路がまだ無い）: 出発地と目的地を結ぶ直線（点線）。実際の経路ではないことが分かるよう点線にする
          map.addSource("preview", { type: "geojson", data: EMPTY });
          map.addLayer({
            id: "preview-line-casing",
            type: "line",
            source: "preview",
            paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
            layout: { "line-cap": "round" },
          });
          map.addLayer({
            id: "preview-line",
            type: "line",
            source: "preview",
            paint: { "line-color": ai, "line-width": 3.5, "line-dasharray": [2, 1.6] },
            layout: { "line-cap": "round" },
          });
          map.addLayer({
            id: "routes-other",
            type: "line",
            source: "routes",
            filter: ["==", ["get", "selected"], false],
            paint: { "line-color": cssVar("--unknown"), "line-width": 4, "line-opacity": 0.55 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          map.addLayer({
            id: "routes-selected-casing",
            type: "line",
            source: "routes",
            filter: ["==", ["get", "selected"], true],
            paint: { "line-color": cssVar("--surface"), "line-width": 10 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          map.addLayer({
            id: "routes-selected",
            type: "line",
            source: "routes",
            filter: ["==", ["get", "selected"], true],
            paint: { "line-color": ai, "line-width": 6 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          // 車窓の日差し（乗車区間のみ）: 左側=橙、右側=紫。凡例の文字でも示す
          map.addLayer({
            id: "seg-vehicle-side",
            type: "line",
            source: "vehicle-sides",
            paint: {
              "line-color": ["match", ["get", "side"], "left", cssVar("--sun-bright"), cssVar("--side-right")],
              "line-width": 6,
            },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          // 日陰の推定（屋外区間のみ）: 色と線種の両方で区別する
          map.addLayer({
            id: "seg-known",
            type: "line",
            source: "segments",
            filter: ["in", ["get", "state"], ["literal", ["shaded", "exposed"]]],
            paint: {
              "line-color": ["match", ["get", "state"], "shaded", cssVar("--shade"), cssVar("--sun")],
              "line-width": 6,
            },
            layout: { "line-cap": "butt" },
          });
          map.addLayer({
            id: "seg-unknown",
            type: "line",
            source: "segments",
            filter: ["in", ["get", "state"], ["literal", ["unknown", "night"]]],
            paint: { "line-color": cssVar("--unknown"), "line-width": 5, "line-dasharray": [1.2, 1.2] },
          });
          map.on("click", "routes-other", (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (typeof id === "string") onSelectRef.current?.(id);
          });
          map.on("mouseenter", "routes-other", () => map && (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", "routes-other", () => map && (map.getCanvas().style.cursor = ""));
          mapRef.current = map;
          setReady(true);
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [m, initialBounds]);

  // 経路・区間・マーカーの更新
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;

    const routeFeatures = routes.flatMap((r) =>
      r.legs.map((l) => ({
        type: "Feature" as const,
        properties: { id: r.id, selected: r.id === selectedId, vehicle: !l.outdoor },
        geometry: { type: "LineString" as const, coordinates: l.geometry },
      })),
    );
    (map.getSource("routes") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: routeFeatures });

    const segFeatures = [];
    const sideFeatures = [];
    const segs = segments ?? [];
    const selectedLegs = routes.find((r) => r.id === selectedId)?.legs ?? [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1]!;
      const b = segs[i]!;
      if (a.legIndex !== b.legIndex) continue;
      if (!b.outdoor) {
        // 地下鉄は窓の外に日が差さないため色分けしない
        if ((b.side === "left" || b.side === "right") && selectedLegs[b.legIndex]?.mode !== "subway") {
          sideFeatures.push({
            type: "Feature" as const,
            properties: { side: b.side },
            geometry: { type: "LineString" as const, coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
          });
        }
        continue;
      }
      segFeatures.push({
        type: "Feature" as const,
        properties: { state: b.state },
        geometry: { type: "LineString" as const, coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      });
    }
    (map.getSource("segments") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: segFeatures });
    (map.getSource("vehicle-sides") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: sideFeatures });
    const previewFeatures =
      routes.length === 0 && origin && destination
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates: [[origin.lon, origin.lat], [destination.lon, destination.lat]] },
            },
          ]
        : [];
    (map.getSource("preview") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: previewFeatures });

    import("maplibre-gl").then(({ Marker, LngLatBounds }) => {
      if (cancelled) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      const addMarker = (p: Place, label: string, bg: string) => {
        const el = document.createElement("div");
        el.textContent = label;
        el.setAttribute("aria-label", `${label}: ${p.label ?? ""}`);
        el.style.cssText = `background:${bg};color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.2)`;
        markers.current.push(new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
      };
      if (origin) addMarker(origin, m.map.origin, "#2f6b99");
      if (destination) addMarker(destination, m.map.destination, "#2a7a63");

      const pts: LonLat[] = routes.flatMap((r) => r.legs.flatMap((l) => l.geometry));
      if (origin) pts.push([origin.lon, origin.lat]);
      if (destination) pts.push([destination.lon, destination.lat]);
      if (pts.length === 1) map.jumpTo({ center: pts[0]!, zoom: 14 });
      else if (pts.length > 1) {
        const b = new LngLatBounds(pts[0]!, pts[0]!);
        pts.forEach((p) => b.extend(p));
        const pad = Math.min(56, Math.round((container.current?.clientWidth ?? 320) / 7));
        map.fitBounds(b, { padding: { top: pad + 8, bottom: pad, left: pad, right: pad + 24 }, maxZoom: 16, duration: 0 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, routes, selectedId, segments, origin, destination, m]);

  return (
    <figure className="relative overflow-hidden bg-surface-2">
      <div ref={container} className={`w-full ${className}`} role="img" aria-label={summary} />
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-sm text-muted">{m.map.failed}</p>}
      {segments && segments.length > 0 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-surface px-3 py-2 text-xs text-muted">
          {segments.some((s) => s.outdoor) && (
            <>
              <LegendSwatch color="var(--shade)" label={m.shadeStates.shaded} />
              <LegendSwatch color="var(--sun)" label={m.shadeStates.exposed} />
              <LegendSwatch color="var(--unknown)" label={m.map.legendUnknown(m.shadeStates.unknown, m.shadeStates.night)} dashed />
            </>
          )}
          {segments.some((s) => !s.outdoor && s.side !== undefined) ? (
            <>
              <LegendSwatch color="var(--sun-bright)" label={m.quick.legendSideLeft} />
              <LegendSwatch color="var(--side-right)" label={m.quick.legendSideRight} />
              <LegendSwatch color="var(--ai)" label={m.quick.legendSideOther} />
            </>
          ) : (
            <LegendSwatch color="var(--ai)" label={m.map.legendVehicle} />
          )}
        </figcaption>
      )}
    </figure>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="28" height="8" aria-hidden="true">
        <line x1="1" y1="4" x2="27" y2="4" stroke={color} strokeWidth="5" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {label}
    </span>
  );
}
