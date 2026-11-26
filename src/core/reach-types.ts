export type TravelMode = 'transit' | 'motor' | 'car' | 'walk';
export type AppPurposeMode = 'commuter' | 'tourist' | 'transit' | 'vital';
export type CombineMode = 'max' | 'avg';
export type TerrainEffect = 'wave' | 'pulse' | 'propagation' | 'clean';
export type TerrainPalette = 'atlas' | 'topo-gold' | 'crameri' | 'viridis';
export type CameraPreset = '3d' | 'horizon' | '2d';
export type NodeKind = 'hub' | 'station' | 'tourist' | 'hospital' | 'airport' | 'grid';

export interface QuickScenario {
  id: string;
  labelId: string;
  labelEn: string;
  purpose: AppPurposeMode;
  travelMode: TravelMode;
  originAId: string;
  originBId?: string;
  departMin: number;
  maxMinutes: number;
}

export interface RegionLocalOverlay {
  tag: string;
  accentColor: string;
  linesUrl?: string;
  stopsUrl?: string;
  toggleKey: string;
  railTitleKey: string;
  badgeKey?: string;
  legacyParam?: string;
}

export interface RegionManifestEntry {
  id: string;
  name: string;
  island?: 'sumatra' | 'java' | 'bali' | 'sulawesi';
  dataUrl: string;
  adminUrl?: string;
  localOverlay?: RegionLocalOverlay;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
  nodeCount: number;
  edgeCount: number;
  triangleCount: number;
  poiCount: number;
  defaultOriginId: string;
  defaultAnchorBId: string;
}

export interface RegionManifest {
  generatedAt: string;
  version: string;
  regions: RegionManifestEntry[];
}

export interface TransitLine {
  id: string;
  name: string;
  mode: 'rail' | 'mrt' | 'lrt' | 'hsr' | 'brt';
  color: string;
}

export interface ReachNode {
  id: string;
  name: string;
  lon: number;
  lat: number;
  kind: NodeKind;
  modes?: string[];
  category?: string;
}

/**
 * Compact edge tuple:
 * - Transit edge: [fromIdx, toIdx, 1, runMin, headwayOffPeak, headwayPeak, firstMin, lastMin, lineIdx]
 * - Road edge:    [fromIdx, toIdx, 0, distKm, roadClassCode] (0=toll, 1=arterial, 2=urban, 3=local)
 */
export type TransitEdgeTuple = [number, number, 1, number, number, number, number, number, number];
export type RoadEdgeTuple = [number, number, 0, number, number];
export type ReachEdgeTuple = TransitEdgeTuple | RoadEdgeTuple;

export interface RegionBundle {
  id: string;
  name: string;
  adminUrl?: string;
  motorTollAllowed?: boolean;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
  defaultOriginId: string;
  defaultAnchorBId: string;
  touristPresets?: string[];
  presetOriginIds?: string[];
  quickScenarios?: QuickScenario[];
  congestionCurve: {
    motor: number[];
    car: number[];
  };
  transitLines: TransitLine[];
  nodes: ReachNode[];
  edges: ReachEdgeTuple[];
  triangles: number[];
  skirtEdges: number[];
}

export interface ComputeRequest {
  type: 'compute';
  requestId: number;
  regionId: string;
  purpose: AppPurposeMode;
  travelMode: TravelMode;
  departMin: number;
  maxMinutes: number;
  originAId: string;
  originBId?: string | null;
  combineMode?: CombineMode;
  compareOriginId?: string | null;
  vitalTarget?: 'hospital' | 'airport';
}

export interface SweetSpotCandidate {
  nodeIdx: number;
  id: string;
  name: string;
  kind: NodeKind;
  lon: number;
  lat: number;
  timeA: number;
  timeB: number;
  combinedTime: number;
  fairnessGap: number;
}

export interface ReachablePoiSummary {
  nodeIdx: number;
  id: string;
  name: string;
  kind: NodeKind;
  category: string;
  lon: number;
  lat: number;
  minutes: number;
}

export interface BasecampScore {
  originId: string;
  originName: string;
  within45: number;
  within90: number;
  withinMax: number;
  totalTourists: number;
  avgTimeTop8: number;
  airportMinutes: number | null;
  topPois: ReachablePoiSummary[];
}

export interface VitalStats {
  target: 'hospital' | 'airport';
  hubCount: number;
  pctUnder15: number;
  pctUnder30: number;
  pctOver45: number;
  medianMinutes: number;
  nearestHubs: ReachablePoiSummary[];
}

export interface ComputeResult {
  type: 'result';
  requestId: number;
  regionId: string;
  purpose: AppPurposeMode;
  travelMode: TravelMode;
  departMin: number;
  times: Float32Array;
  timesA: Float32Array;
  timesB?: Float32Array;
  sweetSpots: SweetSpotCandidate[];
  basecampScore?: BasecampScore;
  compareScore?: BasecampScore;
  vitalStats?: VitalStats;
}

export interface JourneyRequest {
  type: 'journey';
  requestId: number;
  regionId: string;
  travelMode: TravelMode;
  departMin: number;
  originId: string;
  destIdx: number;
  originBId?: string | null;
}

export interface JourneyLeg {
  mode: 'walk' | 'motor' | 'car' | 'rail' | 'mrt' | 'lrt' | 'hsr' | 'brt' | 'feeder';
  lineName?: string;
  lineColor?: string;
  fromName: string;
  toName: string;
  minutes: number;
  waitMin: number;
  distKm: number;
}

export interface JourneyDetail {
  originName: string;
  destName: string;
  totalMinutes: number;
  totalWaitMin: number;
  transfers: number;
  totalDistKm: number;
  coords: [number, number][];
  legs: JourneyLeg[];
}

export interface JourneyResult {
  type: 'journeyResult';
  requestId: number;
  journeyA: JourneyDetail | null;
  journeyB: JourneyDetail | null;
}

export const UNREACHABLE_MIN = 9999;
