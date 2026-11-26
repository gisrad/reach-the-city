import {
  UNREACHABLE_MIN,
  type BasecampScore,
  type ComputeRequest,
  type ComputeResult,
  type JourneyDetail,
  type JourneyLeg,
  type JourneyRequest,
  type JourneyResult,
  type ReachablePoiSummary,
  type ReachEdgeTuple,
  type RegionBundle,
  type SweetSpotCandidate,
  type TravelMode,
  type VitalStats,
} from './reach-types.js';

export interface AdjEdge {
  to: number;
  edge: ReachEdgeTuple;
}

export interface CompiledRegion {
  bundle: RegionBundle;
  adj: AdjEdge[][];
}

export interface DijkstraState {
  dist: Float32Array;
  prevNode: Int32Array;
  prevEdge: Array<ReachEdgeTuple | null>;
  prevLineIdx: Int32Array;
  prevWait: Float32Array;
}

const compiledRegions = new Map<string, CompiledRegion>();

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export class MinHeap {
  private nodes: number[] = [];
  private costs: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, cost: number): void {
    this.nodes.push(node);
    this.costs.push(cost);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): { node: number; cost: number } | null {
    const n = this.nodes.length;
    if (n === 0) return null;
    const topNode = this.nodes[0];
    const topCost = this.costs[0];
    const lastNode = this.nodes.pop()!;
    const lastCost = this.costs.pop()!;
    if (n > 1) {
      this.nodes[0] = lastNode;
      this.costs[0] = lastCost;
      this.sinkDown(0);
    }
    return { node: topNode, cost: topCost };
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.costs[idx] >= this.costs[parent]) break;
      [this.nodes[idx], this.nodes[parent]] = [this.nodes[parent], this.nodes[idx]];
      [this.costs[idx], this.costs[parent]] = [this.costs[parent], this.costs[idx]];
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const len = this.nodes.length;
    while (true) {
      let smallest = idx;
      const l = idx * 2 + 1;
      const r = idx * 2 + 2;
      if (l < len && this.costs[l] < this.costs[smallest]) smallest = l;
      if (r < len && this.costs[r] < this.costs[smallest]) smallest = r;
      if (smallest === idx) break;
      [this.nodes[idx], this.nodes[smallest]] = [this.nodes[smallest], this.nodes[idx]];
      [this.costs[idx], this.costs[smallest]] = [this.costs[smallest], this.costs[idx]];
      idx = smallest;
    }
  }
}

export function compileBundle(bundle: RegionBundle): CompiledRegion {
  const n = bundle.nodes.length;
  const adj: AdjEdge[][] = Array.from({ length: n }, () => []);
  for (const edge of bundle.edges) {
    const u = edge[0];
    const v = edge[1];
    if (u >= 0 && u < n && v >= 0 && v < n) {
      adj[u].push({ to: v, edge });
      adj[v].push({ to: u, edge });
    }
  }
  const compiled = { bundle, adj };
  compiledRegions.set(bundle.id, compiled);
  return compiled;
}

export function clearCompiledRegions(): void {
  compiledRegions.clear();
}

function isPeakTime(minOfDay: number): boolean {
  const m = ((minOfDay % 1440) + 1440) % 1440;
  return (m >= 390 && m <= 570) || (m >= 990 && m <= 1170);
}

function isWithinServiceWindow(curMin: number, firstMin: number, lastMin: number): boolean {
  const m = ((curMin % 1440) + 1440) % 1440;
  if (lastMin >= firstMin) {
    return m >= firstMin && m <= lastMin;
  }
  return m >= firstMin || m <= lastMin;
}

