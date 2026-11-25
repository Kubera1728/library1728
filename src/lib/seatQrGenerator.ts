/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import QRCode from 'qrcode';

export interface SeatQrStyleOptions {
  size?: number;
  baseOrigin?: string;
  darkColor?: string;
  lightColor?: string;
  accentColor?: string;
}

/**
 * Normalizes seat labels so "1", "01", "Seat #1", "A1", "A-01", "A-1" resolve to "A-1"
 */
export function normalizeSeatLabel(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .toUpperCase()
    .replace(/^SEAT\s*#?/, '')
    .replace(/^#/, '')
    .trim();
  if (/^\d+$/.test(cleaned)) {
    return `A-${parseInt(cleaned, 10)}`;
  }
  const match = cleaned.match(/^([A-Z]+)[-\s]*0*(\d+)$/);
  if (match) {
    return `${match[1]}-${parseInt(match[2], 10)}`;
  }
  return cleaned;
}

/**
 * Formats the concise high-contrast Center Number Badge string for a seat:
 * - "A-1" -> "01"
 * - "A-11" -> "11"
 * - "A-50" -> "50"
 * - "A-105" -> "105"
 * - "VIP-2" -> "02"
 */
export function formatSeatBadgeNumber(seatLabel: string): string {
  const normalized = normalizeSeatLabel(seatLabel);
  const numMatch = normalized.match(/(\d+)$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 0) {
      return n < 10 ? `0${n}` : String(n);
    }
  }
  const fallback = normalized.replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return fallback || '01';
}

export function compareSeatCodesAsc(rawSeatA: string, rawSeatB: string): number {
  const parse = (raw: string) => {
    const clean = normalizeSeatLabel(raw);
    const match = clean.match(/^([A-Z]+)[-\s]*(\d+)$/);
    if (match) {
      return { prefix: match[1], num: parseInt(match[2], 10) };
    }
    const numOnly = clean.match(/^(\d+)$/);
    if (numOnly) {
      return { prefix: '', num: parseInt(numOnly[1], 10) };
    }
    return { prefix: clean, num: Number.MAX_SAFE_INTEGER };
  };

  const a = parse(rawSeatA);
  const b = parse(rawSeatB);
  if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
  if (a.num !== b.num) return a.num - b.num;
  return (rawSeatA || '').localeCompare(rawSeatB || '', undefined, { numeric: true });
}

export const PRODUCTION_APP_ORIGIN = 'https://library1728.vercel.app';

/**
 * Base origin for scannable public seat & owner QR URLs.
 * Always resolves to the live production Vercel deployment so printed QRs
 * never embed temporary AI Studio preview or localhost URLs.
 */
export function getQrScanBaseOrigin(): string {
  return PRODUCTION_APP_ORIGIN;
}

/**
 * Public web-scannable QR URL format for every study seat (e.g., https://library1728.vercel.app/scan?seat=A-4&lib=...)
 */
export function encodeSeatQrPayload(
  libraryId: string,
  seatLabel: string,
  baseOrigin?: string
): string {
  const cleanSeat = normalizeSeatLabel(seatLabel);
  const origin = (baseOrigin || getQrScanBaseOrigin()).replace(/\/+$/, '');
  const params = new URLSearchParams({
    seat: cleanSeat,
    lib: libraryId.trim(),
  });
  return `${origin}/scan?${params.toString()}`;
}

/**
 * Public web-scannable Owner Master QR URL format mapped to a specific library ID
 * (e.g., https://library1728.vercel.app/owner?lib=...)
 */
export function encodeOwnerMasterQrPayload(
  libraryId: string,
  baseOrigin?: string
): string {
  const origin = (baseOrigin || getQrScanBaseOrigin()).replace(/\/+$/, '');
  const params = new URLSearchParams({
    lib: libraryId.trim(),
  });
  return `${origin}/owner?${params.toString()}`;
}

export interface SeatQrMatrixInfo {
  payload: string;
  seatLabel: string;
  badgeText: string;
  moduleCount: number;
  quietZone: number;
  cutoutRadiusModules: number;
  isDark: (r: number, c: number) => boolean;
}

export function isFinderZone(r: number, c: number, n: number): boolean {
  const top = r < 7;
  const bottom = r >= n - 7;
  const left = c < 7;
  const right = c >= n - 7;
  return (top && left) || (top && right) || (bottom && left);
}

/**
 * Builds the QR matrix with Error Correction Level H (30%) and center badge clearance geometry.
 */
export function createSeatQrMatrix(
  libraryId: string,
  seatLabel: string,
  baseOrigin?: string
): SeatQrMatrixInfo {
  const cleanSeat = normalizeSeatLabel(seatLabel);
  const payload = encodeSeatQrPayload(libraryId, cleanSeat, baseOrigin);
  const badgeText = formatSeatBadgeNumber(cleanSeat);

  const qr = QRCode.create(payload, {
    errorCorrectionLevel: 'H',
  });

  const moduleCount = qr.modules.size;
  const quietZone = 2;

  // Center badge cutout scaled conservatively well inside Level H's 30% recovery limit (~6-8% area)
  const cutoutFraction = badgeText.length >= 3 ? 0.165 : 0.148;
  const cutoutRadiusModules = Math.max(3.6, moduleCount * cutoutFraction);

  return {
    payload,
    seatLabel: cleanSeat,
    badgeText,
    moduleCount,
    quietZone,
    cutoutRadiusModules,
    isDark: (r: number, c: number) => Boolean(qr.modules.get(r, c)),
  };
}

function isModuleInCenterCutout(
  r: number,
  c: number,
  moduleCount: number,
  cutoutRadiusModules: number
): boolean {
  if (isFinderZone(r, c, moduleCount)) return false;
  const center = moduleCount / 2;
  const mx = c + 0.5;
  const my = r + 0.5;
  const dist = Math.hypot(mx - center, my - center);
  return dist < cutoutRadiusModules + 0.35;
}

/**
 * Renders a crisp standalone SVG with Level-H Error Correction, wrapping dots, and Center Number Badge.
 */
export function generateSeatQrSvg(
  libraryId: string,
  seatLabel: string,
  options: SeatQrStyleOptions = {}
): string {
  const size = Math.max(120, Math.round(options.size || 320));
  const darkColor = options.darkColor || '#0f172a';
  const lightColor = options.lightColor || '#ffffff';
  const accentColor = options.accentColor || '#1cb0f6';

  const matrix = createSeatQrMatrix(libraryId, seatLabel, options.baseOrigin);
  const { moduleCount, quietZone, cutoutRadiusModules, badgeText } = matrix;
  const totalModules = moduleCount + quietZone * 2;
  const modSize = size / totalModules;

  const paths: string[] = [];

  // 1. Surrounding QR modules (skip finder zones + center cutout so dots wrap neatly)
  const dotSize = modSize * 0.9;
  const dotOffset = (modSize - dotSize) / 2;
  const dotRadius = dotSize * 0.28;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isFinderZone(r, c, moduleCount)) continue;
      if (isModuleInCenterCutout(r, c, moduleCount, cutoutRadiusModules)) continue;
      if (!matrix.isDark(r, c)) continue;

      const x = ((quietZone + c) * modSize + dotOffset).toFixed(2);
      const y = ((quietZone + r) * modSize + dotOffset).toFixed(2);
      const w = dotSize.toFixed(2);
      const rx = dotRadius.toFixed(2);
      paths.push(`<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${rx}" fill="${darkColor}"/>`);
    }
  }

  // 2. Three clean rounded finder eyes (preserving exact 7x7 / 5x5 / 3x3 QR timing proportions)
  const finderOrigins = [
    [0, 0],
    [0, moduleCount - 7],
    [moduleCount - 7, 0],
  ];
  const finderXml = finderOrigins
    .map(([fr, fc]) => {
      const fx = (quietZone + fc) * modSize;
      const fy = (quietZone + fr) * modSize;
      const outer = 7 * modSize;
      const mid = 5 * modSize;
      const inner = 3 * modSize;
      return [
        `<rect x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${outer.toFixed(2)}" height="${outer.toFixed(2)}" rx="${(modSize * 1.35).toFixed(2)}" fill="${darkColor}"/>`,
        `<rect x="${(fx + modSize).toFixed(2)}" y="${(fy + modSize).toFixed(2)}" width="${mid.toFixed(2)}" height="${mid.toFixed(2)}" rx="${(modSize * 0.9).toFixed(2)}" fill="${lightColor}"/>`,
        `<rect x="${(fx + 2 * modSize).toFixed(2)}" y="${(fy + 2 * modSize).toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${(modSize * 0.75).toFixed(2)}" fill="${darkColor}"/>`,
      ].join('');
    })
    .join('');

  // 3. Center Number Badge with high-contrast halo
  const centerPx = size / 2;
  const haloRadiusPx = cutoutRadiusModules * modSize;
  const badgeRadiusPx = haloRadiusPx * 0.85;
  const ringRadiusPx = badgeRadiusPx * 0.89;
  const fontSizePx =
    badgeText.length >= 3 ? badgeRadiusPx * 0.78 : badgeText.length === 2 ? badgeRadiusPx * 0.98 : badgeRadiusPx * 1.08;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="geometricPrecision">`,
    `<rect width="${size}" height="${size}" fill="${lightColor}"/>`,
    finderXml,
    paths.join(''),
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${haloRadiusPx.toFixed(2)}" fill="${lightColor}"/>`,
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${badgeRadiusPx.toFixed(2)}" fill="${darkColor}"/>`,
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${ringRadiusPx.toFixed(2)}" fill="none" stroke="${accentColor}" stroke-width="${Math.max(1.2, badgeRadiusPx * 0.08).toFixed(2)}"/>`,
    `<text x="${centerPx.toFixed(2)}" y="${(centerPx + fontSizePx * 0.35).toFixed(2)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="900" font-size="${fontSizePx.toFixed(2)}" letter-spacing="-0.03em" fill="${lightColor}">${badgeText}</text>`,
    `</svg>`,
  ].join('');
}

