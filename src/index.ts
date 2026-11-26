export * from './core/reach-types.js';
export {
  MinHeap,
  compileBundle,
  clearCompiledRegions,
  evaluateEdgeCost,
  runDijkstra,
  computeBasecampScore,
  computeVitalStats,
  reconstructJourney,
  handleCompute,
  handleJourney,
  type AdjEdge,
  type CompiledRegion,
  type DijkstraState,
} from './core/routing-engine.js';
export {
  ReachTerrainLayer,
  type ReachPaletteName,
  type TerrainLayerOptions,
  type TerrainShaderStats,
} from './core/reach-terrain-layer.js';
export {
  exportReachCardPng,
  type ReachExportPalette,
  type ReachExportSnapshot,
} from './core/reach-export.js';