export function evaluateEdgeCost(
  edge: ReachEdgeTuple,
  mode: TravelMode,
  curMinOfDay: number,
  prevLineIdx: number,
  bundle: RegionBundle
): { cost: number; waitMin: number; nextLineIdx: number } | null {
  if (edge[2] === 1) {
    if (mode !== 'transit') return null;
    const [, , , runMin, hwOff, hwPeak, firstMin, lastMin, lineIdx] = edge;
    if (!isWithinServiceWindow(curMinOfDay, firstMin, lastMin)) {
      return null;
    }
    const headway = isPeakTime(curMinOfDay) ? hwPeak : hwOff;
    let waitMin = 0;
    if (prevLineIdx !== lineIdx) {
      waitMin = headway * 0.5 + (prevLineIdx >= 0 ? 4 : 0);
    }
    return {
      cost: runMin + waitMin,
      waitMin,
      nextLineIdx: lineIdx,
    };
  }

  // Road edge: [u, v, 0, distKm, roadClass] (0=toll, 1=arterial, 2=urban, 3=local)
  const [, , , distKm, roadClass] = edge;
  const hour = Math.floor((((curMinOfDay % 1440) + 1440) % 1440) / 60);

  if (mode === 'walk') {
    if (roadClass === 0) return null;
    return {
      cost: (distKm / 4.8) * 60,
      waitMin: 0,
      nextLineIdx: -1,
    };
  }

  if (mode === 'transit') {
    if (roadClass === 0) return null;
    // Walking access near stations, slower local feeder beyond 2.4 km
    if (distKm <= 2.4) {
      return {
        cost: (distKm / 4.8) * 60,
        waitMin: 0,
        nextLineIdx: -1,
      };
    }
    const localMult = bundle.congestionCurve.car[hour] ?? 1.25;
    const feederMin = (distKm / (15.0 / Math.min(2.2, localMult))) * 60;
    const transferPenalty = prevLineIdx >= 0 ? 5 : 4;
    return {
      cost: feederMin + transferPenalty,
      waitMin: transferPenalty,
      nextLineIdx: -2,
    };
  }

  if (mode === 'motor') {
    // Allow motorbikes on tollways only when explicitly permitted by region metadata
    if (roadClass === 0 && !bundle.motorTollAllowed) return null;
    const baseSpeeds = [58, 38, 30, 23];
    const baseSpeed = baseSpeeds[roadClass] ?? 26;
    const curve = bundle.congestionCurve.motor[hour] ?? 1.15;
    const effectiveMult = roadClass === 0 ? 1 + (curve - 1) * 0.25 : curve;
    return {
      cost: (distKm / baseSpeed) * 60 * effectiveMult,
      waitMin: 0,
      nextLineIdx: -1,
    };
  }

  // Car mode
  const baseSpeeds = [70, 35, 22, 18];
  const baseSpeed = baseSpeeds[roadClass] ?? 22;
  const curve = bundle.congestionCurve.car[hour] ?? 1.3;
  const effectiveMult = roadClass === 0 ? 1 + (curve - 1) * 0.42 : curve;
  return {
    cost: (distKm / baseSpeed) * 60 * effectiveMult,
    waitMin: 0,
    nextLineIdx: -1,
  };
}

export function runDijkstra(
  compiled: CompiledRegion,
  seedIndices: number[],
  mode: TravelMode,
  departMin: number
): DijkstraState {
  const { bundle, adj } = compiled;
  const n = bundle.nodes.length;
  const dist = new Float32Array(n);
  dist.fill(UNREACHABLE_MIN);
  const prevNode = new Int32Array(n);
  prevNode.fill(-1);
  const prevEdge: Array<ReachEdgeTuple | null> = new Array(n).fill(null);
  const prevLineIdx = new Int32Array(n);
  prevLineIdx.fill(-1);
  const prevWait = new Float32Array(n);

  const heap = new MinHeap();
  for (const idx of seedIndices) {
    if (idx >= 0 && idx < n) {
      dist[idx] = 0;
      heap.push(idx, 0);
    }
  }

  while (heap.size > 0) {
    const top = heap.pop()!;
    const u = top.node;
    const d = top.cost;
    if (d > dist[u]) continue;

    const neighbors = adj[u];
    const curMin = departMin + d;
    const curLine = prevLineIdx[u];

    for (let i = 0; i < neighbors.length; i++) {
      const { to, edge } = neighbors[i];
      const step = evaluateEdgeCost(edge, mode, curMin, curLine, bundle);
      if (!step) continue;

      const alt = d + step.cost;
      if (alt < dist[to]) {
        dist[to] = alt;
        prevNode[to] = u;
        prevEdge[to] = edge;
        prevLineIdx[to] = step.nextLineIdx;
        prevWait[to] = step.waitMin;
        heap.push(to, alt);
      }
    }
  }

  return { dist, prevNode, prevEdge, prevLineIdx, prevWait };
}

