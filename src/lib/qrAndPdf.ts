/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AttendanceRecord, Library, Shift, Student } from '../types/database';
import { isStudentExited } from './utils';
import {
  PRODUCTION_APP_ORIGIN,
  compareSeatCodesAsc,
  encodeOwnerMasterQrPayload,
  encodeSeatQrPayload,
  formatSeatBadgeNumber,
  generateOwnerMasterQrDataUrl,
  generateOwnerMasterQrSvg,
  generateSeatQrDataUrl,
  generateSeatQrSvg,
  getQrScanBaseOrigin,
  normalizeSeatLabel,
} from './seatQrGenerator';
import { buildCanonicalSeatLabels, buildMasterQrPdfDocument } from './masterQrPdfBuilder';
import { dataService, getStoredSupabaseConfig } from './supabase';

export {
  PRODUCTION_APP_ORIGIN,
  compareSeatCodesAsc,
  encodeOwnerMasterQrPayload,
  encodeSeatQrPayload,
  formatSeatBadgeNumber,
  generateOwnerMasterQrDataUrl,
  generateOwnerMasterQrSvg,
  generateSeatQrDataUrl,
  generateSeatQrSvg,
  getQrScanBaseOrigin,
  normalizeSeatLabel,
};

export interface ParsedSeatQr {
  valid: boolean;
  libraryId?: string;
  seatLabel?: string;
  error?: string;
}

/**
 * Parses scanned QR strings (supports public /scan URL format, legacy canonical pipe format, and JSON format)
 */
export function parseSeatQrPayload(raw: string): ParsedSeatQr {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Empty QR code scanned.' };
  }

  // Public web URL format: https://domain/scan?seat=A-4&lib=lib_vidya (or relative /scan?...)
  if (trimmed.includes('seat=') && (trimmed.includes('lib=') || trimmed.includes('libraryId='))) {
    try {
      const normalizedUrl = trimmed.startsWith('/')
        ? `${PRODUCTION_APP_ORIGIN}${trimmed}`
        : /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      const url = new URL(normalizedUrl);
      const seatParam = url.searchParams.get('seat') || url.searchParams.get('s');
      const libParam = url.searchParams.get('lib') || url.searchParams.get('libraryId');
      if (libParam && seatParam) {
        return {
          valid: true,
          libraryId: libParam.trim(),
          seatLabel: normalizeSeatLabel(seatParam),
        };
      }
    } catch {
      // fall through
    }
  }

  // Legacy canonical format: STUDYLINGO|SEAT|<libraryId>|<seatLabel>
  if (trimmed.toUpperCase().startsWith('STUDYLINGO|SEAT|')) {
    const parts = trimmed.split('|');
    if (parts.length >= 4 && parts[2] && parts[3]) {
      return {
        valid: true,
        libraryId: parts[2].trim(),
        seatLabel: normalizeSeatLabel(parts[3]),
      };
    }
  }

  // Legacy JSON format fallback
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.libraryId && (parsed?.seat || parsed?.seatLabel)) {
        return {
          valid: true,
          libraryId: String(parsed.libraryId).trim(),
          seatLabel: normalizeSeatLabel(String(parsed.seat || parsed.seatLabel)),
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    valid: false,
    error: 'Unrecognized QR code. Please scan an official StudyLingo Desk QR sticker.',
  };
}

/**
 * Returns local calendar date as YYYY-MM-DD
 */
export function getLocalDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formats YYYY-MM-DD as DD/MM/YYYY (e.g., 15/11/2026)
 */
export function formatNumericDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }
  return dateStr;
}

/**
 * Extracts concise shift label (e.g., "Morning", "Evening", "Full Day")
 */
export function formatShiftShortName(shiftStr: string | null | undefined): string {
  const clean = (shiftStr || '').split('(')[0].replace(/\bshift\b/gi, '').trim();
  return clean || (shiftStr || 'Standard');
}

