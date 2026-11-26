import type { TerrainPalette } from './reach-types.js';

export type ReachExportPalette = TerrainPalette | 'atlas';

export interface ReachExportSnapshot {
  mapCanvas: HTMLCanvasElement;
  title: string;
  subtitle: string;
  badgeText: string;
  maxMinutes: number;
  palette: ReachExportPalette;
  reversePalette: boolean;
  attribution: string;
}

const PALETTE_GRADIENTS: Record<ReachExportPalette, string[]> = {
  atlas: ['#FEF3C7', '#E6B85C', '#34A88F', '#1D6F8A', '#1B3B6B', '#0F1F3D'],
  'topo-gold': ['#FDE68A', '#F3A834', '#2EB88E', '#167C8B', '#193C69', '#111E38'],
  crameri: ['#FACCFA', '#D8965A', '#8B873A', '#246161', '#103F60', '#011959'],
  viridis: ['#FDE725', '#5EC962', '#21918C', '#3B528B', '#440154'],
};

export async function exportReachCardPng(
  aspect: '16:9' | '4:5',
  snap: ReachExportSnapshot
): Promise<void> {
  const width = aspect === '16:9' ? 1920 : 1080;
  const height = aspect === '16:9' ? 1080 : 1350;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#070C16';
  ctx.fillRect(0, 0, width, height);

  // Draw cover-cropped MapLibre WebGL canvas
  const srcW = snap.mapCanvas.width;
  const srcH = snap.mapCanvas.height;
  if (srcW > 0 && srcH > 0) {
    const scale = Math.max(width / srcW, height / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (width - drawW) * 0.5;
    const dy = (height - drawH) * 0.5;
    ctx.drawImage(snap.mapCanvas, dx, dy, drawW, drawH);
  }

  // Swiss editorial vignette scrims
  const topGrad = ctx.createLinearGradient(0, 0, 0, height * 0.28);
  topGrad.addColorStop(0, 'rgba(7, 12, 22, 0.92)');
  topGrad.addColorStop(1, 'rgba(7, 12, 22, 0.0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, width, height * 0.28);

  const botGrad = ctx.createLinearGradient(0, height * 0.72, 0, height);
  botGrad.addColorStop(0, 'rgba(7, 12, 22, 0.0)');
  botGrad.addColorStop(1, 'rgba(7, 12, 22, 0.94)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, height * 0.72, width, height * 0.28);

  const pad = aspect === '16:9' ? 72 : 56;

  // Swiss outer frame hairline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 24.5, width - 49, height - 49);

  // Brand tag
  ctx.fillStyle = '#E6B85C';
  ctx.font = '600 18px "IBM Plex Mono", monospace';
  ctx.fillText('TRANSBULENT REACH · 3D TRAVEL-TIME TOPOGRAPHY', pad, pad + 14);

  // Title
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `700 ${aspect === '16:9' ? 52 : 42}px "Overused Grotesk", system-ui, sans-serif`;
  ctx.fillText(snap.title, pad, pad + 76, width - pad * 2);

  // Subtitle
  ctx.fillStyle = '#CBD5E1';
  ctx.font = `400 ${aspect === '16:9' ? 25 : 22}px "Overused Grotesk", system-ui, sans-serif`;
  ctx.fillText(snap.subtitle, pad, pad + 118, width - pad * 2);

  // Swiss hairline badge pill
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  const pillW = Math.min(width - pad * 2, ctx.measureText(snap.badgeText).width + 38);
  ctx.fillStyle = 'rgba(11, 18, 32, 0.78)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pad, pad + 142, pillW, 40, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(snap.badgeText, pad + 19, pad + 168);

  // Footer hairline divider
  const footerTop = height - pad - 76;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, footerTop);
  ctx.lineTo(width - pad, footerTop);
  ctx.stroke();

  // Footer Legend Ramp
  const barY = height - pad - 48;
  const barW = Math.min(480, width - pad * 2);
  const stops = [...(PALETTE_GRADIENTS[snap.palette] ?? PALETTE_GRADIENTS.atlas)];
  if (snap.reversePalette) stops.reverse();

  const ramp = ctx.createLinearGradient(pad, 0, pad + barW, 0);
  stops.forEach((col, i) => ramp.addColorStop(i / (stops.length - 1), col));
  ctx.fillStyle = ramp;
  ctx.beginPath();
  ctx.roundRect(pad, barY, barW, 12, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#E2E8F0';
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText('0 min', pad, barY + 38);
  const midLabel = `${Math.round(snap.maxMinutes * 0.5)} min`;
  const midW = ctx.measureText(midLabel).width;
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(midLabel, pad + (barW - midW) * 0.5, barY + 38);
  const maxLabel = `${snap.maxMinutes} min`;
  const maxW = ctx.measureText(maxLabel).width;
  ctx.fillStyle = '#E2E8F0';
  ctx.fillText(maxLabel, pad + barW - maxW, barY + 38);

  // Attribution right
  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  const attrW = ctx.measureText(snap.attribution).width;
  ctx.fillText(snap.attribution, width - pad - attrW, barY + 38);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transbulent-reach-${aspect.replace(':', 'x')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
