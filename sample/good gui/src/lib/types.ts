import type { ProfileKind } from "@/lib/engine/config";

export interface CityInfo {
  id: number;
  slug: string;
  name: string;
  state: string;
}

export interface StationInfo {
  id: string;
  citySlug: string;
  name: string;
  brand: string;
  lat: number;
  lon: number;
  profile: ProfileKind;
  is24h: boolean;
  deltaCt: number; // δ̂ in ct/L (Trainingsfenster)
}

export interface StationModel {
  predWk: number;
  predWe: number;
  shapeWk: number[]; // 18 Werte, Stunde 6..23
  shapeWe: number[];
  savesWk: number[]; // ct/L
  savesWe: number[];
  muWk: number;
  muWe: number;
  pWk: number;
  pWe: number;
}

export interface EvalRowDto {
  day: string;
  cls: number; // 0 Werktag | 1 Wochenende/Feiertag
  mu: number; // E[S] Training ct/L
  p: number; // P(S>0) Training
  s: number; // realisierte Ersparnis Warten ct/L
  best: number; // perfekte Sicht ct/L
  predHour: number;
}

export interface LabData {
  meta: {
    trainStart: string;
    evalStart: string;
    end: string;
    daysTrain: number;
    daysEval: number;
    decisionHour: number;
    defaultEps: number; // ct/L
    defaultLiters: number;
    tsLabel: string;
  };
  cities: CityInfo[];
  stations: StationInfo[];
  days: string[]; // alle lokalen Tage des Fensters
  models: Record<string, StationModel>;
  p8Series: Record<string, number[]>; // ct/L, 08:00-Preis je Tag (aligned zu days)
  decisions: Record<string, EvalRowDto[]>;
}