export function formatTimeDisplay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const mins = Math.max(0, Math.round(minutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatMinutesAsClock(totalMinutes: number): string {
  const norm = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export interface ShiftTimingValidation {
  valid: boolean;
  reason: string;
  shiftWindow: string;
}

export interface ParsedShiftWindow {
  startMin: number;
  endMin: number;
  is24Hour: boolean;
  isOvernight: boolean;
  displayWindow: string;
}

interface ExtractedTimeToken {
  hour: number;
  min: number;
  meridiem: string;
}

function extractShiftTimeTokens(str: string): ExtractedTimeToken[] {
  const regex = /(?:\b(\d{1,2})[:.](\d{2})\s*(AM|PM)?\b|\b(\d{1,2})\s*(AM|PM)\b)/gi;
  const tokens: ExtractedTimeToken[] = [];
  for (const m of (str || '').matchAll(regex)) {
    if (m[1] !== undefined) {
      tokens.push({
        hour: parseInt(m[1], 10),
        min: parseInt(m[2], 10),
        meridiem: (m[3] || '').toUpperCase(),
      });
    } else if (m[4] !== undefined) {
      tokens.push({
        hour: parseInt(m[4], 10),
        min: 0,
        meridiem: (m[5] || '').toUpperCase(),
      });
    }
  }
  return tokens;
}

function normalizeShiftCoreLabel(str: string): string {
  return (str || '')
    .split('(')[0]
    .toLowerCase()
    .replace(/\b(shift|batch|slot|hours|hour|access)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a student's stored shift string against the library's configured Shift schedules
 * (so shifts stored only by name like "Full Day" pick up custom timings like "07:00 AM - 07:00 PM").
 */
export function resolveEffectiveShiftString(shiftStr: string, shifts?: Shift[]): string {
  const cleanShift = (shiftStr || '').trim();
  const explicitTokens = extractShiftTimeTokens(cleanShift);
  if (explicitTokens.length >= 2 || !shifts || shifts.length === 0) {
    return cleanShift;
  }

  const lowerShift = cleanShift.toLowerCase();
  const coreShift = normalizeShiftCoreLabel(cleanShift);
  const candidates = [
    ...shifts.filter((s) => s.is_active !== false),
    ...shifts.filter((s) => s.is_active === false),
  ];

  const matched = candidates.find((sh) => {
    const shFull = `${sh.name} (${sh.timing})`.trim().toLowerCase();
    const shName = (sh.name || '').trim().toLowerCase();
    const shCore = normalizeShiftCoreLabel(sh.name);
    if (lowerShift === shFull || lowerShift === shName) return true;
    if (coreShift && shCore && (coreShift === shCore || coreShift.includes(shCore) || shCore.includes(coreShift))) {
      return true;
    }
    return false;
  });

  if (matched && matched.timing) {
    const timingTokens = extractShiftTimeTokens(matched.timing);
    if (timingTokens.length >= 2) {
      return `${matched.name} (${matched.timing})`;
    }
  }

  return cleanShift;
}

/**
 * Parses any shift string ("Full Day (07:00 AM - 07:00 PM)", "7 AM to 7 PM", "07:00 - 19:00",
 * "Full Day (24 Hours)", "Morning Shift", etc.) into a normalized start/end minute window.
 */
export function parseShiftTimeWindow(
  shiftStr: string,
  shifts?: Shift[]
): ParsedShiftWindow | null {
  const effectiveShift = resolveEffectiveShiftString(shiftStr, shifts);
  const lower = effectiveShift.toLowerCase();
  const tokens = extractShiftTimeTokens(effectiveShift);

  // 1. Prefer explicit start/end clock times whenever present (even on "Full Day" or "24" labels)
  if (tokens.length >= 2) {
    const toMinutes = (tok: ExtractedTimeToken, fallbackMeridiem?: string): number => {
      let hour = tok.hour;
      const min = Math.min(59, Math.max(0, tok.min));
      const meridiem = tok.meridiem || fallbackMeridiem || '';
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      return Math.max(0, Math.min(1440, hour * 60 + min));
    };

    const startTok = tokens[0];
    const endTok = tokens[1];
    const startMin = toMinutes(startTok);
    let endMin = toMinutes(endTok);

    // Handle "07:00 AM - 12:00 AM" (12:00 AM as midnight end-of-day cutoff)
    if (startMin > 0 && endMin === 0 && endTok.meridiem === 'AM') {
      endMin = 1440;
    }

    if (startMin === endMin) {
      return {
        startMin,
        endMin,
        is24Hour: true,
        isOvernight: false,
        displayWindow: `${formatMinutesAsClock(startMin)} - ${formatMinutesAsClock(endMin)}`,
      };
    }

    const endDisplay = endMin === 1440 ? '12:00 AM' : formatMinutesAsClock(endMin);
    return {
      startMin,
      endMin,
      is24Hour: false,
      isOvernight: endMin < startMin,
      displayWindow: `${formatMinutesAsClock(startMin)} - ${endDisplay}`,
    };
  }

  // 2. Explicit 24-hour / 24x7 open access shifts with no fixed cutoff time
  if (
    /\b24\s*(?:hr|hrs|hour|hours|\/\s*7|x\s*7)\b/i.test(effectiveShift) ||
    lower.includes('24-hour') ||
    lower.includes('24/7') ||
    lower.includes('24x7')
  ) {
    return {
      startMin: 0,
      endMin: 1440,
      is24Hour: true,
      isOvernight: false,
      displayWindow: '24 Hours Open Access',
    };
  }

  // 3. Named fallback schedules without explicit clock times
  if (lower.includes('full day') || lower.includes('all day')) {
    return {
      startMin: 7 * 60,
      endMin: 19 * 60,
      is24Hour: false,
      isOvernight: false,
      displayWindow: '07:00 AM - 07:00 PM',
    };
  }
  if (lower.includes('morning')) {
    return {
      startMin: 6 * 60,
      endMin: 14 * 60,
      is24Hour: false,
      isOvernight: false,
      displayWindow: '06:00 AM - 02:00 PM',
    };
  }
  if (lower.includes('afternoon')) {
    return {
      startMin: 12 * 60,
      endMin: 19 * 60,
      is24Hour: false,
      isOvernight: false,
      displayWindow: '12:00 PM - 07:00 PM',
    };
  }
  if (lower.includes('evening')) {
    return {
      startMin: 13 * 60,
      endMin: 22 * 60 + 30,
      is24Hour: false,
      isOvernight: false,
      displayWindow: '01:00 PM - 10:30 PM',
    };
  }
  if (lower.includes('night')) {
    return {
      startMin: 20 * 60,
      endMin: 7 * 60,
      is24Hour: false,
      isOvernight: true,
      displayWindow: '08:00 PM - 07:00 AM',
    };
  }

  return null;
}

/**
 * Validates whether current time falls inside the student's assigned shift (with a 15-min early grace window).
 * Check-out is always permitted if a student already has an active check-in session.
 */
export function validateStudentShiftTiming(
  shiftStr: string,
  now: Date = new Date(),
  isCheckOut: boolean = false,
  shifts?: Shift[]
): ShiftTimingValidation {
  const cleanShift = (shiftStr || '').trim();

  if (isCheckOut) {
    return {
      valid: true,
      reason: 'Check-out permitted for active session.',
      shiftWindow: cleanShift || 'Assigned Shift',
    };
  }

  const parsed = parseShiftTimeWindow(cleanShift, shifts);
  if (!parsed) {
    return {
      valid: true,
      reason: 'Shift schedule verified.',
      shiftWindow: cleanShift || 'Standard Shift',
    };
  }

  if (parsed.is24Hour) {
    return {
      valid: true,
      reason: '24-hour shift active.',
      shiftWindow: parsed.displayWindow,
    };
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const earlyGraceMins = 15;

  if (!parsed.isOvernight) {
    const allowedStart = Math.max(0, parsed.startMin - earlyGraceMins);
    const ok = nowMin >= allowedStart && nowMin <= parsed.endMin;
    return {
      valid: ok,
      reason: ok
        ? `Active shift (${parsed.displayWindow}) verified.`
        : `Check-in is only allowed during your shift (${parsed.displayWindow}, 15m early grace). Current time: ${formatMinutesAsClock(nowMin)}.`,
      shiftWindow: parsed.displayWindow,
    };
  }

  const allowedStart = (parsed.startMin - earlyGraceMins + 1440) % 1440;
  const ok = nowMin >= allowedStart || nowMin <= parsed.endMin;
  return {
    valid: ok,
    reason: ok
      ? `Active overnight shift (${parsed.displayWindow}) verified.`
      : `Check-in is only allowed during your shift (${parsed.displayWindow}). Current time: ${formatMinutesAsClock(nowMin)}.`,
    shiftWindow: parsed.displayWindow,
  };
}

function triggerPdfBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * Generates and downloads a printable A4 Master QR PDF featuring high-reliability
 * Level-H Center-Number-Badge QR stickers synced with Supabase & backend APIs.
 */
export async function downloadMasterQrPdf(
  library: Library,
  options?: { seatLabels?: string[]; baseOrigin?: string }
): Promise<void> {
  const origin = options?.baseOrigin || getQrScanBaseOrigin();
  const roster = await dataService.getLibrarySeatRoster(library.id, library, origin).catch(() => null);
  const activeLibrary = roster?.library || library;
  const seatLabels =
    options?.seatLabels && options.seatLabels.length > 0
      ? options.seatLabels
      : roster?.seatLabels || buildCanonicalSeatLabels(activeLibrary.total_seats || 50);

  const safeSlug =
    activeLibrary.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Library';
  const fallbackFilename = `${safeSlug}-Master-QR-Codes.pdf`;

  // Primary: request backend /api/qr/master-pdf (queries Supabase + renders Cloud-Run-safe PNG PDF)
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const sbConfig = getStoredSupabaseConfig();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sbConfig.url) headers['x-supabase-url'] = sbConfig.url;
      if (sbConfig.anonKey) headers['x-supabase-key'] = sbConfig.anonKey;

      const res = await fetch('/api/qr/master-pdf', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          libraryId: activeLibrary.id,
          library: activeLibrary,
          seatLabels,
          baseOrigin: origin,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/pdf')) {
        const blob = await res.blob();
        triggerPdfBlobDownload(blob, fallbackFilename);
        return;
      }
    } catch {
      // Fall back smoothly to local batched client PDF generation
    }
  }

  // Fallback: build identical Level-H Center Number Badge Master PDF cleanly in batched chunks
  const { doc, filename } = await buildMasterQrPdfDocument({
    library: activeLibrary,
    seatLabels,
    batchSize: 12,
    renderSeatPng: (seat) => generateSeatQrDataUrl(activeLibrary.id, seat, 280, origin),
  });
  doc.save(filename);
}

/**
 * Generates and downloads a dedicated printable A4 Desk Access Card PDF
 * containing the Library Owner Master QR mapped to the library's unique ID.
 */
export async function downloadOwnerMasterQrPdf(library: Library): Promise<void> {
  const origin = getQrScanBaseOrigin();
  const payloadUrl = encodeOwnerMasterQrPayload(library.id, origin);
  const qrDataUrl = await generateOwnerMasterQrDataUrl(library.id, 420, origin);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const libName = (library.name || 'Study Library').trim();
  const libLocation = (library.location || 'Library Desk').trim();

  // Top Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 34, 'F');
  doc.setFillColor(88, 204, 2);
  doc.rect(0, 34, pageWidth, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('OWNER MASTER QR · DESK ACCESS', pageWidth / 2, 16, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.text(`${libName} (${libLocation})`, pageWidth / 2, 25, { align: 'center' });

  // Main Card Frame
  const cardX = 28;
  const cardY = 52;
  const cardW = pageWidth - 56;
  const cardH = 195;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.7);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(cardX, cardY, cardW, cardH, 6, 6, 'FD');

  // Card Pill Header
  doc.setFillColor(240, 253, 244);
  doc.roundedRect(cardX + 14, cardY + 12, cardW - 28, 12, 3, 3, 'F');
  doc.setTextColor(22, 101, 52);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`LIBRARY ID: ${library.id}`, pageWidth / 2, cardY + 19.5, { align: 'center' });

  // QR Image Frame
  const qrSize = 96;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = cardY + 32;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.roundedRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 4, 4, 'D');
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, `owner_master_${library.id}`, 'FAST');

  // Library Title & Mapped URL
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(libName, pageWidth / 2, qrY + qrSize + 15, { align: 'center' });

  doc.setTextColor(24, 153, 214);
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.text(payloadUrl, pageWidth / 2, qrY + qrSize + 23, { align: 'center' });

  // Instructions Footer Inside Card
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(cardX + 12, cardY + cardH - 36, cardW - 24, 26, 3, 3, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('QUICK RECEPTION DESK ACCESS', pageWidth / 2, cardY + cardH - 27, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.text(
    'Scan this QR with your phone camera at the reception desk to open your',
    pageWidth / 2,
    cardY + cardH - 20.5,
    { align: 'center' }
  );
  doc.text(
    'Library Owner Portal directly mapped to this branch.',
    pageWidth / 2,
    cardY + cardH - 15.5,
    { align: 'center' }
  );

  // Page Footer
  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-IN')} · Level-H Error Correction · ${origin}`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );

  const safeSlug = libName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Library';
  doc.save(`${safeSlug}-Owner-Master-QR.pdf`);
}

/**
 * Determines whether a student's assigned shift (or calendar day) has already ended for a given YYYY-MM-DD date.
 */
export function hasShiftEndedForDate(
  shiftStr: string,
  dateStr: string,
  now: Date = new Date(),
  shifts?: Shift[]
): boolean {
  const todayStr = getLocalDateKey(now);
  if (dateStr < todayStr) return true;
  if (dateStr > todayStr) return false;

  const parsed = parseShiftTimeWindow(shiftStr, shifts);
  if (!parsed || parsed.is24Hour || parsed.isOvernight) {
    return false;
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= parsed.endMin;
}

export type AttendanceRowState = 'checked_in' | 'checked_out' | 'absent' | 'pending';

export interface AttendanceTableRow {
  id: string;
  date: string; // YYYY-MM-DD
  formattedDate: string; // DD/MM/YYYY
  studentId: string;
  studentName: string;
  seatCode: string; // e.g. Seat A-1
  rawSeat: string; // e.g. A-1
  shiftName: string; // e.g. Morning, Evening, Full Day
  fullShift: string;
  checkInDisplay: string; // e.g. 04:38 PM or —
  checkOutDisplay: string; // e.g. 04:39 PM or —
  checkInIso: string | null;
  state: AttendanceRowState;
  statusRemarks: string;
}

/**
 * Generates unified tabular rows for Daily, Monthly, or Custom Range views:
 * - Includes all recorded check-in/check-out logs
 * - Automatically generates 'Absent' rows for enrolled active students who did not check in by end of shift/day
 */
export function buildAttendanceTableRows({
  students,
  records,
  startDate,
  endDate,
  activationDate,
  now = new Date(),
  shifts,
}: {
  students: Student[];
  records: AttendanceRecord[];
  startDate: string;
  endDate: string;
  activationDate?: string;
  now?: Date;
  shifts?: Shift[];
}): AttendanceTableRow[] {
  const todayStr = getLocalDateKey(now);
  const clampedEnd = endDate > todayStr ? todayStr : endDate;
  const effectiveStart =
    activationDate && activationDate > startDate ? activationDate : startDate;

  const rows: AttendanceTableRow[] = [];
  const loggedStudentDateKeys = new Set<string>();

  // Deduplicate records per student+date, always preferring real check-in/check-out over absent
  const dedupedByStudentDate = new Map<string, AttendanceRecord>();
  for (const rec of records) {
    if (rec.date < effectiveStart || rec.date > endDate) continue;
    if (activationDate && rec.date < activationDate) continue;
    const key = `${rec.student_id}::${rec.date}`;
    const existing = dedupedByStudentDate.get(key);
    if (!existing || (existing.status === 'absent' && rec.status !== 'absent')) {
      dedupedByStudentDate.set(key, rec);
    }
  }

  // 1. Add all real attendance records (strictly on or after activationDate)
  for (const rec of dedupedByStudentDate.values()) {
    loggedStudentDateKeys.add(`${rec.student_id}::${rec.date}`);

    const normSeat = normalizeSeatLabel(rec.seat_number);
    let state: AttendanceRowState = 'checked_in';
    let statusRemarks = 'Checked In · Active';

    if (rec.status === 'absent') {
      state = 'absent';
      statusRemarks = 'Absent';
    } else if (rec.status === 'checked_out' || rec.check_out_time) {
      state = 'checked_out';
      statusRemarks = rec.duration_minutes
        ? `Checked Out (${formatDurationMinutes(rec.duration_minutes)})`
        : 'Checked Out';
    }

    rows.push({
      id: rec.id,
      date: rec.date,
      formattedDate: formatNumericDate(rec.date),
      studentId: rec.student_id,
      studentName: rec.student_name,
      seatCode: `Seat ${normSeat}`,
      rawSeat: normSeat,
      shiftName: formatShiftShortName(rec.shift),
      fullShift: rec.shift,
      checkInDisplay: rec.status === 'absent' ? '—' : formatTimeDisplay(rec.check_in_time),
      checkOutDisplay:
        rec.status === 'absent'
          ? '—'
          : rec.check_out_time
          ? formatTimeDisplay(rec.check_out_time)
          : '—',
      checkInIso: rec.check_in_time,
      state,
      statusRemarks,
    });
  }

  // 2. For dates from effectiveStart (>= activationDate) up to today, detect enrolled active students without a check-in log
  if (effectiveStart <= clampedEnd) {
    const dateList: string[] = [];
    const cursor = new Date(`${effectiveStart}T00:00:00`);
    const endDt = new Date(`${clampedEnd}T00:00:00`);
    let safety = 0;
    while (cursor <= endDt && safety < 95) {
      dateList.push(getLocalDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
      safety++;
    }

    const activeStudents = students.filter((s) => s.is_active !== false && !isStudentExited(s));

    for (const dateStr of dateList) {
      for (const stu of activeStudents) {
        const key = `${stu.id}::${dateStr}`;
        if (loggedStudentDateKeys.has(key)) continue;

        // Only evaluate dates within the student's active subscription window
        if (stu.subscription_start && dateStr < stu.subscription_start) continue;
        if (stu.subscription_end && dateStr > stu.subscription_end) continue;

        const shiftEnded = hasShiftEndedForDate(stu.shift, dateStr, now, shifts);
        const normSeat = normalizeSeatLabel(stu.seat_number);

        // On past days, always mark Absent; on today, mark Absent once shift ends, otherwise Pending
        const isAbsent = dateStr < todayStr || shiftEnded;
        rows.push({
          id: `auto-${stu.id}-${dateStr}`,
          date: dateStr,
          formattedDate: formatNumericDate(dateStr),
          studentId: stu.id,
          studentName: stu.name,
          seatCode: `Seat ${normSeat}`,
          rawSeat: normSeat,
          shiftName: formatShiftShortName(stu.shift),
          fullShift: stu.shift,
          checkInDisplay: '—',
          checkOutDisplay: '—',
          checkInIso: null,
          state: isAbsent ? 'absent' : 'pending',
          statusRemarks: isAbsent ? 'Absent' : 'Awaiting Check-In',
        });
      }
    }
  }

  // Sort: newest date first, then present/checked-in/out before absent, then seat number
  rows.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.checkInIso && b.checkInIso) {
      return new Date(b.checkInIso).getTime() - new Date(a.checkInIso).getTime();
    }
    if (a.checkInIso && !b.checkInIso) return -1;
    if (!a.checkInIso && b.checkInIso) return 1;
    return a.rawSeat.localeCompare(b.rawSeat, undefined, { numeric: true });
  });

  return rows;
}

export interface AttendancePdfPayload {
  library: Library;
  rows: AttendanceTableRow[];
  periodLabel: string;
  filterSummary: string;
}

/**
 * Generates and downloads a structured 7-column Attendance Report PDF:
 * - Sorted strictly by ascending Seat Number (Seat A-1, A-2, A-3...) per date
 * - Finalizes any unchecked-in student status clearly as 'Absent' (no temporary 'Awaiting Check-In' tags)
 */
export function downloadAttendanceReportPdf({
  library,
  rows,
  periodLabel,
  filterSummary,
}: AttendancePdfPayload): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;

  // Header Banner
  doc.setFillColor(88, 204, 2);
  doc.rect(0, 0, pageWidth, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`${library.name} — Attendance Report`, 14, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${library.location} | Period: ${periodLabel}`, 14, 16.5);
  doc.text(
    `Generated: ${new Date().toLocaleString('en-IN')} | ${filterSummary}`,
    14,
    21.5
  );

  // Sort strictly by ascending seat number (grouped by date descending when multi-day)
  const pdfRows = [...rows].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const seatCmp = compareSeatCodesAsc(a.rawSeat, b.rawSeat);
    if (seatCmp !== 0) return seatCmp;
    return a.studentName.localeCompare(b.studentName);
  });

  // Summary metrics bar
  const totalRows = pdfRows.length;
  const activeNow = pdfRows.filter((r) => r.state === 'checked_in').length;
  const completedCount = pdfRows.filter((r) => r.state === 'checked_out').length;
  const absentCount = pdfRows.filter(
    (r) => r.state === 'absent' || r.state === 'pending'
  ).length;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 28, pageWidth - 28, 14, 2, 2, 'FD');
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`Total Entries: ${totalRows}`, 20, 36.5);
  doc.text(`Present / Out: ${activeNow + completedCount}`, 66, 36.5);
  doc.text(`In Hall: ${activeNow}`, 118, 36.5);
  doc.text(`Absent: ${absentCount}`, 160, 36.5);

  const tableBody = pdfRows.map((row) => {
    const finalizedStatus =
      row.state === 'pending' || row.state === 'absent' ? 'Absent' : row.statusRemarks;
    return [
      row.formattedDate,
      row.studentName,
      row.seatCode,
      row.shiftName,
      row.checkInDisplay,
      row.checkOutDisplay,
      finalizedStatus,
    ];
  });

  autoTable(doc, {
    startY: 46,
    head: [['Date', 'Name', 'Seat', 'Shift', 'Check-In', 'Check-Out', 'Status / Remarks']],
    body:
      tableBody.length > 0
        ? tableBody
        : [['—', 'No attendance records found for selected period', '—', '—', '—', '—', '—']],
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [30, 41, 59],
    },
    headStyles: {
      fillColor: [28, 176, 246],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 21 },
      2: { cellWidth: 19 },
      3: { cellWidth: 23 },
      4: { cellWidth: 19 },
      5: { cellWidth: 19 },
    },
    didParseCell(hookData) {
      if (hookData.section === 'body' && hookData.column.index === 6) {
        const text = String(hookData.cell.raw || '');
        if (text === 'Absent') {
          hookData.cell.styles.textColor = [220, 38, 38];
          hookData.cell.styles.fontStyle = 'bold';
        } else if (text.startsWith('Checked In')) {
          hookData.cell.styles.textColor = [22, 163, 74];
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  const safeSlug = library.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Library';
  const safePeriod = periodLabel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Report';
  doc.save(`${safeSlug}-Attendance-${safePeriod}.pdf`);
}