/**
 * Browser HTML5 Canvas renderer -> crisp anti-aliased PNG DataURL
 */
export async function generateSeatQrDataUrl(
  libraryId: string,
  seatLabel: string,
  width: number = 320,
  baseOrigin?: string
): Promise<string> {
  const size = Math.max(160, Math.round(width));
  if (typeof document === 'undefined') {
    const pngBytes = generateSeatQrPngBytes(libraryId, seatLabel, { size, baseOrigin });
    let bin = '';
    for (let i = 0; i < pngBytes.length; i++) {
      bin += String.fromCharCode(pngBytes[i]);
    }
    const base64 =
      typeof Buffer !== 'undefined' ? Buffer.from(pngBytes).toString('base64') : btoa(bin);
    return `data:image/png;base64,${base64}`;
  }

  const matrix = createSeatQrMatrix(libraryId, seatLabel, baseOrigin);
  const { moduleCount, quietZone, cutoutRadiusModules, badgeText } = matrix;
  const totalModules = moduleCount + quietZone * 2;
  const modSize = size / totalModules;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const svg = generateSeatQrSvg(libraryId, seatLabel, { size, baseOrigin });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const darkColor = '#0f172a';
  const lightColor = '#ffffff';
  const accentColor = '#1cb0f6';

  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // 1. Finder patterns (top-left, top-right, bottom-left)
  const finderOrigins = [
    [0, 0],
    [0, moduleCount - 7],
    [moduleCount - 7, 0],
  ];
  for (const [fr, fc] of finderOrigins) {
    const fx = (quietZone + fc) * modSize;
    const fy = (quietZone + fr) * modSize;
    drawRoundedRect(fx, fy, 7 * modSize, 7 * modSize, modSize * 1.35, darkColor);
    drawRoundedRect(fx + modSize, fy + modSize, 5 * modSize, 5 * modSize, modSize * 0.9, lightColor);
    drawRoundedRect(fx + 2 * modSize, fy + 2 * modSize, 3 * modSize, 3 * modSize, modSize * 0.75, darkColor);
  }

  // 2. Surrounding QR modules wrapping cleanly around the center cutout
  const dotSize = modSize * 0.9;
  const dotOffset = (modSize - dotSize) / 2;
  const dotRadius = dotSize * 0.28;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isFinderZone(r, c, moduleCount)) continue;
      if (isModuleInCenterCutout(r, c, moduleCount, cutoutRadiusModules)) continue;
      if (!matrix.isDark(r, c)) continue;

      const x = (quietZone + c) * modSize + dotOffset;
      const y = (quietZone + r) * modSize + dotOffset;
      drawRoundedRect(x, y, dotSize, dotSize, dotRadius, darkColor);
    }
  }

  // 3. Center Number Badge with crisp halo & accent ring
  const centerPx = size / 2;
  const haloRadiusPx = cutoutRadiusModules * modSize;
  const badgeRadiusPx = haloRadiusPx * 0.85;
  const ringRadiusPx = badgeRadiusPx * 0.89;

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, haloRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = lightColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, badgeRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = darkColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, ringRadiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(1.4, badgeRadiusPx * 0.08);
  ctx.stroke();

  const fontSizePx =
    badgeText.length >= 3
      ? badgeRadiusPx * 0.78
      : badgeText.length === 2
      ? badgeRadiusPx * 0.96
      : badgeRadiusPx * 1.08;
  ctx.fillStyle = lightColor;
  ctx.font = `900 ${fontSizePx.toFixed(1)}px "Inter", "Segoe UI", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, centerPx, centerPx + fontSizePx * 0.04);

  return canvas.toDataURL('image/png');
}

// =========================================================================
// Pure-JS Anti-Aliased PNG Rasterizer (Cloud Run / Node-Safe, Zero Native Deps)
// =========================================================================

type RGB = [number, number, number];

function hexToRgb(hex: string, fallback: RGB): RGB {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r, g, b];
    }
  }
  return fallback;
}

function blendPixel(buf: Uint8Array, size: number, px: number, py: number, rgb: RGB, alpha: number) {
  if (px < 0 || py < 0 || px >= size || py >= size || alpha <= 0) return;
  const a = alpha > 1 ? 1 : alpha;
  const idx = (py * size + px) * 4;
  const inv = 1 - a;
  buf[idx] = Math.round(buf[idx] * inv + rgb[0] * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * inv + rgb[1] * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * inv + rgb[2] * a);
  buf[idx + 3] = 255;
}

function sdfRoundedBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function fillRoundedRectAA(
  buf: Uint8Array,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  rgb: RGB
) {
  const radius = Math.min(r, w / 2, h / 2);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2;
  const hh = h / 2;
  const innerX0 = x + radius;
  const innerX1 = x + w - radius;
  const innerY0 = y + radius;
  const innerY1 = y + h - radius;
  const x0 = Math.max(0, Math.floor(x - 1));
  const y0 = Math.max(0, Math.floor(y - 1));
  const x1 = Math.min(size - 1, Math.ceil(x + w + 1));
  const y1 = Math.min(size - 1, Math.ceil(y + h + 1));
  for (let py = y0; py <= y1; py++) {
    const pyc = py + 0.5;
    const inInnerY = pyc >= innerY0 && pyc <= innerY1;
    for (let px = x0; px <= x1; px++) {
      const pxc = px + 0.5;
      if (inInnerY && pxc >= x + 0.75 && pxc <= x + w - 0.75) {
        const idx = (py * size + px) * 4;
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
        continue;
      }
      if (pxc >= innerX0 && pxc <= innerX1 && pyc >= y + 0.75 && pyc <= y + h - 0.75) {
        const idx = (py * size + px) * 4;
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
        continue;
      }
      const d = sdfRoundedBox(pxc, pyc, cx, cy, hw, hh, radius);
      if (d < 0.75) {
        const cov = Math.max(0, Math.min(1, 0.75 - d));
        blendPixel(buf, size, px, py, rgb, cov);
      }
    }
  }
}

function fillCircleAA(buf: Uint8Array, size: number, cx: number, cy: number, radius: number, rgb: RGB) {
  const x0 = Math.max(0, Math.floor(cx - radius - 2));
  const y0 = Math.max(0, Math.floor(cy - radius - 2));
  const x1 = Math.min(size - 1, Math.ceil(cx + radius + 2));
  const y1 = Math.min(size - 1, Math.ceil(cy + radius + 2));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - radius;
      if (d < 0.75) {
        const cov = Math.max(0, Math.min(1, 0.75 - d));
        blendPixel(buf, size, px, py, rgb, cov);
      }
    }
  }
}

function strokeCircleAA(
  buf: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  strokeWidth: number,
  rgb: RGB
) {
  const half = strokeWidth / 2;
  const x0 = Math.max(0, Math.floor(cx - radius - half - 2));
  const y0 = Math.max(0, Math.floor(cy - radius - half - 2));
  const x1 = Math.min(size - 1, Math.ceil(cx + radius + half + 2));
  const y1 = Math.min(size - 1, Math.ceil(cy + radius + half + 2));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = Math.abs(Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - radius) - half;
      if (d < 0.75) {
        const cov = Math.max(0, Math.min(1, 0.75 - d));
        blendPixel(buf, size, px, py, rgb, cov);
      }
    }
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq)) : 0;
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function drawCapsuleAA(
  buf: Uint8Array,
  size: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
  rgb: RGB
) {
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - radius - 2));
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - radius - 2));
  const x1b = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + radius + 2));
  const y1b = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + radius + 2));
  for (let py = y0; py <= y1b; py++) {
    for (let px = x0; px <= x1b; px++) {
      const d = distToSegment(px + 0.5, py + 0.5, x1, y1, x2, y2) - radius;
      if (d < 0.75) {
        const cov = Math.max(0, Math.min(1, 0.75 - d));
        blendPixel(buf, size, px, py, rgb, cov);
      }
    }
  }
}

// Smooth vector stroke definitions in normalized [0..1] x [0..1] box per character
type GlyphStroke = [number, number, number, number];
const VECTOR_GLYPHS: Record<string, GlyphStroke[]> = {
  '0': [
    [0.2, 0.12, 0.8, 0.12],
    [0.8, 0.12, 0.8, 0.88],
    [0.8, 0.88, 0.2, 0.88],
    [0.2, 0.88, 0.2, 0.12],
  ],
  '1': [
    [0.26, 0.24, 0.54, 0.1],
    [0.54, 0.1, 0.54, 0.9],
    [0.22, 0.9, 0.82, 0.9],
  ],
  '2': [
    [0.18, 0.24, 0.32, 0.1],
    [0.32, 0.1, 0.72, 0.1],
    [0.72, 0.1, 0.84, 0.28],
    [0.84, 0.28, 0.18, 0.9],
    [0.18, 0.9, 0.84, 0.9],
  ],
  '3': [
    [0.2, 0.12, 0.76, 0.12],
    [0.76, 0.12, 0.82, 0.3],
    [0.82, 0.3, 0.44, 0.48],
    [0.44, 0.48, 0.82, 0.66],
    [0.82, 0.66, 0.76, 0.88],
    [0.76, 0.88, 0.2, 0.88],
  ],
  '4': [
    [0.68, 0.1, 0.16, 0.62],
    [0.16, 0.62, 0.86, 0.62],
    [0.68, 0.1, 0.68, 0.9],
  ],
  '5': [
    [0.8, 0.12, 0.24, 0.12],
    [0.24, 0.12, 0.22, 0.46],
    [0.22, 0.46, 0.72, 0.46],
    [0.72, 0.46, 0.84, 0.68],
    [0.84, 0.68, 0.68, 0.88],
    [0.68, 0.88, 0.2, 0.88],
  ],
  '6': [
    [0.76, 0.12, 0.34, 0.12],
    [0.34, 0.12, 0.18, 0.44],
    [0.18, 0.44, 0.18, 0.82],
    [0.18, 0.82, 0.44, 0.9],
    [0.44, 0.9, 0.78, 0.82],
    [0.78, 0.82, 0.82, 0.56],
    [0.82, 0.56, 0.2, 0.52],
  ],
  '7': [
    [0.18, 0.12, 0.84, 0.12],
    [0.84, 0.12, 0.38, 0.9],
  ],
  '8': [
    [0.24, 0.12, 0.76, 0.12],
    [0.76, 0.12, 0.8, 0.38],
    [0.8, 0.38, 0.2, 0.52],
    [0.2, 0.52, 0.2, 0.86],
    [0.2, 0.86, 0.8, 0.86],
    [0.8, 0.86, 0.8, 0.52],
    [0.8, 0.52, 0.2, 0.38],
    [0.2, 0.38, 0.24, 0.12],
  ],
  '9': [
    [0.8, 0.48, 0.22, 0.48],
    [0.22, 0.48, 0.18, 0.22],
    [0.18, 0.22, 0.42, 0.12],
    [0.42, 0.12, 0.78, 0.18],
    [0.78, 0.18, 0.82, 0.62],
    [0.82, 0.62, 0.58, 0.88],
    [0.58, 0.88, 0.24, 0.88],
  ],
  A: [
    [0.16, 0.9, 0.5, 0.1],
    [0.5, 0.1, 0.84, 0.9],
    [0.28, 0.62, 0.72, 0.62],
  ],
  B: [
    [0.2, 0.12, 0.2, 0.88],
    [0.2, 0.12, 0.72, 0.12],
    [0.72, 0.12, 0.78, 0.34],
    [0.78, 0.34, 0.2, 0.48],
    [0.2, 0.48, 0.8, 0.62],
    [0.8, 0.62, 0.74, 0.88],
    [0.74, 0.88, 0.2, 0.88],
  ],
  C: [
    [0.82, 0.2, 0.4, 0.12],
    [0.4, 0.12, 0.18, 0.32],
    [0.18, 0.32, 0.18, 0.68],
    [0.18, 0.68, 0.4, 0.88],
    [0.4, 0.88, 0.82, 0.8],
  ],
  '-': [[0.2, 0.5, 0.8, 0.5]],
};

function drawBadgeTextVectorAA(
  buf: Uint8Array,
  size: number,
  text: string,
  centerX: number,
  centerY: number,
  fontHeight: number,
  rgb: RGB
) {
  const chars = text.toUpperCase().split('');
  if (chars.length === 0) return;

  const charW = fontHeight * 0.56;
  const gap = fontHeight * 0.14;
  const totalW = chars.length * charW + Math.max(0, chars.length - 1) * gap;
  const strokeRadius = Math.max(1.1, fontHeight * 0.115);

  let cursorX = centerX - totalW / 2;
  const topY = centerY - fontHeight / 2;

  for (const ch of chars) {
    const strokes = VECTOR_GLYPHS[ch] || VECTOR_GLYPHS['0'];
    for (const [nx1, ny1, nx2, ny2] of strokes) {
      drawCapsuleAA(
        buf,
        size,
        cursorX + nx1 * charW,
        topY + ny1 * fontHeight,
        cursorX + nx2 * charW,
        topY + ny2 * fontHeight,
        strokeRadius,
        rgb
      );
    }
    cursorX += charW + gap;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function makeUncompressedZlib(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + blockCount * 5 + raw.length + 4);
  let pos = 0;
  out[pos++] = 0x78;
  out[pos++] = 0x01;
  for (let offset = 0, b = 0; b < blockCount; b++) {
    const remaining = raw.length - offset;
    const len = Math.min(maxBlock, remaining);
    const isFinal = b === blockCount - 1 ? 1 : 0;
    out[pos++] = isFinal;
    out[pos++] = len & 0xff;
    out[pos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), pos);
    pos += len;
    offset += len;
  }
  const adler = adler32(raw);
  out[pos++] = (adler >>> 24) & 0xff;
  out[pos++] = (adler >>> 16) & 0xff;
  out[pos++] = (adler >>> 8) & 0xff;
  out[pos++] = adler & 0xff;
  return out;
}

function encodePngFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  deflateFn?: (data: Uint8Array) => Uint8Array
): Uint8Array {
  const stride = width * 4 + 1;
  const rawScanlines = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    rawScanlines[y * stride] = 0; // filter type 0
    rawScanlines.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  const compressed = deflateFn ? deflateFn(rawScanlines) : makeUncompressedZlib(rawScanlines);

  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const chunk = new Uint8Array(12 + data.length);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    const crc = crc32(chunk.subarray(4, 8 + data.length));
    dv.setUint32(8 + data.length, crc, false);
    return chunk;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let p = 0;
  png.set(signature, p);
  p += signature.length;
  png.set(ihdrChunk, p);
  p += ihdrChunk.length;
  png.set(idatChunk, p);
  p += idatChunk.length;
  png.set(iendChunk, p);
  return png;
}

/**
 * Pure-JS PNG generator (zero native canvas dependency; runs identically in Cloud Run Node & browsers)
 */
export function generateSeatQrPngBytes(
  libraryId: string,
  seatLabel: string,
  options: SeatQrStyleOptions = {},
  deflateFn?: (data: Uint8Array) => Uint8Array
): Uint8Array {
  const size = Math.max(160, Math.round(options.size || 280));
  const darkRgb = hexToRgb(options.darkColor || '#0f172a', [15, 23, 42]);
  const lightRgb = hexToRgb(options.lightColor || '#ffffff', [255, 255, 255]);
  const accentRgb = hexToRgb(options.accentColor || '#1cb0f6', [28, 176, 246]);

  const matrix = createSeatQrMatrix(libraryId, seatLabel, options.baseOrigin);
  const { moduleCount, quietZone, cutoutRadiusModules, badgeText } = matrix;
  const totalModules = moduleCount + quietZone * 2;
  const modSize = size / totalModules;

  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = lightRgb[0];
    buf[i + 1] = lightRgb[1];
    buf[i + 2] = lightRgb[2];
    buf[i + 3] = 255;
  }

  // 1. Finder patterns
  const finderOrigins = [
    [0, 0],
    [0, moduleCount - 7],
    [moduleCount - 7, 0],
  ];
  for (const [fr, fc] of finderOrigins) {
    const fx = (quietZone + fc) * modSize;
    const fy = (quietZone + fr) * modSize;
    fillRoundedRectAA(buf, size, fx, fy, 7 * modSize, 7 * modSize, modSize * 1.35, darkRgb);
    fillRoundedRectAA(
      buf,
      size,
      fx + modSize,
      fy + modSize,
      5 * modSize,
      5 * modSize,
      modSize * 0.9,
      lightRgb
    );
    fillRoundedRectAA(
      buf,
      size,
      fx + 2 * modSize,
      fy + 2 * modSize,
      3 * modSize,
      3 * modSize,
      modSize * 0.75,
      darkRgb
    );
  }

  // 2. Surrounding modules
  const dotSize = modSize * 0.9;
  const dotOffset = (modSize - dotSize) / 2;
  const dotRadius = dotSize * 0.28;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isFinderZone(r, c, moduleCount)) continue;
      if (isModuleInCenterCutout(r, c, moduleCount, cutoutRadiusModules)) continue;
      if (!matrix.isDark(r, c)) continue;

      const x = (quietZone + c) * modSize + dotOffset;
      const y = (quietZone + r) * modSize + dotOffset;
      fillRoundedRectAA(buf, size, x, y, dotSize, dotSize, dotRadius, darkRgb);
    }
  }

  // 3. Center Number Badge
  const centerPx = size / 2;
  const haloRadiusPx = cutoutRadiusModules * modSize;
  const badgeRadiusPx = haloRadiusPx * 0.85;
  const ringRadiusPx = badgeRadiusPx * 0.89;

  fillCircleAA(buf, size, centerPx, centerPx, haloRadiusPx, lightRgb);
  fillCircleAA(buf, size, centerPx, centerPx, badgeRadiusPx, darkRgb);
  strokeCircleAA(
    buf,
    size,
    centerPx,
    centerPx,
    ringRadiusPx,
    Math.max(1.4, badgeRadiusPx * 0.08),
    accentRgb
  );

  const fontHeight =
    badgeText.length >= 3
      ? badgeRadiusPx * 0.66
      : badgeText.length === 2
      ? badgeRadiusPx * 0.82
      : badgeRadiusPx * 0.92;
  drawBadgeTextVectorAA(buf, size, badgeText, centerPx, centerPx, fontHeight, lightRgb);

  return encodePngFromRgba(buf, size, size, deflateFn);
}

/**
 * Builds Level-H QR matrix for a Library Owner Master QR (mapped to libraryId).
 */
export function createOwnerMasterQrMatrix(
  libraryId: string,
  baseOrigin?: string
): SeatQrMatrixInfo {
  const payload = encodeOwnerMasterQrPayload(libraryId, baseOrigin);
  const badgeText = 'OWNER';

  const qr = QRCode.create(payload, {
    errorCorrectionLevel: 'H',
  });

  const moduleCount = qr.modules.size;
  const quietZone = 2;
  const cutoutFraction = 0.168;
  const cutoutRadiusModules = Math.max(4.0, moduleCount * cutoutFraction);

  return {
    payload,
    seatLabel: 'OWNER',
    badgeText,
    moduleCount,
    quietZone,
    cutoutRadiusModules,
    isDark: (r: number, c: number) => Boolean(qr.modules.get(r, c)),
  };
}

/**
 * Renders a crisp standalone SVG for the Library Owner Master QR with Level-H ECC & OWNER badge.
 */
export function generateOwnerMasterQrSvg(
  libraryId: string,
  options: SeatQrStyleOptions = {}
): string {
  const size = Math.max(160, Math.round(options.size || 360));
  const darkColor = options.darkColor || '#0f172a';
  const lightColor = options.lightColor || '#ffffff';
  const accentColor = options.accentColor || '#E53935';

  const matrix = createOwnerMasterQrMatrix(libraryId, options.baseOrigin);
  const { moduleCount, quietZone, cutoutRadiusModules, badgeText } = matrix;
  const totalModules = moduleCount + quietZone * 2;
  const modSize = size / totalModules;

  const paths: string[] = [];
  const dotSize = modSize * 0.9;
  const dotOffset = (modSize - dotSize) / 2;
  const dotRadius = dotSize * 0.28;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isFinderZone(r, c, moduleCount)) continue;
      if (isModuleInCenterCutout(r, c, moduleCount, cutoutRadiusModules)) continue;
      if (!matrix.isDark(r, c)) continue;

      const x = ((quietZone + c) * modSize + dotOffset).toFixed(2);
      const y = ((quietZone + r) * modSize + dotOffset).toFixed(2);
      const w = dotSize.toFixed(2);
      const rx = dotRadius.toFixed(2);
      paths.push(`<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${rx}" fill="${darkColor}"/>`);
    }
  }

  const finderOrigins = [
    [0, 0],
    [0, moduleCount - 7],
    [moduleCount - 7, 0],
  ];
  const finderXml = finderOrigins
    .map(([fr, fc]) => {
      const fx = (quietZone + fc) * modSize;
      const fy = (quietZone + fr) * modSize;
      const outer = 7 * modSize;
      const mid = 5 * modSize;
      const inner = 3 * modSize;
      return [
        `<rect x="${fx.toFixed(2)}" y="${fy.toFixed(2)}" width="${outer.toFixed(2)}" height="${outer.toFixed(2)}" rx="${(modSize * 1.35).toFixed(2)}" fill="${darkColor}"/>`,
        `<rect x="${(fx + modSize).toFixed(2)}" y="${(fy + modSize).toFixed(2)}" width="${mid.toFixed(2)}" height="${mid.toFixed(2)}" rx="${(modSize * 0.9).toFixed(2)}" fill="${lightColor}"/>`,
        `<rect x="${(fx + 2 * modSize).toFixed(2)}" y="${(fy + 2 * modSize).toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${(modSize * 0.75).toFixed(2)}" fill="${darkColor}"/>`,
      ].join('');
    })
    .join('');

  const centerPx = size / 2;
  const haloRadiusPx = cutoutRadiusModules * modSize;
  const badgeRadiusPx = haloRadiusPx * 0.86;
  const ringRadiusPx = badgeRadiusPx * 0.89;
  const fontSizePx = badgeRadiusPx * 0.52;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="geometricPrecision">`,
    `<rect width="${size}" height="${size}" fill="${lightColor}"/>`,
    finderXml,
    paths.join(''),
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${haloRadiusPx.toFixed(2)}" fill="${lightColor}"/>`,
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${badgeRadiusPx.toFixed(2)}" fill="${darkColor}"/>`,
    `<circle cx="${centerPx.toFixed(2)}" cy="${centerPx.toFixed(2)}" r="${ringRadiusPx.toFixed(2)}" fill="none" stroke="${accentColor}" stroke-width="${Math.max(1.5, badgeRadiusPx * 0.08).toFixed(2)}"/>`,
    `<text x="${centerPx.toFixed(2)}" y="${(centerPx + fontSizePx * 0.35).toFixed(2)}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="900" font-size="${fontSizePx.toFixed(2)}" letter-spacing="0.02em" fill="${lightColor}">${badgeText}</text>`,
    `</svg>`,
  ].join('');
}

