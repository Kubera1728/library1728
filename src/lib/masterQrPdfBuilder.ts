/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import type { Library } from '../types/database.ts';
import {
  compareSeatCodesAsc,
  formatSeatBadgeNumber,
  normalizeSeatLabel,
} from './seatQrGenerator.ts';

export interface BuildMasterQrPdfParams {
  library: Pick<Library, 'id' | 'name' | 'location' | 'total_seats'>;
  seatLabels?: string[];
  renderSeatPng: (seatLabel: string) => Promise<string | Uint8Array> | string | Uint8Array;
  batchSize?: number;
}

export function buildCanonicalSeatLabels(
  totalSeatsInput: number,
  extraSeatLabels: string[] = []
): string[] {
  const totalSeats = Math.max(1, Number(totalSeatsInput) || 1);
  const seatSet = new Set<string>();
  for (let i = 1; i <= totalSeats; i++) {
    seatSet.add(`A-${i}`);
  }
  for (const raw of extraSeatLabels) {
    const clean = normalizeSeatLabel(raw);
    if (clean) seatSet.add(clean);
  }
  return Array.from(seatSet).sort(compareSeatCodesAsc);
}

/**
 * Shared A4 Master QR PDF builder (runs identically in Browser and Node/Google Cloud Run).
 * Pre-renders Center Number Badge QR images in bounded batches to prevent memory/CPU spikes.
 */
export async function buildMasterQrPdfDocument({
  library,
  seatLabels: providedLabels,
  renderSeatPng,
  batchSize = 12,
}: BuildMasterQrPdfParams): Promise<{ doc: jsPDF; seatLabels: string[]; filename: string }> {
  const seatLabels =
    providedLabels && providedLabels.length > 0
      ? Array.from(new Set(providedLabels.map(normalizeSeatLabel).filter(Boolean))).sort(
          compareSeatCodesAsc
        )
      : buildCanonicalSeatLabels(library.total_seats);

  const totalCards = Math.max(1, seatLabels.length);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 6;
  const headerBandH = 11.5;
  const gridStartY = 13.5;
  const gridBottomY = 290.5;

  const cols = 3;
  const rows = 4;
  const perPage = cols * rows; // 12 QR cards per page (3x4)
  const gapX = 3;
  const gapY = 3;
  const cardW = (pageWidth - marginX * 2 - gapX * (cols - 1)) / cols; // 64mm
  const cardH = (gridBottomY - gridStartY - gapY * (rows - 1)) / rows; // 67mm
  const totalPages = Math.ceil(totalCards / perPage);

  // Batch-generate Level-H Center Number Badge QR PNGs to avoid unbounded concurrent spikes
  const qrImages: (string | Uint8Array)[] = new Array(totalCards);
  const safeBatch = Math.max(1, batchSize);
  for (let i = 0; i < totalCards; i += safeBatch) {
    const chunk = seatLabels.slice(i, i + safeBatch);
    const rendered = await Promise.all(chunk.map((seat) => Promise.resolve(renderSeatPng(seat))));
    for (let j = 0; j < rendered.length; j++) {
      qrImages[i + j] = rendered[j];
    }
    if (typeof setTimeout === 'function' && i + safeBatch < totalCards) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const firstSeat = seatLabels[0] || 'A-1';
  const lastSeat = seatLabels[seatLabels.length - 1] || `A-${totalCards}`;
  const libName = (library.name || 'Study Library').trim();
  const libLocation = (library.location || 'Study Hall').trim();

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    if (pageIdx > 0) doc.addPage();

    // Compact Branded A4 Header to maximize printable sticker area
    doc.setFillColor(28, 176, 246);
    doc.rect(0, 0, pageWidth, headerBandH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(`${libName} — Master Seat QR Sheet`, marginX, 5.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.text(
      `${libLocation} | Seats ${firstSeat}–${lastSeat} (${totalCards} Desks · Level-H) | ${new Date().toLocaleDateString('en-IN')}`,
      marginX,
      9.4
    );

    const startIdx = pageIdx * perPage;
    const endIdx = Math.min(totalCards, startIdx + perPage);

    for (let idx = startIdx; idx < endIdx; idx++) {
      const localIdx = idx - startIdx;
      const col = localIdx % cols;
      const row = Math.floor(localIdx / cols);
      const x = marginX + col * (cardW + gapX);
      const y = gridStartY + row * (cardH + gapY);

      const seatLabel = seatLabels[idx];
      const badgeNum = formatSeatBadgeNumber(seatLabel);
      const qrImage = qrImages[idx];

      // Clean light-grey card cut outline with safe margin around QR
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.35);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, cardW, cardH, 2.2, 2.2, 'FD');

      // Compact seat header ribbon with centered title & badge chip
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(x + 1.4, y + 1.4, cardW - 2.8, 7.0, 1.5, 1.5, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.2);
      doc.text(`SEAT ${seatLabel}`, x + cardW / 2 - 4.2, y + 6.1, { align: 'center' });

      // Dark #XX badge indicator on right of header ribbon
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(x + cardW - 12.2, y + 2.3, 9.4, 5.2, 1.2, 1.2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.text(`#${badgeNum}`, x + cardW - 7.5, y + 5.9, { align: 'center' });

      // Maximized Center-Number-Badge QR image (50mm x 50mm with >=7mm side cut clearance)
      const qrSize = 50;
      const qrX = x + (cardW - qrSize) / 2;
      const qrY = y + 9.0;
      doc.addImage(qrImage, 'PNG', qrX, qrY, qrSize, qrSize, `qr_${seatLabel}`, 'FAST');

      // Compact footer captions
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      const shortLib = libName.length > 30 ? `${libName.slice(0, 28)}..` : libName;
      doc.text(shortLib, x + cardW / 2, y + cardH - 4.8, { align: 'center' });

      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.text('Scan with Camera or App to Check-In / Out', x + cardW / 2, y + cardH - 2.0, {
        align: 'center',
      });
    }

    // Compact page footer
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(
      `Ekā QR Attendance System · Level-H Center Badge · Page ${pageIdx + 1} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 2.8,
      { align: 'center' }
    );
  }

  const safeSlug = libName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Library';
  return {
    doc,
    seatLabels,
    filename: `${safeSlug}-Master-QR-Codes.pdf`,
  };
}