export function computeBasecampScore(
  bundle: RegionBundle,
  originIdx: number,
  dist: Float32Array,
  maxMinutes: number
): BasecampScore {
  const originNode = bundle.nodes[originIdx] ?? bundle.nodes[0];
  const touristPois: ReachablePoiSummary[] = [];
  let within45 = 0;
  let within90 = 0;
  let withinMax = 0;
  let airportMinutes: number | null = null;

  for (let i = 0; i < bundle.nodes.length; i++) {
    const node = bundle.nodes[i];
    const m = dist[i];
    if (node.kind === 'airport' && m < UNREACHABLE_MIN) {
      if (airportMinutes === null || m < airportMinutes) {
        airportMinutes = Math.round(m);
      }
    }
    if (node.kind === 'tourist') {
      if (m <= 45) within45++;
      if (m <= 90) within90++;
      if (m <= maxMinutes) withinMax++;
      touristPois.push({
        nodeIdx: i,
        id: node.id,
        name: node.name,
        kind: node.kind,
        category: node.category || 'tourist',
        lon: node.lon,
        lat: node.lat,
        minutes: m >= UNREACHABLE_MIN ? UNREACHABLE_MIN : Math.round(m),
      });
    }
  }

  touristPois.sort((a, b) => a.minutes - b.minutes);
  const reachableTop = touristPois.filter((p) => p.minutes < UNREACHABLE_MIN).slice(0, 8);
  const avgTimeTop8 =
    reachableTop.length > 0
      ? Math.round(reachableTop.reduce((acc, p) => acc + p.minutes, 0) / reachableTop.length)
      : 0;

  return {
    originId: originNode.id,
    originName: originNode.name,
    within45,
    within90,
    withinMax,
    totalTourists: touristPois.length,
    avgTimeTop8,
    airportMinutes,
    topPois: touristPois.slice(0, 12),
  };
}

export function computeVitalStats(
  bundle: RegionBundle,
  dist: Float32Array,
  target: 'hospital' | 'airport',
  seedIndices: number[]
): VitalStats {
  const vals: number[] = [];
  let under15 = 0;
  let under30 = 0;
  let over45 = 0;

  for (let i = 0; i < bundle.nodes.length; i++) {
    const m = dist[i];
    if (m >= UNREACHABLE_MIN) continue;
    vals.push(m);
    if (m <= 15) under15++;
    if (m <= 30) under30++;
    if (m > 45) over45++;
  }

  vals.sort((a, b) => a - b);
  const total = Math.max(1, vals.length);
  const medianMinutes = vals.length > 0 ? Math.round(vals[Math.floor(vals.length * 0.5)]) : 0;

  const nearestHubs: ReachablePoiSummary[] = seedIndices.map((idx) => {
    const node = bundle.nodes[idx];
    return {
      nodeIdx: idx,
      id: node.id,
      name: node.name,
      kind: node.kind,
      category: node.category || target,
      lon: node.lon,
      lat: node.lat,
      minutes: 0,
    };
  });

  return {
    target,
    hubCount: seedIndices.length,
    pctUnder15: Math.round((under15 / total) * 100),
    pctUnder30: Math.round((under30 / total) * 100),
    pctOver45: Math.round((over45 / total) * 100),
    medianMinutes,
    nearestHubs: nearestHubs.slice(0, 12),
  };
}