/**
 * Browser HTML5 Canvas PNG DataURL renderer for the Library Owner Master QR
 */
export async function generateOwnerMasterQrDataUrl(
  libraryId: string,
  width: number = 360,
  baseOrigin?: string
): Promise<string> {
  const size = Math.max(180, Math.round(width));
  if (typeof document === 'undefined') {
    const svg = generateOwnerMasterQrSvg(libraryId, { size, baseOrigin });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const matrix = createOwnerMasterQrMatrix(libraryId, baseOrigin);
  const { moduleCount, quietZone, cutoutRadiusModules, badgeText } = matrix;
  const totalModules = moduleCount + quietZone * 2;
  const modSize = size / totalModules;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const svg = generateOwnerMasterQrSvg(libraryId, { size, baseOrigin });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  const darkColor = '#0f172a';
  const lightColor = '#ffffff';
  const accentColor = '#E53935';

  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const finderOrigins = [
    [0, 0],
    [0, moduleCount - 7],
    [moduleCount - 7, 0],
  ];
  for (const [fr, fc] of finderOrigins) {
    const fx = (quietZone + fc) * modSize;
    const fy = (quietZone + fr) * modSize;
    drawRoundedRect(fx, fy, 7 * modSize, 7 * modSize, modSize * 1.35, darkColor);
    drawRoundedRect(fx + modSize, fy + modSize, 5 * modSize, 5 * modSize, modSize * 0.9, lightColor);
    drawRoundedRect(fx + 2 * modSize, fy + 2 * modSize, 3 * modSize, 3 * modSize, modSize * 0.75, darkColor);
  }

  const dotSize = modSize * 0.9;
  const dotOffset = (modSize - dotSize) / 2;
  const dotRadius = dotSize * 0.28;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isFinderZone(r, c, moduleCount)) continue;
      if (isModuleInCenterCutout(r, c, moduleCount, cutoutRadiusModules)) continue;
      if (!matrix.isDark(r, c)) continue;

      const x = (quietZone + c) * modSize + dotOffset;
      const y = (quietZone + r) * modSize + dotOffset;
      drawRoundedRect(x, y, dotSize, dotSize, dotRadius, darkColor);
    }
  }

  const centerPx = size / 2;
  const haloRadiusPx = cutoutRadiusModules * modSize;
  const badgeRadiusPx = haloRadiusPx * 0.86;
  const ringRadiusPx = badgeRadiusPx * 0.89;

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, haloRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = lightColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, badgeRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = darkColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(centerPx, centerPx, ringRadiusPx, 0, Math.PI * 2);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(1.5, badgeRadiusPx * 0.08);
  ctx.stroke();

  const fontSizePx = badgeRadiusPx * 0.52;
  ctx.fillStyle = lightColor;
  ctx.font = `900 ${fontSizePx.toFixed(1)}px "Inter", "Segoe UI", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, centerPx, centerPx + fontSizePx * 0.04);

  return canvas.toDataURL('image/png');
}
