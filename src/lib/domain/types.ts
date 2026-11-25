/**
 * アプリケーション全体で使う正規化済みのドメイン型。
 * 各プロバイダーのレスポンス形式はアダプター内に閉じ込め、ここで定義する型だけを外に出す。
 */

/** 検索できる移動手段。道路（車・バス）と電車のみ。徒歩・自転車は対象外（電車の乗り換えの徒歩区間は LegMode の "walk"） */
export type TransportMode = "train" | "bus" | "car";
export const TRANSPORT_MODES: readonly TransportMode[] = ["train", "bus", "car"];

/** [経度, 緯度]（GeoJSON と同じ順序） */
export type LonLat = [number, number];

export interface Place {
  lat: number;
  lon: number;
  label?: string;
}

/**
 * データの種類。画面上では必ずこの区別を表示する。
 * - official_forecast / official_observation: 公的機関が発表した予報・観測
 * - provider_forecast: 民間・オープンな気象モデル予報（公式発表ではない）
 * - provider_place: 地名・住所検索の結果
 * - provider_route: 経路プロバイダーが返した経路・所要時間
 * - provider_timetable: 時刻表データ由来の経路
 * - astronomical: 天文計算（太陽位置）
 * - modelled: 地物データからのモデル推定（建物の影など）
 * - estimate: 上記を組み合わせた推定値
 * - unavailable: データなし
 */
export type DataKind =
  | "official_forecast"
  | "official_observation"
  | "provider_forecast"
  | "provider_place"
  | "provider_route"
  | "provider_timetable"
  | "astronomical"
  | "modelled"
  | "estimate"
  | "unavailable";

export interface SourceRef {
  /** プロバイダーID（例: "open-meteo"） */
  provider: string;
  kind: DataKind;
  /** データが発表・更新された時刻（ISO 8601）。不明なら省略 */
  issuedAt?: string;
  /** 取得時刻（ISO 8601） */
  retrievedAt?: string;
  attribution?: string;
  note?: string;
}

/** 値が無いことを明示的に表す。0 や空文字で代用しない。 */
export type Maybe<T> =
  | { status: "available"; value: T; source: SourceRef }
  | { status: "unavailable"; reason: UnavailableReason; detail?: string };

export type UnavailableReason =
  | "not_configured"
  | "provider_error"
  | "timeout"
  | "out_of_range"
  | "out_of_season"
  | "stale"
  | "not_supported"
  | "insufficient_data"
  | "not_applicable";

export function available<T>(value: T, source: SourceRef): Maybe<T> {
  return { status: "available", value, source };
}
export function unavailable<T>(reason: UnavailableReason, detail?: string): Maybe<T> {
  return { status: "unavailable", reason, detail };
}

// ---------------------------------------------------------------- 経路

export type LegMode = "walk" | "cycle" | "car" | "rail" | "subway" | "tram" | "bus" | "ferry" | "other_transit";

export interface RouteLeg {
  mode: LegMode;
  /** 屋外を移動する区間か（徒歩・自転車）。車内・車両内は false */
  outdoor: boolean;
  /** ISO 8601（+09:00） */
  startTime: string;
  endTime: string;
  durationSec: number;
  distanceM: number;
  geometry: LonLat[];
  /**
   * geometry の各頂点を通過する、出発からの経過秒数。
   * プロバイダーが区間ごとの所要時間を返す場合はそれを使い、無い場合は距離に比例して配分する。
   */
  vertexOffsetsSec: number[];
  fromName?: string;
  toName?: string;
  routeName?: string;
  operatorName?: string;
  /** 時刻表上の定刻か、リアルタイム情報か */
  realtime?: boolean;
}

export interface RouteAlternative {
  id: string;
  mode: TransportMode;
  legs: RouteLeg[];
  startTime: string;
  endTime: string;
  durationSec: number;
  distanceM: number;
  walkingSec: number;
  /** 乗り換え回数（公共交通のみ） */
  transfers?: number;
  /** 乗り換え・待ち時間（秒）。屋外か屋内かは不明 */
  waitingSec?: number;
  source: SourceRef;
}