export function reconstructJourney(
  compiled: CompiledRegion,
  state: DijkstraState,
  originIdx: number,
  destIdx: number,
  mode: TravelMode
): JourneyDetail | null {
  const { bundle } = compiled;
  if (destIdx < 0 || destIdx >= bundle.nodes.length) return null;
  if (state.dist[destIdx] >= UNREACHABLE_MIN) return null;

  const chain: Array<{
    fromIdx: number;
    toIdx: number;
    edge: ReachEdgeTuple;
    segMin: number;
    waitMin: number;
    lineIdx: number;
  }> = [];

  let cur = destIdx;
  let guard = 0;
  while (cur !== originIdx && cur >= 0 && guard < 1000) {
    guard++;
    const p = state.prevNode[cur];
    const e = state.prevEdge[cur];
    if (p < 0 || !e) break;
    const segMin = Math.max(0.5, state.dist[cur] - state.dist[p]);
    chain.push({
      fromIdx: p,
      toIdx: cur,
      edge: e,
      segMin,
      waitMin: state.prevWait[cur],
      lineIdx: state.prevLineIdx[cur],
    });
    cur = p;
  }

  chain.reverse();
  const coords: [number, number][] = [[bundle.nodes[originIdx].lon, bundle.nodes[originIdx].lat]];
  const legs: JourneyLeg[] = [];
  let totalWaitMin = 0;
  let totalDistKm = 0;
  let lastLineId = '';
  let transfers = 0;

  for (const seg of chain) {
    const uNode = bundle.nodes[seg.fromIdx];
    const vNode = bundle.nodes[seg.toIdx];
    coords.push([vNode.lon, vNode.lat]);

    const distKm =
      seg.edge[2] === 0
        ? seg.edge[3]
        : haversineKm(uNode.lon, uNode.lat, vNode.lon, vNode.lat);
    totalDistKm += distKm;
    totalWaitMin += seg.waitMin;

    let legMode: JourneyLeg['mode'] = mode === 'car' ? 'car' : mode === 'motor' ? 'motor' : 'walk';
    let lineName: string | undefined;
    let lineColor: string | undefined;

    if (seg.edge[2] === 1) {
      const line = bundle.transitLines[seg.edge[8]];
      if (line) {
        legMode = line.mode;
        lineName = line.name;
        lineColor = line.color;
        if (lastLineId && lastLineId !== line.id) transfers++;
        lastLineId = line.id;
      }
    } else if (mode === 'transit' && distKm > 2.4) {
      legMode = 'feeder';
      lineName = 'Feeder / Angkot';
    }

    const prevLeg = legs[legs.length - 1];
    if (prevLeg && prevLeg.mode === legMode && prevLeg.lineName === lineName) {
      prevLeg.toName = vNode.name;
      prevLeg.minutes += seg.segMin;
      prevLeg.waitMin += seg.waitMin;
      prevLeg.distKm += distKm;
    } else {
      legs.push({
        mode: legMode,
        lineName,
        lineColor,
        fromName: uNode.name,
        toName: vNode.name,
        minutes: seg.segMin,
        waitMin: seg.waitMin,
        distKm,
      });
    }
  }

  return {
    originName: bundle.nodes[originIdx].name,
    destName: bundle.nodes[destIdx].name,
    totalMinutes: Math.round(state.dist[destIdx]),
    totalWaitMin: Math.round(totalWaitMin),
    transfers,
    totalDistKm: +totalDistKm.toFixed(1),
    coords,
    legs: legs.map((l) => ({
      ...l,
      minutes: Math.max(1, Math.round(l.minutes)),
      waitMin: Math.round(l.waitMin),
      distKm: +l.distKm.toFixed(1),
    })),
  };
}

function findNodeIndex(bundle: RegionBundle, nodeId?: string | null): number {
  if (!nodeId) return -1;
  return bundle.nodes.findIndex((n) => n.id === nodeId);
}

