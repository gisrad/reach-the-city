# Technical Architecture — Transbulent Reach Core

## 1. System Overview

Transbulent Reach separates **client-side spatial computation** from **optional edge traffic verification**:

```text
+-----------------------------------------------------------------------------+
| Browser Runtime (MapLibre GL + WebGL2 + Web Worker)                         |
|                                                                             |
|  [UI Controller] <---> [reach-worker.ts -> routing-engine.ts]               |
|         |                 - Time-dependent Dijkstra (binary min-heap)       |
|         |                 - Zero-copy Float32Array surface transfer         |
|         v                                                                   |
|  [reach-terrain-layer.ts (WebGL2 CustomLayerInterface)]                     |
|    - Mercator-scaled 3D triangles + outward-oriented coastal cliff skirts   |
|    - 450 ms cubic ease-in-out GPU morphing + blended vertex/facet normals   |
|    - Screen-space derivative (fwidth) 15-min & 30-min hypsometric contours  |
+-----------------------------------------------------------------------------+
                                      |
                                      | (Optional on-demand single-pair query)
                                      v
+-----------------------------------------------------------------------------+
| Private Edge Proxy (Cloudflare Worker)                                      |
|  - On-demand Google Routes API v2 & Places API (New) verification           |
|  - Strict Cache-Control: private, no-store (no persistent route storage)    |
+-----------------------------------------------------------------------------+
```

---

## 2. WebGL2 3D Travel-Time Surface (`src/core/reach-terrain-layer.ts`)

1. **MapLibre GL Integration (`renderingMode: '3d'`)**:
   - Reads `options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix`.
   - Converts region nodes into normalized Web Mercator coordinates via `MercatorCoordinate.fromLngLat`, retaining East/North meter offsets (`nodeMetersX`, `nodeMetersY`) to compute physically consistent 3D surface normals.
2. **Vertex Shader (GPU Morphing & Mercator Elevation)**:
   - Each vertex stores `a_timePrev`, `a_timeCurr`, `a_normalPrev`, `a_normalCurr`, and a boundary flag `a_skirt`.
   - When travel times update, `u_morph` animates `0 -> 1` over `450 ms` using `easeInOutCubic`.
   - Elevation maps `clamp(t / u_maxMin, 0, 1.06)` into meters scaled by `u_reliefScale * 7200.0 * u_mercPerMeter`, preserving conformal vertical scale at any latitude.
3. **Fragment Shader (Studio Lighting & Contours)**:
   - Computes screen-space partial derivatives (`dFdx`, `dFdy`, `fwidth`) in uniform control flow prior to `discard` branching.
   - Blends `72%` smooth vertex normals with `28%` screen-space micro-facet normals under a two-point warm-sun / cool-sky directional model.
   - Renders anti-aliased `15 min` minor and `30 min` major hypsometric contour lines plus an outer frontier ring near `u_maxMin`.
   - Supports 4 color ramps (`atlas`, `topo-gold`, `crameri`, `viridis`) and 4 temporal shader modes (`clean`, `wave`, `pulse`, `propagation`).

---

## 3. Multimodal Routing Engine (`src/core/routing-engine.ts`)

### Graph Representation
Regions load as compact `RegionBundle` objects (`src/core/reach-types.ts`) containing:
- `nodes[]`: transit hubs, stations, tourist POIs, hospitals, airports, and land-clipped mesh fill nodes.
- `edges[]`: compact tuples separating scheduled transit segments from road segments:
  - Transit edge: `[fromIdx, toIdx, 1, runMin, headwayOffPeak, headwayPeak, firstMin, lastMin, lineIdx]`
  - Road edge: `[fromIdx, toIdx, 0, distKm, roadClassCode]` (`0 = toll`, `1 = arterial`, `2 = urban`, `3 = local`)
- `triangles[]` & `skirtEdges[]`: Delaunay mesh indices and outer shoreline edges for vertical cliff walls.

### Time-Dependent Cost Model
- **Transit (`mode === 'transit'`)**:
  - Scheduled edges are active only when `(departMin + elapsed) mod 1440` falls inside `[firstMin, lastMin]` (supporting overnight wrap-around).
  - Boarding a new line adds `0.5 * headway` (switching between `headwayPeak` during `06:30–09:30` / `16:30–19:30` and `headwayOffPeak`), plus a `4 min` transfer penalty when changing lines.
  - Non-toll road edges within `2.4 km` act as walking access (`4.8 km/h`); longer links act as local feeder connections scaled by hourly road congestion.
- **Road Modes (`car`, `motor`, `walk`)**:
  - `walk` excludes toll roads (`roadClass === 0`) and travels at `4.8 km/h`.
  - `motor` excludes toll roads unless `bundle.motorTollAllowed === true` and applies hourly motorcycle congestion multipliers.
  - `car` uses hourly automobile congestion curves with damped sensitivity on grade-separated tollways.

### Decision Algorithms
1. **Single Origin & Journey Reconstruction**: Binary min-heap Dijkstra produces a `Float32Array` of node times plus `prevNode`/`prevEdge` arrays for `< 1 ms` leg-by-leg route reconstruction.
2. **Commuter Dual-Anchor Sweet Spot**: Executes two Dijkstra passes (`originA`, `originB`) and evaluates `max(tA, tB)` (minimax fairness) or `0.5 * (tA + tB)` (minimum total), ranking candidate hubs by combined duration and `|tA - tB|`.
3. **Tourist Basecamp**: Evaluates destination reachability within `45 min`, `90 min`, and `maxMinutes`, airport transfer duration, and top-8 mean access time.
4. **Vital Multi-Source**: Seeds the min-heap simultaneously with all `hospital` or `airport` nodes at `t = 0`, reporting `< 15 min`, `< 30 min`, `> 45 min` coverage shares and median travel time.

---

## 4. Hybrid Live Verification Contract

1. **Zero-Cost Exploration**: All 3D terrain surfaces and isochrone calculations run 100% locally in the browser Web Worker without invoking paid APIs on map clicks.
2. **ToS-Compliant On-Demand Verification**: When deployed with a private Edge Worker, optional live traffic checks query Google Routes API v2 for a single origin–destination pair and active travel mode (`DRIVE`, `TWO_WHEELER`, `TRANSIT`), returning duration/distance comparisons with `Cache-Control: private, no-store` and linking out to Google Maps without caching responses or rendering Google route polylines on non-Google basemaps.
