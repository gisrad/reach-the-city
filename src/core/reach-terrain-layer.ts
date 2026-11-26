import maplibregl from 'maplibre-gl';
import type { RegionBundle, TerrainEffect, TerrainPalette } from './reach-types.js';

export type ReachPaletteName = TerrainPalette | 'atlas';

export interface TerrainLayerOptions {
  maxMinutes?: number;
  reliefScale?: number;
  reverseRelief?: boolean;
  effect?: TerrainEffect;
  palette?: ReachPaletteName;
  reversePalette?: boolean;
  opacity?: number;
  lightBasemap?: boolean;
}

export interface TerrainShaderStats {
  vertexCount: number;
  triangleCount: number;
  skirtQuadCount: number;
  palette: ReachPaletteName;
  effect: TerrainEffect;
  maxMinutes: number;
  reliefScale: number;
  opacity: number;
  morphing: boolean;
}

const MORPH_DURATION_MS = 450;

const VERT_SRC = `#version 300 es
precision highp float;

in vec2 a_merc;
in float a_timePrev;
in float a_timeCurr;
in float a_skirt;
in vec3 a_normalPrev;
in vec3 a_normalCurr;

uniform mat4 u_matrix;
uniform float u_morph;
uniform float u_maxMin;
uniform float u_reliefScale;
uniform float u_reverseRelief;
uniform float u_mercPerMeter;

out vec3 v_mercPos;
out float v_time;
out float v_skirt;
out vec3 v_normal;

void main() {
  float safeMax = max(1.0, u_maxMin);
  float t = mix(a_timePrev, a_timeCurr, u_morph);
  float clampedT = clamp(t, 0.0, safeMax * 1.08);
  float norm = clamp(clampedT / safeMax, 0.0, 1.06);
  float elevFactor = u_reverseRelief > 0.5 ? (1.0 - min(norm, 1.0)) : norm;
  float meters = (a_skirt > 0.5) ? 0.0 : (elevFactor * u_reliefScale * 7200.0);
  float z = meters * u_mercPerMeter;

  // Store Y north-up in v_mercPos so dFdx/dFdy facet normals match East/North/Up vertex normals
  v_mercPos = vec3(a_merc.x, -a_merc.y, z);
  v_time = min(t, safeMax * 1.18);
  v_skirt = a_skirt;

  vec3 interpN = mix(a_normalPrev, a_normalCurr, u_morph);
  float nLen = length(interpN);
  v_normal = nLen > 1e-6 ? (interpN / nLen) : vec3(0.0, 0.0, 1.0);

  gl_Position = u_matrix * vec4(a_merc, z, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 v_mercPos;
in float v_time;
in float v_skirt;
in vec3 v_normal;

uniform float u_maxMin;
uniform float u_timeSec;
uniform int u_effect;
uniform int u_palette;
uniform float u_reversePalette;
uniform float u_opacity;
uniform float u_lightBasemap;

out vec4 fragColor;

vec3 rampAtlas(float x) {
  vec3 c0 = vec3(0.996, 0.953, 0.780); // champagne ivory (#FEF3C7)
  vec3 c1 = vec3(0.902, 0.722, 0.361); // warm ochre (#E6B85C)
  vec3 c2 = vec3(0.204, 0.659, 0.561); // fresh jade (#34A88F)
  vec3 c3 = vec3(0.114, 0.435, 0.541); // deep fjord teal (#1D6F8A)
  vec3 c4 = vec3(0.106, 0.231, 0.420); // twilight indigo (#1B3B6B)
  vec3 c5 = vec3(0.059, 0.122, 0.239); // nocturnal navy (#0F1F3D)
  if (x < 0.16) return mix(c0, c1, x / 0.16);
  if (x < 0.36) return mix(c1, c2, (x - 0.16) / 0.20);
  if (x < 0.58) return mix(c2, c3, (x - 0.36) / 0.22);
  if (x < 0.80) return mix(c3, c4, (x - 0.58) / 0.22);
  return mix(c4, c5, (x - 0.80) / 0.20);
}

vec3 rampTopoGold(float x) {
  vec3 c0 = vec3(0.992, 0.898, 0.451); // luminous valley gold
  vec3 c1 = vec3(0.953, 0.659, 0.204); // warm amber
  vec3 c2 = vec3(0.180, 0.722, 0.557); // emerald
  vec3 c3 = vec3(0.086, 0.486, 0.545); // deep teal
  vec3 c4 = vec3(0.098, 0.235, 0.412); // slate blue cliff
  vec3 c5 = vec3(0.067, 0.118, 0.220); // abyssal peak
  if (x < 0.16) return mix(c0, c1, x / 0.16);
  if (x < 0.36) return mix(c1, c2, (x - 0.16) / 0.20);
  if (x < 0.60) return mix(c2, c3, (x - 0.36) / 0.24);
  if (x < 0.84) return mix(c3, c4, (x - 0.60) / 0.24);
  return mix(c4, c5, (x - 0.84) / 0.16);
}

vec3 rampCrameri(float x) {
  vec3 c0 = vec3(0.980, 0.800, 0.980);
  vec3 c1 = vec3(0.847, 0.588, 0.353);
  vec3 c2 = vec3(0.545, 0.529, 0.227);
  vec3 c3 = vec3(0.141, 0.380, 0.380);
  vec3 c4 = vec3(0.063, 0.247, 0.376);
  vec3 c5 = vec3(0.004, 0.098, 0.349);
  if (x < 0.2) return mix(c0, c1, x / 0.2);
  if (x < 0.4) return mix(c1, c2, (x - 0.2) / 0.2);
  if (x < 0.6) return mix(c2, c3, (x - 0.4) / 0.2);
  if (x < 0.8) return mix(c3, c4, (x - 0.6) / 0.2);
  return mix(c4, c5, (x - 0.8) / 0.2);
}

vec3 rampViridis(float x) {
  vec3 c0 = vec3(0.993, 0.906, 0.144);
  vec3 c1 = vec3(0.369, 0.788, 0.384);
  vec3 c2 = vec3(0.129, 0.569, 0.549);
  vec3 c3 = vec3(0.231, 0.322, 0.545);
  vec3 c4 = vec3(0.267, 0.004, 0.329);
  if (x < 0.25) return mix(c0, c1, x / 0.25);
  if (x < 0.50) return mix(c1, c2, (x - 0.25) / 0.25);
  if (x < 0.75) return mix(c2, c3, (x - 0.50) / 0.25);
  return mix(c3, c4, (x - 0.75) / 0.25);
}

void main() {
  // Compute screen-space derivatives in uniform control flow before discard/branching
  vec3 dpdx = dFdx(v_mercPos);
  vec3 dpdy = dFdy(v_mercPos);
  float step15 = v_time / 15.0;
  float fw15 = max(fwidth(step15), 0.016);
  float step30 = v_time / 30.0;
  float fw30 = max(fwidth(step30), 0.012);

  float safeMax = max(1.0, u_maxMin);
  float edgeFade = 1.0 - smoothstep(safeMax * 0.94, safeMax * 1.025, v_time);
  if (edgeFade < 0.015) discard;

  float normT = clamp(v_time / safeMax, 0.0, 1.0);
  float palT = u_reversePalette > 0.5 ? (1.0 - normT) : normT;

  vec3 baseCol = (u_palette == 1)
    ? rampTopoGold(palT)
    : (u_palette == 2)
      ? rampCrameri(palT)
      : (u_palette == 3)
        ? rampViridis(palT)
        : rampAtlas(palT);

  // Blend 72% smooth vertex normal + 28% screen-space micro-facet normal
  vec3 fn = cross(dpdx, dpdy);
  float fnLen = length(fn);
  vec3 facetNormal = fnLen > 1e-12 ? (fn / fnLen) : vec3(0.0, 0.0, 1.0);
  if (facetNormal.z < 0.0 && v_skirt < 0.05) {
    facetNormal = -facetNormal;
  }
  vec3 smoothNormal = normalize(v_normal);
  vec3 normal = (v_skirt > 0.05)
    ? smoothNormal
    : normalize(mix(facetNormal, smoothNormal, 0.72));

  // Swiss Studio Two-Point Lighting: Warm NW sun + cool SE sky fill + valley richness
  vec3 sunDir = normalize(vec3(-0.55, 0.48, 0.68));
  vec3 fillDir = normalize(vec3(0.45, -0.35, 0.55));
  float sunDiff = clamp(dot(normal, sunDir), 0.0, 1.0);
  float fillDiff = clamp(dot(normal, fillDir), 0.0, 1.0);
  float valleyAO = mix(1.04, 0.88, smoothstep(0.0, 0.85, normT));

  vec3 studioLight =
    vec3(0.40, 0.42, 0.46) * valleyAO +
    vec3(1.04, 0.99, 0.92) * (sunDiff * 0.72) +
    vec3(0.84, 0.91, 1.00) * (fillDiff * 0.24);

  if (v_skirt > 0.05) {
    vec3 darkCliff = mix(baseCol * 0.46, vec3(0.04, 0.075, 0.135), 0.38 + 0.44 * v_skirt);
    vec3 lightCliff = mix(baseCol * 0.64, vec3(0.24, 0.30, 0.38), 0.32 + 0.42 * v_skirt);
    vec3 cliffBase = mix(darkCliff, lightCliff, u_lightBasemap);
    vec3 cliffCol = cliffBase * studioLight;
    fragColor = vec4(cliffCol, u_opacity * 0.95 * edgeFade);
    return;
  }

  vec3 col = baseCol * studioLight;

  // Anti-aliased 15-minute minor & 30/60-minute major hypsometric contours
  float f15 = abs(fract(step15 - 0.5) - 0.5);
  float minorLine = 1.0 - smoothstep(0.0, fw15 * 1.25, f15);
  float f30 = abs(fract(step30 - 0.5) - 0.5);
  float majorLine = 1.0 - smoothstep(0.0, fw30 * 1.35, f30);
  float contourMask = step(0.5, v_time) * (1.0 - smoothstep(safeMax * 0.95, safeMax * 1.01, v_time));

  col = mix(col, vec3(1.0), minorLine * 0.14 * contourMask);
  col = mix(col, vec3(0.973, 0.980, 0.988), majorLine * 0.26 * contourMask);

  // Outer frontier hairline around 0.935..1.005 * u_maxMin
  float outerRing =
    smoothstep(safeMax * 0.935, safeMax * 0.968, v_time) *
    (1.0 - smoothstep(safeMax * 0.968, safeMax * 1.005, v_time));
  vec3 outerColor = mix(vec3(0.973, 0.980, 0.988), vec3(0.10, 0.16, 0.25), u_lightBasemap);
  col = mix(col, outerColor, outerRing * 0.36);

  // Restrained animated time effects (0 = clean static Swiss relief by default)
  if (u_effect == 1) {
    float phase = fract(u_timeSec * 0.20);
    float distToWave = abs(normT - phase);
    float ring = exp(-pow(distToWave * 18.0, 2.0));
    col += vec3(0.32, 0.88, 0.78) * ring * 0.24;
  } else if (u_effect == 2) {
    float p = 0.5 + 0.5 * sin(normT * 16.0 - u_timeSec * 3.2);
    float boost = smoothstep(0.76, 1.0, p) * (1.0 - normT * 0.65);
    col += vec3(0.95, 0.82, 0.42) * boost * 0.16;
  } else if (u_effect == 3) {
    float front = fract(u_timeSec * 0.16);
    float behind = 1.0 - smoothstep(front - 0.04, front + 0.02, normT);
    float crest = exp(-pow((normT - front) * 20.0, 2.0));
    col = mix(col * 0.62, col, behind) + vec3(0.28, 0.86, 0.76) * crest * 0.30;
  }

  fragColor = vec4(col, u_opacity * edgeFade);
}
`;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[ReachTerrainLayer] Shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export class ReachTerrainLayer implements maplibregl.CustomLayerInterface {
  readonly id = 'reach-terrain-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: maplibregl.Map | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private mercBuf: WebGLBuffer | null = null;
  private prevBuf: WebGLBuffer | null = null;
  private currBuf: WebGLBuffer | null = null;
  private skirtBuf: WebGLBuffer | null = null;
  private normalPrevBuf: WebGLBuffer | null = null;
  private normalCurrBuf: WebGLBuffer | null = null;

  private vertexCount = 0;
  private triVertCount = 0;
  private skirtQuadCount = 0;
  private vertexNodeIdx = new Int32Array(0);
  private triIndices = new Uint32Array(0);

  private timePrevArr = new Float32Array(0);
  private timeCurrArr = new Float32Array(0);
  private normalPrevArr = new Float32Array(0);
  private normalCurrArr = new Float32Array(0);

  private nodeTimesPrev = new Float32Array(0);
  private nodeTimesCurr = new Float32Array(0);
  private nodeMetersX = new Float32Array(0);
  private nodeMetersY = new Float32Array(0);
  private nodeElevMeters = new Float32Array(0);
  private nodeAccumNx = new Float32Array(0);
  private nodeAccumNy = new Float32Array(0);
  private nodeAccumNz = new Float32Array(0);
  private skirtNormals = new Float32Array(0);

  private mercPerMeter = 1e-7;
  private morphStartTs = 0;
  private morphing = false;
  private buffersDirty = false;
  private geometryDirty = false;

  private mercData = new Float32Array(0);
  private skirtData = new Float32Array(0);

  private maxMinutes = 120;
  private reliefScale = 1.15;
  private reverseRelief = false;
  private effect: TerrainEffect = 'clean';
  private palette: ReachPaletteName = 'atlas';
  private reversePalette = false;
  private opacity = 0.86;
  private lightBasemap = true;

  private uMatrixLoc: WebGLUniformLocation | null = null;
  private uMorphLoc: WebGLUniformLocation | null = null;
  private uMaxMinLoc: WebGLUniformLocation | null = null;
  private uReliefLoc: WebGLUniformLocation | null = null;
  private uReverseReliefLoc: WebGLUniformLocation | null = null;
  private uMercPerMeterLoc: WebGLUniformLocation | null = null;
  private uTimeSecLoc: WebGLUniformLocation | null = null;
  private uEffectLoc: WebGLUniformLocation | null = null;
  private uPaletteLoc: WebGLUniformLocation | null = null;
  private uReversePaletteLoc: WebGLUniformLocation | null = null;
  private uOpacityLoc: WebGLUniformLocation | null = null;
  private uLightBasemapLoc: WebGLUniformLocation | null = null;

  setRegionGeometry(bundle: RegionBundle): void {
    const { nodes, triangles, skirtEdges, center } = bundle;
    const centerMerc = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
    this.mercPerMeter = centerMerc.meterInMercatorCoordinateUnits();
    const invMerc = 1.0 / Math.max(1e-12, this.mercPerMeter);

    const nodeCount = nodes.length;
    const nodeMercX = new Float32Array(nodeCount);
    const nodeMercY = new Float32Array(nodeCount);
    this.nodeMetersX = new Float32Array(nodeCount);
    this.nodeMetersY = new Float32Array(nodeCount);
    this.nodeElevMeters = new Float32Array(nodeCount);
    this.nodeAccumNx = new Float32Array(nodeCount);
    this.nodeAccumNy = new Float32Array(nodeCount);
    this.nodeAccumNz = new Float32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      const m = maplibregl.MercatorCoordinate.fromLngLat([nodes[i].lon, nodes[i].lat], 0);
      nodeMercX[i] = m.x;
      nodeMercY[i] = m.y;
      // Right-handed East (+x), North (+y) coordinates in meters
      this.nodeMetersX[i] = m.x * invMerc;
      this.nodeMetersY[i] = -m.y * invMerc;
    }

    const triVerts = triangles.length;
    const quadCount = Math.floor(skirtEdges.length / 2);
    const skirtVerts = quadCount * 6;
    const totalVerts = triVerts + skirtVerts;

    this.vertexCount = totalVerts;
    this.triVertCount = triVerts;
    this.skirtQuadCount = quadCount;
    this.triIndices = Uint32Array.from(triangles);

    this.mercData = new Float32Array(totalVerts * 2);
    this.skirtData = new Float32Array(totalVerts);
    this.vertexNodeIdx = new Int32Array(totalVerts);
    this.timePrevArr = new Float32Array(totalVerts);
    this.timeCurrArr = new Float32Array(totalVerts);
    this.normalPrevArr = new Float32Array(totalVerts * 3);
    this.normalCurrArr = new Float32Array(totalVerts * 3);

    this.nodeTimesPrev = new Float32Array(nodeCount).fill(this.maxMinutes);
    this.nodeTimesCurr = new Float32Array(nodeCount).fill(this.maxMinutes);

    // Map undirected triangle edges -> opposite interior vertex to orient cliff skirt normals outward
    const edgeOpposite = new Map<number, number>();
    const edgeKey = (u: number, v: number): number => (u < v ? u * 1048576 + v : v * 1048576 + u);
    for (let i = 0; i < triVerts; i += 3) {
      const i0 = triangles[i];
      const i1 = triangles[i + 1];
      const i2 = triangles[i + 2];
      edgeOpposite.set(edgeKey(i0, i1), i2);
      edgeOpposite.set(edgeKey(i1, i2), i0);
      edgeOpposite.set(edgeKey(i2, i0), i1);
    }

    // 1. Top surface triangles
    for (let i = 0; i < triVerts; i++) {
      const ni = triangles[i];
      this.vertexNodeIdx[i] = ni;
      this.mercData[i * 2] = nodeMercX[ni];
      this.mercData[i * 2 + 1] = nodeMercY[ni];
      this.skirtData[i] = 0.0;
    }

    // 2. Vertical boundary cliff skirts + outward tilted normals [nx, ny, 0.25]
    this.skirtNormals = new Float32Array(quadCount * 3);
    let vPtr = triVerts;
    for (let e = 0; e < quadCount * 2; e += 2) {
      const a = skirtEdges[e];
      const b = skirtEdges[e + 1];

      const ax = this.nodeMetersX[a];
      const ay = this.nodeMetersY[a];
      const ex = this.nodeMetersX[b] - ax;
      const ey = this.nodeMetersY[b] - ay;
      let px = -ey;
      let py = ex;

      const opp = edgeOpposite.get(edgeKey(a, b));
      if (opp !== undefined) {
        const cx = this.nodeMetersX[opp] - ax;
        const cy = this.nodeMetersY[opp] - ay;
        if (px * cx + py * cy > 0) {
          px = -px;
          py = -py;
        }
      }

      const hLen = Math.hypot(px, py);
      const nx = hLen > 1e-6 ? px / hLen : 0.0;
      const ny = hLen > 1e-6 ? py / hLen : -1.0;
      const nz = 0.25;
      const nLen = Math.hypot(nx, ny, nz);

      const qIdx = e / 2;
      this.skirtNormals[qIdx * 3] = nx / nLen;
      this.skirtNormals[qIdx * 3 + 1] = ny / nLen;
      this.skirtNormals[qIdx * 3 + 2] = nz / nLen;

      const quadNodes = [a, b, a, b, b, a];
      const quadSkirts = [0.25, 0.25, 1.0, 0.25, 1.0, 1.0];

      for (let q = 0; q < 6; q++) {
        const ni = quadNodes[q];
        this.vertexNodeIdx[vPtr] = ni;
        this.mercData[vPtr * 2] = nodeMercX[ni];
        this.mercData[vPtr * 2 + 1] = nodeMercY[ni];
        this.skirtData[vPtr] = quadSkirts[q];
        vPtr++;
      }
    }

    this.timePrevArr.fill(this.maxMinutes);
    this.timeCurrArr.fill(this.maxMinutes);
    this.recomputeNormals(true, true);

    this.geometryDirty = true;
    this.buffersDirty = true;
    this.map?.triggerRepaint();
  }

  private computeNormalsForTimes(nodeTimes: Float32Array, outVertexNormals: Float32Array): void {
    const nodeCount = this.nodeMetersX.length;
    if (nodeCount === 0 || this.vertexCount === 0) return;

    const safeMax = Math.max(1.0, this.maxMinutes);
    const maxClamped = safeMax * 1.08;
    const elevScale = this.reliefScale * 7200.0;

    for (let i = 0; i < nodeCount; i++) {
      const t = nodeTimes[i];
      const clampedT = t < 0 ? 0 : t > maxClamped ? maxClamped : t;
      let norm = clampedT / safeMax;
      if (norm > 1.06) norm = 1.06;
      const elevFactor = this.reverseRelief ? 1.0 - Math.min(norm, 1.0) : norm;
      this.nodeElevMeters[i] = elevFactor * elevScale;
    }

    this.nodeAccumNx.fill(0);
    this.nodeAccumNy.fill(0);
    this.nodeAccumNz.fill(0);

    const tris = this.triIndices;
    const mx = this.nodeMetersX;
    const my = this.nodeMetersY;
    const mz = this.nodeElevMeters;

    for (let i = 0; i < this.triVertCount; i += 3) {
      const i0 = tris[i];
      const i1 = tris[i + 1];
      const i2 = tris[i + 2];

      const ux = mx[i1] - mx[i0];
      const uy = my[i1] - my[i0];
      const uz = mz[i1] - mz[i0];

      const vx = mx[i2] - mx[i0];
      const vy = my[i2] - my[i0];
      const vz = mz[i2] - mz[i0];

      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;

      if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }

      this.nodeAccumNx[i0] += nx;
      this.nodeAccumNy[i0] += ny;
      this.nodeAccumNz[i0] += nz;

      this.nodeAccumNx[i1] += nx;
      this.nodeAccumNy[i1] += ny;
      this.nodeAccumNz[i1] += nz;

      this.nodeAccumNx[i2] += nx;
      this.nodeAccumNy[i2] += ny;
      this.nodeAccumNz[i2] += nz;
    }

    for (let i = 0; i < nodeCount; i++) {
      const nx = this.nodeAccumNx[i];
      const ny = this.nodeAccumNy[i];
      const nz = this.nodeAccumNz[i];
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-8) {
        const inv = 1.0 / len;
        this.nodeAccumNx[i] = nx * inv;
        this.nodeAccumNy[i] = ny * inv;
        this.nodeAccumNz[i] = nz * inv;
      } else {
        this.nodeAccumNx[i] = 0.0;
        this.nodeAccumNy[i] = 0.0;
        this.nodeAccumNz[i] = 1.0;
      }
    }

    // Top surface vertices
    for (let i = 0; i < this.triVertCount; i++) {
      const ni = this.vertexNodeIdx[i];
      const off = i * 3;
      outVertexNormals[off] = this.nodeAccumNx[ni];
      outVertexNormals[off + 1] = this.nodeAccumNy[ni];
      outVertexNormals[off + 2] = this.nodeAccumNz[ni];
    }

    // Cliff skirt quad vertices
    let vPtr = this.triVertCount;
    for (let qIdx = 0; qIdx < this.skirtQuadCount; qIdx++) {
      const sOff = qIdx * 3;
      const sx = this.skirtNormals[sOff];
      const sy = this.skirtNormals[sOff + 1];
      const sz = this.skirtNormals[sOff + 2];
      for (let q = 0; q < 6; q++) {
        const off = vPtr * 3;
        outVertexNormals[off] = sx;
        outVertexNormals[off + 1] = sy;
        outVertexNormals[off + 2] = sz;
        vPtr++;
      }
    }
  }

  private recomputeNormals(updatePrev = true, updateCurr = true): void {
    if (this.vertexCount === 0) return;
    if (updatePrev) {
      this.computeNormalsForTimes(this.nodeTimesPrev, this.normalPrevArr);
    }
    if (updateCurr) {
      this.computeNormalsForTimes(this.nodeTimesCurr, this.normalCurrArr);
    }
  }

  setTimes(nextTimes: Float32Array, immediate = false): void {
    if (nextTimes.length !== this.nodeTimesCurr.length) return;
    if (immediate) {
      this.nodeTimesPrev.set(nextTimes);
      this.nodeTimesCurr.set(nextTimes);
      this.morphing = false;
      this.computeNormalsForTimes(this.nodeTimesCurr, this.normalCurrArr);
      this.normalPrevArr.set(this.normalCurrArr);
    } else {
      this.nodeTimesPrev.set(this.nodeTimesCurr);
      this.nodeTimesCurr.set(nextTimes);
      this.morphStartTs = performance.now();
      this.morphing = true;
      this.normalPrevArr.set(this.normalCurrArr);
      this.computeNormalsForTimes(this.nodeTimesCurr, this.normalCurrArr);
    }

    for (let i = 0; i < this.vertexCount; i++) {
      const ni = this.vertexNodeIdx[i];
      this.timePrevArr[i] = this.nodeTimesPrev[ni];
      this.timeCurrArr[i] = this.nodeTimesCurr[ni];
    }

    this.buffersDirty = true;
    this.map?.triggerRepaint();
  }

  setOptions(opts: TerrainLayerOptions): void {
    let reliefChanged = false;
    if (opts.maxMinutes !== undefined && opts.maxMinutes !== this.maxMinutes) {
      this.maxMinutes = opts.maxMinutes;
      reliefChanged = true;
    }
    if (opts.reliefScale !== undefined && opts.reliefScale !== this.reliefScale) {
      this.reliefScale = opts.reliefScale;
      reliefChanged = true;
    }
    if (opts.reverseRelief !== undefined && opts.reverseRelief !== this.reverseRelief) {
      this.reverseRelief = opts.reverseRelief;
      reliefChanged = true;
    }
    if (opts.effect !== undefined) this.effect = opts.effect;
    if (opts.palette !== undefined) this.palette = opts.palette;
    if (opts.reversePalette !== undefined) this.reversePalette = opts.reversePalette;
    if (opts.opacity !== undefined) this.opacity = opts.opacity;
    if (opts.lightBasemap !== undefined) this.lightBasemap = opts.lightBasemap;

    if (reliefChanged && this.vertexCount > 0) {
      this.recomputeNormals(true, true);
      this.buffersDirty = true;
    }
    this.map?.triggerRepaint();
  }

  getShaderStats(): TerrainShaderStats {
    return {
      vertexCount: this.vertexCount,
      triangleCount: Math.floor(this.triVertCount / 3),
      skirtQuadCount: this.skirtQuadCount,
      palette: this.palette,
      effect: this.effect,
      maxMinutes: this.maxMinutes,
      reliefScale: this.reliefScale,
      opacity: this.opacity,
      morphing: this.morphing,
    };
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      console.warn('[ReachTerrainLayer] WebGL2 context required for 3D relief shader.');
      return;
    }
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[ReachTerrainLayer] Program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return;
    }
    this.program = prog;

    this.uMatrixLoc = gl.getUniformLocation(prog, 'u_matrix');
    this.uMorphLoc = gl.getUniformLocation(prog, 'u_morph');
    this.uMaxMinLoc = gl.getUniformLocation(prog, 'u_maxMin');
    this.uReliefLoc = gl.getUniformLocation(prog, 'u_reliefScale');
    this.uReverseReliefLoc = gl.getUniformLocation(prog, 'u_reverseRelief');
    this.uMercPerMeterLoc = gl.getUniformLocation(prog, 'u_mercPerMeter');
    this.uTimeSecLoc = gl.getUniformLocation(prog, 'u_timeSec');
    this.uEffectLoc = gl.getUniformLocation(prog, 'u_effect');
    this.uPaletteLoc = gl.getUniformLocation(prog, 'u_palette');
    this.uReversePaletteLoc = gl.getUniformLocation(prog, 'u_reversePalette');
    this.uOpacityLoc = gl.getUniformLocation(prog, 'u_opacity');
    this.uLightBasemapLoc = gl.getUniformLocation(prog, 'u_lightBasemap');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const aMerc = gl.getAttribLocation(prog, 'a_merc');
    const aPrev = gl.getAttribLocation(prog, 'a_timePrev');
    const aCurr = gl.getAttribLocation(prog, 'a_timeCurr');
    const aSkirt = gl.getAttribLocation(prog, 'a_skirt');
    const aNormalPrev = gl.getAttribLocation(prog, 'a_normalPrev');
    const aNormalCurr = gl.getAttribLocation(prog, 'a_normalCurr');

    this.mercBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.mercBuf);
    gl.enableVertexAttribArray(aMerc);
    gl.vertexAttribPointer(aMerc, 2, gl.FLOAT, false, 0, 0);

    this.prevBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.prevBuf);
    gl.enableVertexAttribArray(aPrev);
    gl.vertexAttribPointer(aPrev, 1, gl.FLOAT, false, 0, 0);

    this.currBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.currBuf);
    gl.enableVertexAttribArray(aCurr);
    gl.vertexAttribPointer(aCurr, 1, gl.FLOAT, false, 0, 0);

    this.skirtBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skirtBuf);
    gl.enableVertexAttribArray(aSkirt);
    gl.vertexAttribPointer(aSkirt, 1, gl.FLOAT, false, 0, 0);

    this.normalPrevBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalPrevBuf);
    gl.enableVertexAttribArray(aNormalPrev);
    gl.vertexAttribPointer(aNormalPrev, 3, gl.FLOAT, false, 0, 0);

    this.normalCurrBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalCurrBuf);
    gl.enableVertexAttribArray(aNormalCurr);
    gl.vertexAttribPointer(aNormalCurr, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    this.geometryDirty = true;
    this.buffersDirty = true;
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: maplibregl.CustomRenderMethodInput
  ): void {
    if (!this.gl || !this.program || !this.vao || this.vertexCount === 0) return;
    const gl2 = this.gl;

    const optAny = options as unknown as {
      defaultProjectionData?: { mainMatrix?: ArrayLike<number> };
      modelViewProjectionMatrix?: ArrayLike<number>;
    };
    const rawMatrix =
      optAny?.defaultProjectionData?.mainMatrix ??
      optAny?.modelViewProjectionMatrix ??
      (options as unknown as ArrayLike<number>);
    if (!rawMatrix) return;

    const matrix = rawMatrix instanceof Float32Array ? rawMatrix : new Float32Array(rawMatrix);

    if (this.geometryDirty) {
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.mercBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.mercData, gl2.STATIC_DRAW);

      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.skirtBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.skirtData, gl2.STATIC_DRAW);
      this.geometryDirty = false;
    }

    if (this.buffersDirty) {
      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.prevBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.timePrevArr, gl2.DYNAMIC_DRAW);

      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.currBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.timeCurrArr, gl2.DYNAMIC_DRAW);

      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.normalPrevBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.normalPrevArr, gl2.DYNAMIC_DRAW);

      gl2.bindBuffer(gl2.ARRAY_BUFFER, this.normalCurrBuf);
      gl2.bufferData(gl2.ARRAY_BUFFER, this.normalCurrArr, gl2.DYNAMIC_DRAW);
      this.buffersDirty = false;
    }

    let morph = 1.0;
    if (this.morphing) {
      const elapsed = performance.now() - this.morphStartTs;
      const p = Math.min(1, Math.max(0, elapsed / MORPH_DURATION_MS));
      morph = easeInOutCubic(p);
      if (p >= 1) {
        this.morphing = false;
      }
    }

    const effectInt =
      this.effect === 'wave'
        ? 1
        : this.effect === 'pulse'
          ? 2
          : this.effect === 'propagation'
            ? 3
            : 0;
    const paletteInt =
      this.palette === 'topo-gold'
        ? 1
        : this.palette === 'crameri'
          ? 2
          : this.palette === 'viridis'
            ? 3
            : 0;

    gl2.useProgram(this.program);
    gl2.bindVertexArray(this.vao);

    gl2.enable(gl2.DEPTH_TEST);
    gl2.depthFunc(gl2.LEQUAL);
    gl2.depthMask(true);
    gl2.enable(gl2.BLEND);
    gl2.blendFunc(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA);

    gl2.uniformMatrix4fv(this.uMatrixLoc, false, matrix);
    gl2.uniform1f(this.uMorphLoc, morph);
    gl2.uniform1f(this.uMaxMinLoc, this.maxMinutes);
    gl2.uniform1f(this.uReliefLoc, this.reliefScale);
    gl2.uniform1f(this.uReverseReliefLoc, this.reverseRelief ? 1.0 : 0.0);
    gl2.uniform1f(this.uMercPerMeterLoc, this.mercPerMeter);
    gl2.uniform1f(this.uTimeSecLoc, performance.now() * 0.001);
    gl2.uniform1i(this.uEffectLoc, effectInt);
    gl2.uniform1i(this.uPaletteLoc, paletteInt);
    gl2.uniform1f(this.uReversePaletteLoc, this.reversePalette ? 1.0 : 0.0);
    gl2.uniform1f(this.uOpacityLoc, this.opacity);
    gl2.uniform1f(this.uLightBasemapLoc, this.lightBasemap ? 1.0 : 0.0);

    gl2.drawArrays(gl2.TRIANGLES, 0, this.vertexCount);
    gl2.bindVertexArray(null);

    if (this.morphing || this.effect !== 'clean') {
      this.map?.triggerRepaint();
    }
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const gl2 = this.gl ?? (gl as WebGL2RenderingContext);
    if (this.program) gl2.deleteProgram(this.program);
    if (this.vao) gl2.deleteVertexArray(this.vao);
    if (this.mercBuf) gl2.deleteBuffer(this.mercBuf);
    if (this.prevBuf) gl2.deleteBuffer(this.prevBuf);
    if (this.currBuf) gl2.deleteBuffer(this.currBuf);
    if (this.skirtBuf) gl2.deleteBuffer(this.skirtBuf);
    if (this.normalPrevBuf) gl2.deleteBuffer(this.normalPrevBuf);
    if (this.normalCurrBuf) gl2.deleteBuffer(this.normalCurrBuf);
    this.program = null;
    this.vao = null;
    this.gl = null;
  }
}