export function handleCompute(req: ComputeRequest): ComputeResult {
  const compiled = compiledRegions.get(req.regionId);
  if (!compiled) {
    throw new Error(`Region ${req.regionId} not loaded in worker`);
  }
  const { bundle } = compiled;

  let originAIdx = findNodeIndex(bundle, req.originAId);
  if (originAIdx < 0) originAIdx = Math.max(0, findNodeIndex(bundle, bundle.defaultOriginId));

  if (req.purpose === 'vital') {
    const targetKind = req.vitalTarget ?? 'hospital';
    let seeds = bundle.nodes
      .map((n, idx) => (n.kind === targetKind ? idx : -1))
      .filter((idx) => idx >= 0);
    if (seeds.length === 0) seeds = [originAIdx];

    const state = runDijkstra(compiled, seeds, req.travelMode, req.departMin);
    const vitalStats = computeVitalStats(bundle, state.dist, targetKind, seeds);
    return {
      type: 'result',
      requestId: req.requestId,
      regionId: req.regionId,
      purpose: req.purpose,
      travelMode: req.travelMode,
      departMin: req.departMin,
      times: state.dist,
      timesA: state.dist,
      sweetSpots: [],
      vitalStats,
    };
  }

  const stateA = runDijkstra(compiled, [originAIdx], req.travelMode, req.departMin);
  let times = stateA.dist;
  let timesB: Float32Array | undefined;
  const sweetSpots: SweetSpotCandidate[] = [];

  if (req.purpose === 'commuter' && req.originBId) {
    const originBIdx = findNodeIndex(bundle, req.originBId);
    if (originBIdx >= 0 && originBIdx !== originAIdx) {
      const stateB = runDijkstra(compiled, [originBIdx], req.travelMode, req.departMin);
      timesB = stateB.dist;
      const combined = new Float32Array(bundle.nodes.length);
      const useAvg = req.combineMode === 'avg';

      for (let i = 0; i < bundle.nodes.length; i++) {
        const a = stateA.dist[i];
        const b = stateB.dist[i];
        if (a >= UNREACHABLE_MIN || b >= UNREACHABLE_MIN) {
          combined[i] = UNREACHABLE_MIN;
          continue;
        }
        combined[i] = useAvg ? 0.5 * (a + b) : Math.max(a, b);
        const node = bundle.nodes[i];
        if (
          i !== originAIdx &&
          i !== originBIdx &&
          (node.kind === 'hub' || node.kind === 'station' || node.kind === 'tourist')
        ) {
          sweetSpots.push({
            nodeIdx: i,
            id: node.id,
            name: node.name,
            kind: node.kind,
            lon: node.lon,
            lat: node.lat,
            timeA: Math.round(a),
            timeB: Math.round(b),
            combinedTime: Math.round(combined[i]),
            fairnessGap: Math.round(Math.abs(a - b)),
          });
        }
      }
      times = combined;
      sweetSpots.sort((x, y) => x.combinedTime - y.combinedTime || x.fairnessGap - y.fairnessGap);
    }
  }

  let basecampScore: BasecampScore | undefined;
  let compareScore: BasecampScore | undefined;
  if (req.purpose === 'tourist') {
    basecampScore = computeBasecampScore(bundle, originAIdx, stateA.dist, req.maxMinutes);
    if (req.compareOriginId) {
      const cmpIdx = findNodeIndex(bundle, req.compareOriginId);
      if (cmpIdx >= 0 && cmpIdx !== originAIdx) {
        const cmpState = runDijkstra(compiled, [cmpIdx], req.travelMode, req.departMin);
        compareScore = computeBasecampScore(bundle, cmpIdx, cmpState.dist, req.maxMinutes);
      }
    }
  }

  return {
    type: 'result',
    requestId: req.requestId,
    regionId: req.regionId,
    purpose: req.purpose,
    travelMode: req.travelMode,
    departMin: req.departMin,
    times,
    timesA: stateA.dist,
    timesB,
    sweetSpots: sweetSpots.slice(0, 6),
    basecampScore,
    compareScore,
  };
}

export function handleJourney(req: JourneyRequest): JourneyResult {
  const compiled = compiledRegions.get(req.regionId);
  if (!compiled) {
    return { type: 'journeyResult', requestId: req.requestId, journeyA: null, journeyB: null };
  }
  const { bundle } = compiled;
  let originAIdx = findNodeIndex(bundle, req.originId);
  if (originAIdx < 0) originAIdx = Math.max(0, findNodeIndex(bundle, bundle.defaultOriginId));

  const stateA = runDijkstra(compiled, [originAIdx], req.travelMode, req.departMin);
  const journeyA = reconstructJourney(compiled, stateA, originAIdx, req.destIdx, req.travelMode);

  let journeyB: JourneyDetail | null = null;
  if (req.originBId) {
    const originBIdx = findNodeIndex(bundle, req.originBId);
    if (originBIdx >= 0 && originBIdx !== originAIdx) {
      const stateB = runDijkstra(compiled, [originBIdx], req.travelMode, req.departMin);
      journeyB = reconstructJourney(compiled, stateB, originBIdx, req.destIdx, req.travelMode);
    }
  }

  return {
    type: 'journeyResult',
    requestId: req.requestId,
    journeyA,
    journeyB,
  };
}