// ---------------------------------------------------------------- 太陽

export interface SolarPosition {
  /** 方位角（度）。北=0、東=90、時計回り */
  azimuthDeg: number;
  /** 高度角（度）。大気差補正なしの幾何学的高度 */
  elevationDeg: number;
  /** 大気差補正ありの見かけの高度 */
  apparentElevationDeg: number;
  /** 幾何学的地平線より上か */
  aboveHorizon: boolean;
}

/** 進行方向から見た太陽の方向 */
export type RelativeSunSide = "front" | "right" | "back" | "left" | "overhead" | "none";

// ---------------------------------------------------------------- 日陰

export type ShadeState = "shaded" | "exposed" | "unknown" | "night";

export type ShadeReason =
  | "building_shadow"
  | "inside_building"
  | "no_obstruction_found"
  | "obstruction_height_unknown"
  | "no_building_data"
  | "shade_data_unavailable"
  | "sun_below_horizon"
  | "sun_too_low"
  | "route_too_long"
  | "in_vehicle";

export interface ShadeSample {
  state: ShadeState;
  reason: ShadeReason;
  /** 高さが階数からの推定だった場合 true */
  usedEstimatedHeight?: boolean;
}

// ---------------------------------------------------------------- 気象

export interface WeatherValues {
  temperatureC?: number;
  relativeHumidityPct?: number;
  windSpeedMs?: number;
  cloudCoverPct?: number;
  precipitationProbabilityPct?: number;
  uvIndex?: number;
}

export interface WeatherSample {
  lat: number;
  lon: number;
  /** 予報の対象時刻（ISO 8601） */
  validTime: string;
  values: WeatherValues;
  source: SourceRef;
}

export type WbgtLevel = "almost_safe" | "caution" | "warning" | "severe_warning" | "danger";

export interface WbgtSample {
  stationId: string;
  stationName: string;
  distanceKm: number;
  validTime: string;
  wbgt: number;
  level: WbgtLevel;
  source: SourceRef;
}

// ---------------------------------------------------------------- 曝露推定

export interface SegmentEstimate {
  index: number;
  legIndex: number;
  /** 区間の中点 */
  lat: number;
  lon: number;
  startTime: string;
  durationSec: number;
  distanceM: number;
  outdoor: boolean;
  bearingDeg: number;
  sun: SolarPosition;
  relativeSun: RelativeSunSide;
  shade: ShadeSample;
}

export interface ExposureSummary {
  outdoorMin: number;
  /** 屋外にいる間に太陽が地平線より上にある時間 */
  sunUpOutdoorMin: number;
  /** 日陰推定の内訳（屋外・太陽が出ている時間のみ） */
  potentialSunMin: number;
  shadedMin: number;
  unknownShadeMin: number;
  /** 日陰判定ができた割合（0〜1） */
  shadeCoverage: number;
  /** 屋外時間に占める、太陽の相対方向別の時間（分） */
  relativeSunMin: Record<RelativeSunSide, number>;
  /** 推定の分解能（秒）。この値より細かい精度は主張しない */
  resolutionSec: number;
  method: CalculationMetadata;
}

/** 列車・自動車の車内左右の日差し推定 */
export interface VehicleSideExposure {
  legIndex: number;
  leftMin: number;
  rightMin: number;
  frontOrBackMin: number;
  lowSunMin: number;
  nightMin: number;
  totalMin: number;
  /** 日差しが少ないと推定される側 */
  shadierSide: "left" | "right" | "similar" | "unknown";
  /**
   * 左右の差は小さめ。分数では片側が少ないが、横から差し込む日差しの量（横向きの成分で重み付け）はほぼ同じ。
   * 反対側の日差しの多くが正面寄りから差し込む場合など。shadierSide が left / right のときだけ true になりうる。
   */
  slightDifference?: boolean;
  caveats: string[];
}

