import type { Building } from "@/lib/shade/engine";
import type { LonLat, Maybe, Place, RouteAlternative, SourceRef, WbgtSample, WeatherSample } from "@/lib/domain/types";

/**
 * プロバイダーアダプターの共通インターフェース。
 * 各アダプターはここで定義した正規化済みの型だけを返す。
 */

export interface GeocodeResult extends Place {
  label: string;
  /** 結果の種類（住所・駅・施設など、プロバイダーが分かる範囲） */
  category?: string;
  /** 候補の2行目に出す補足（市区町村・都道府県など） */
  detail?: string;
  source: SourceRef;
}

export interface GeocodeOptions {
  /** 表示言語。対応するプロバイダーは地名をこの言語で返す */
  lang?: "ja" | "en";
}

export interface GeocodingProvider {
  readonly id: string;
  search(query: string, opts?: GeocodeOptions): Promise<GeocodeResult[]>;
}

/** 徒歩・自転車・自動車の経路 */
export interface StreetRoutingProvider {
  readonly id: string;
  route(origin: Place, destination: Place, departure: Date): Promise<RouteAlternative[]>;
}

/** 鉄道・バスの経路（時刻表データが必要） */
export interface TransitRoutingProvider {
  readonly id: string;
  /** 対応する移動手段（省略時は電車・バスの両方） */
  readonly modes?: readonly ("train" | "bus")[];
  plan(origin: Place, destination: Place, departure: Date, mode: "train" | "bus"): Promise<RouteAlternative[]>;
}

export interface WeatherQueryPoint {
  lat: number;
  lon: number;
  time: Date;
}

/**
 * 気温・湿度・風速・雲量・降水確率・UVインデックスを返す。
 * UVインデックスも同じアダプターから取得するが、出典（SourceRef）は個別に表示する。
 */
export interface WeatherProvider {
  readonly id: string;
  forecast(points: WeatherQueryPoint[]): Promise<(WeatherSample | null)[]>;
}

/** 公式の暑さ指数（WBGT）予報。提供期間外・データが古い場合は unavailable を返す */
export interface WbgtProvider {
  readonly id: string;
  forecast(points: WeatherQueryPoint[]): Promise<Maybe<(WbgtSample | null)[]>>;
}

export interface ShadeDataProvider {
  readonly id: string;
  /** 経路（複数可）から radiusM 以内の建物を返す */
  buildingsNear(lines: LonLat[][], radiusM: number): Promise<{ buildings: Building[]; source: SourceRef }>;
}

export type { LonLat };
