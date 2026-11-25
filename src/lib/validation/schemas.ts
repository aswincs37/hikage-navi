import { z } from "zod";
import { PREFERENCES, TRANSPORT_MODES, type Place, type Preference, type TransportMode } from "@/lib/domain/types";
import { haversineM, isWithinJapan } from "@/lib/geo/geometry";
import { parseDateTime } from "@/lib/time/tokyo";

/**
 * API 入力の検証。エラーは機械可読なコードで返し、画面側で日本語に変換する。
 */

const placeSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  label: z.string().max(200).optional(),
});

export const journeyRequestSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  departure: z.string().max(40),
  mode: z.enum(TRANSPORT_MODES as [TransportMode, ...TransportMode[]]),
  preferences: z.array(z.enum(PREFERENCES as [Preference, ...Preference[]])).max(PREFERENCES.length).default([]),
});

/** 出発地・目的地間の直線距離の上限（km） */
export const MAX_DISTANCE_KM: Record<TransportMode, number> = {
  car: 1200,
  train: 1200,
  bus: 1200,
};

/** 出発日時として受け付ける範囲 */
export const MAX_PAST_HOURS = 24;
export const MAX_FUTURE_DAYS = 30;

export interface JourneyRequest {
  origin: Place;
  destination: Place;
  departure: Date;
  mode: TransportMode;
  preferences: Preference[];
}

export type ValidationIssue = { field: string; code: string };

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/**
 * Zod の検証エラーを API の issues に変換する。
 * Zod v4 のコードは invalid_type・invalid_value のように既に invalid_ で始まるものがあるため、二重に付けない。
 */
export function toValidationIssues(issues: readonly { path: PropertyKey[]; code: string }[], emptyField = "body"): ValidationIssue[] {
  return issues.map((i) => ({
    field: i.path.map(String).join(".") || emptyField,
    code: i.code.startsWith("invalid_") ? i.code : `invalid_${i.code}`,
  }));
}

export function validateJourneyRequest(input: unknown, now: Date = new Date()): Validated<JourneyRequest> {
  const parsed = journeyRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: toValidationIssues(parsed.error.issues),
    };
  }
  const v = parsed.data;
  const issues: ValidationIssue[] = [];
  if (!isWithinJapan(v.origin.lat, v.origin.lon)) issues.push({ field: "origin", code: "outside_japan" });
  if (!isWithinJapan(v.destination.lat, v.destination.lon)) issues.push({ field: "destination", code: "outside_japan" });

  const distKm = haversineM([v.origin.lon, v.origin.lat], [v.destination.lon, v.destination.lat]) / 1000;
  if (distKm < 0.02) issues.push({ field: "destination", code: "same_place" });
  else if (distKm > MAX_DISTANCE_KM[v.mode]) issues.push({ field: "destination", code: "too_far_for_mode" });

  const departure = parseDateTime(v.departure);
  if (!departure) issues.push({ field: "departure", code: "invalid_datetime" });
  else if (now.getTime() - departure.getTime() > MAX_PAST_HOURS * 3_600_000) issues.push({ field: "departure", code: "too_far_past" });
  else if (departure.getTime() - now.getTime() > MAX_FUTURE_DAYS * 86_400_000) issues.push({ field: "departure", code: "too_far_future" });

  if (issues.length > 0 || !departure) return { ok: false, issues };
  return { ok: true, value: { origin: v.origin, destination: v.destination, departure, mode: v.mode, preferences: v.preferences } };
}

export const DEFAULT_COMPARISON_TIMES = ["09:00", "11:00", "13:00", "15:00", "17:00"];

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export function validateDepartureTimes(input: unknown): Validated<string[]> {
  if (input === undefined) return { ok: true, value: DEFAULT_COMPARISON_TIMES };
  const parsed = z.array(timeSchema).min(1).max(8).safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ field: "times", code: "invalid_times" }] };
  return { ok: true, value: [...new Set(parsed.data)].sort() };
}

export const sunPositionSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  datetime: z.string().max(40),
});

export const exposureRequestSchema = z.object({
  geometry: z.array(z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])).min(2).max(5000),
  departure: z.string().max(40),
  durationSec: z.number().positive().max(86_400),
  mode: z.enum(["car", "rail", "bus"]),
});