export interface CalculationMetadata {
  method: string;
  library?: string;
  inputs: string[];
  missingInputs: string[];
  assumptions: string[];
  sources: SourceRef[];
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------- 評価・ランキング

export type Preference =
  | "minimise_sun"
  | "prefer_shade"
  | "minimise_outdoor"
  | "minimise_time"
  | "reduce_walking"
  | "fewer_transfers"
  | "scenic"
  | "balanced";

export const PREFERENCES: readonly Preference[] = [
  "balanced",
  "minimise_sun",
  "prefer_shade",
  "minimise_outdoor",
  "minimise_time",
  "reduce_walking",
  "fewer_transfers",
  "scenic",
];

export type MetricKey = "durationMin" | "outdoorMin" | "walkingMin" | "potentialSunMin" | "shadedShare" | "transfers";

export interface RankingReason {
  code:
    | "shorter_duration"
    | "less_outdoor"
    | "less_walking"
    | "less_sun"
    | "more_shade"
    | "fewer_transfers"
    | "only_option";
  /** 2番目の候補との差 */
  diff?: number;
  unit?: "min" | "pct" | "count";
}

export interface RankedRoute {
  routeId: string;
  rank: number;
  /** 0〜100。比較対象の候補内での相対値であり、安全性を示すものではない */
  score: number | null;
  metricsUsed: MetricKey[];
  /** この候補で欠けていた指標（最も不利な値として扱った） */
  metricsMissing: MetricKey[];
  reasons: RankingReason[];
}

export interface RankingResult {
  ranked: RankedRoute[];
  appliedPreferences: Preference[];
  /** データが無いため反映できなかった希望条件 */
  ignoredPreferences: { preference: Preference; reason: "no_data" | "not_applicable" }[];
  weights: Partial<Record<MetricKey, number>>;
}

// ---------------------------------------------------------------- 暑さ警告

export type HeatWarningLevel = "info" | "caution" | "warning" | "danger";

export interface HeatWarning {
  level: HeatWarningLevel;
  code:
    | "wbgt_danger"
    | "wbgt_severe_warning"
    | "wbgt_warning"
    | "wbgt_caution"
    | "temperature_extreme"
    | "temperature_very_hot"
    | "uv_very_high"
    | "uv_high"
    | "wbgt_unavailable";
  value?: number;
  validTime?: string;
  source?: SourceRef;
}

// ---------------------------------------------------------------- 検索結果

export interface RouteWeatherSummary {
  samples: Maybe<WeatherSample[]>;
  temperatureRangeC?: [number, number];
  maxUvIndex?: number;
  maxPrecipitationProbabilityPct?: number;
  meanCloudCoverPct?: number;
  wbgt: Maybe<WbgtSample[]>;
  maxWbgt?: WbgtSample;
}

export interface EvaluatedRoute {
  route: RouteAlternative;
  segments: SegmentEstimate[];
  exposure: ExposureSummary;
  vehicleSides: VehicleSideExposure[];
  weather: RouteWeatherSummary;
  heatWarnings: HeatWarning[];
}


export interface ProviderNotice {
  provider: string;
  capability: "geocoding" | "routing" | "transit" | "weather" | "uv" | "wbgt" | "shade";
  status: "ok" | "unavailable" | "not_configured" | "demo_endpoint" | "partial";
  messageCode: string;
  detail?: string;
}

export interface JourneySearchResult {
  request: {
    origin: Place;
    destination: Place;
    departure: string;
    mode: TransportMode;
    preferences: Preference[];
  };
  status: "ok" | "no_routes" | "unsupported" | "provider_error";
  routes: EvaluatedRoute[];
  ranking: RankingResult | null;
  notices: ProviderNotice[];
  generatedAt: string;
}
