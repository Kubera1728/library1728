/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import confetti from 'canvas-confetti';

/**
 * Fires celebratory Duolingo-style confetti
 */
export function fireDuolingoConfetti() {
  try {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#E53935', '#0f0f0f', '#1cb0f6', '#ff9600', '#ffc800'],
    });
  } catch (e) {
    // ignore
  }
}

/**
 * Plays a friendly synthesised audio chime using Web Audio API
 */
export function playSound(type: 'success' | 'click' | 'pop') {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === 'success') {
      // Duolingo style cheerful major triad
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;

        const startTime = ctx.currentTime + index * 0.08;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.28);
      });
    } else if (type === 'pop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch (e) {
    // audio context might be blocked by autoplay policies
  }
}

/**
 * Calculates remaining days from today until target date
 */
export function calculateDaysRemaining(endDateStr: string): number {
  if (!endDateStr) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(endDateStr);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

export function isExpiringIn2DaysOrToday(endDateStr: string): boolean {
  const days = calculateDaysRemaining(endDateStr);
  return days >= 0 && days <= 2;
}

export function isExpired(endDateStr: string): boolean {
  const days = calculateDaysRemaining(endDateStr);
  return days < 0;
}

export function formatFriendlyDate(dateStr: string): string {
  if (!dateStr) return 'N/A';
  try {
    const [year, month, day] = dateStr.split('-');
    if (year && month && day) {
      const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return dateStr;
  } catch (e) {
    return dateStr;
  }
}

export function generateWhatsAppToPhoneUrl(phone: string, message: string): string {
  let cleanPhone = (phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent((message || '').trim())}`;
}

export function buildStudentReminderMessage(
  studentName: string,
  libraryName: string,
  seatNumber: string,
  endDate: string,
  daysLeft: number,
  studentPin?: string
): string {
  let urgencyText = '';
  if (daysLeft === 0) {
    urgencyText = 'today';
  } else if (daysLeft === 1) {
    urgencyText = 'tomorrow';
  } else if (daysLeft === 2) {
    urgencyText = 'in 2 days';
  } else if (daysLeft < 0) {
    urgencyText = `expired ${Math.abs(daysLeft)} day(s) ago`;
  } else {
    urgencyText = `in ${daysLeft} days`;
  }

  const cleanPin = (studentPin || '').trim();
  const pinLine =
    cleanPin && cleanPin !== 'Not Issued'
      ? `\n• *Student PIN:* \`${cleanPin}\``
      : '';

  return `Hi ${studentName}! 📚\n\nGentle reminder from *${libraryName}* (Ekā):\nYour study seat subscription (*Seat #${seatNumber}*) is expiring *${urgencyText}* (${formatFriendlyDate(endDate)}).${pinLine}\n\nPlease renew your seat reservation to ensure your spot is kept reserved.\n\nKeep up your focused study sessions! 🚀`;
}

/**
 * Builds WhatsApp Click-to-Chat URL
 */
export function generateWhatsAppReminderUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  endDate: string,
  daysLeft: number,
  studentPin?: string
): string {
  return generateWhatsAppToPhoneUrl(
    phone,
    buildStudentReminderMessage(studentName, libraryName, seatNumber, endDate, daysLeft, studentPin)
  );
}

/**
 * Builds WhatsApp Welcome & Login Credentials URL for newly assigned / active students
 */
export function generateWhatsAppWelcomeUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  shift: string,
  accessCode: string,
  loginUrl: string
): string {
  const message = `Welcome to *${libraryName}* on *Ekā*, ${studentName}! 📚\n\nYour study desk is confirmed:\n• *Seat:* #${seatNumber}\n• *Shift:* ${shift}\n• *Student PIN:* \`${accessCode}\`\n• *Ekā Login Portal:* ${loginUrl}\n\n*Daily Check-In / Check-Out Instructions:*\n1. Open the portal link and sign in using your 4-digit Student PIN.\n2. When you arrive at your desk, scan the desk QR code and enter your 4-digit Student PIN to Check In.\n3. Scan your desk QR code again when leaving to mark Check-Out.\n\nWishing you productive study sessions! 🚀`;

  return generateWhatsAppToPhoneUrl(phone, message);
}

/**
 * Builds a clean WhatsApp Click-to-Chat URL (https://wa.me/...) with NO pre-filled text
 */
export function generateWhatsAppBlankChatUrl(phone: string): string {
  let cleanPhone = (phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  return `https://wa.me/${cleanPhone}`;
}

/**
 * Builds a direct phone call link (tel:...) for instant dialing
 */
export function generatePhoneCallUrl(phone: string): string {
  const trimmed = (phone || '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return 'tel:';
  if (digits.length === 10) {
    return `tel:+91${digits}`;
  }
  return `tel:+${digits}`;
}

export function buildStudentThankYouMessage(studentName: string, libraryName: string): string {
  return `Hello ${studentName}! 👋✨\n\nThank you so much for joining and studying with *${libraryName}* on *Ekā*! 📚\n\nWe truly appreciate you utilizing our library services and being part of our study community. Wishing you the very best in your upcoming exams and future goals! 🎯🚀\n\nYou are always welcome back whenever you need a focused study desk. Warm regards! 🙏`;
}

/**
 * Builds WhatsApp Thank-You / Appreciation URL for an exited student
 */
export function generateWhatsAppThankYouUrl(
  phone: string,
  studentName: string,
  libraryName: string
): string {
  return generateWhatsAppToPhoneUrl(phone, buildStudentThankYouMessage(studentName, libraryName));
}

export function buildStudentJoiningMessage(
  studentName: string,
  libraryName: string,
  seatNumber: string,
  shift: string,
  endDate: string,
  accessCode?: string
): string {
  const cleanPin = (accessCode || '').trim();
  const codeLine =
    cleanPin && cleanPin !== 'Not Issued'
      ? `\n• *Student PIN:* \`${cleanPin}\``
      : '';
  return `Welcome to *${libraryName}* on *Ekā*, ${studentName}! 🎉📚\n\nWe are excited to have you join our study community. Here are your seat details:\n• *Seat:* #${seatNumber}\n• *Shift:* ${shift}\n• *Valid Until:* ${formatFriendlyDate(endDate)}${codeLine}\n\nUse your 4-digit Student PIN to log into your Ekā student portal & check in/out at your desk. Wishing you super focused and productive study sessions ahead! 🚀`;
}

/**
 * Builds WhatsApp New Joining greeting URL from Master Admin for a newly joined student
 */
export function generateWhatsAppJoiningAlertUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  shift: string,
  endDate: string,
  accessCode?: string
): string {
  return generateWhatsAppToPhoneUrl(
    phone,
    buildStudentJoiningMessage(studentName, libraryName, seatNumber, shift, endDate, accessCode)
  );
}

export function buildStudentRenewalMessage(
  studentName: string,
  libraryName: string,
  seatNumber: string,
  endDate: string,
  shift?: string,
  studentPin?: string
): string {
  const shiftLine = shift ? `\n• *Shift:* ${shift}` : '';
  const cleanPin = (studentPin || '').trim();
  const pinLine =
    cleanPin && cleanPin !== 'Not Issued'
      ? `\n• *Student PIN:* \`${cleanPin}\``
      : '';
  return `Hello ${studentName}! ✅🎉\n\nYour study seat subscription at *${libraryName}* (*Seat #${seatNumber}*) has been *successfully renewed*!${shiftLine}\n• *New Validity Until:* ${formatFriendlyDate(endDate)}${pinLine}\n\nThank you for continuing your preparation with *${libraryName}* on *Ekā*. Keep up the great momentum! 🚀`;
}

/**
 * Builds WhatsApp Subscription Renewal confirmation URL for a student
 */
export function generateWhatsAppRenewalUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  endDate: string,
  shift?: string,
  studentPin?: string
): string {
  return generateWhatsAppToPhoneUrl(
    phone,
    buildStudentRenewalMessage(studentName, libraryName, seatNumber, endDate, shift, studentPin)
  );
}

/**
 * Builds WhatsApp Monthly Fee Reminder URL for a student
 */
export function generateWhatsAppFeeReminderUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  monthLabel: string,
  feeAmount: number,
  shift?: string
): string {
  const shiftLine = shift ? `\n• *Shift:* ${shift}` : '';
  const message = `Hello ${studentName}! 👋\n\nFriendly monthly fee reminder from *${libraryName}*:\n• *Month:* ${monthLabel}\n• *Seat:* #${seatNumber}${shiftLine}\n• *Pending Fee:* ₹${feeAmount}\n\nPlease complete your fee payment at the desk or share confirmation once paid. Thank you! 🙏`;
  return generateWhatsAppToPhoneUrl(phone, message);
}

/**
 * Builds WhatsApp License Expiry / Reminder URL for a Library Owner
 */
export function generateWhatsAppLibraryLicenseUrl(
  phone: string,
  ownerName: string,
  libraryName: string,
  expiryDate: string,
  daysLeft: number,
  isInactive: boolean
): string {
  let cleanPhone = (phone || '').replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  let message = '';
  if (isInactive) {
    message = `Hello ${ownerName}! 👋\n\nNotice regarding *${libraryName}*:\nYour *Ekā* library management license is currently *paused/inactive* (Expiry: *${formatFriendlyDate(expiryDate)}*).\n\nPlease reach out or complete your license renewal so your library dashboard and student access remain active seamlessly. 🙏`;
  } else if (daysLeft === 0) {
    message = `Hello ${ownerName}! ⚠️\n\n*Expiry Day Alert for ${libraryName}:*\nYour *Ekā* library subscription license expires *today (${formatFriendlyDate(expiryDate)})*.\n\nPlease renew your license today to avoid any interruption to your owner portal and student check-in services. Thank you! 🙏`;
  } else if (daysLeft === 2 || daysLeft === 1) {
    const timing = daysLeft === 1 ? 'tomorrow (1 day left)' : 'in 2 days';
    message = `Hello ${ownerName}! 🔔\n\nFriendly reminder for *${libraryName}*:\nYour *Ekā* library platform subscription is due to expire *${timing}* on *${formatFriendlyDate(expiryDate)}*.\n\nPlease renew ahead of schedule to ensure uninterrupted access for you and your students. 🚀`;
  } else if (daysLeft < 0) {
    message = `Hello ${ownerName}! ⚠️\n\nRenewal follow-up for *${libraryName}*:\nYour *Ekā* library subscription license expired ${Math.abs(daysLeft)} day(s) ago on *${formatFriendlyDate(expiryDate)}*.\n\nPlease complete your renewal at the earliest to keep your library account active. 🙏`;
  } else {
    message = `Hello ${ownerName}! 🔔\n\nUpcoming renewal reminder for *${libraryName}*:\nYour *Ekā* library subscription license expires in *${daysLeft} days* (*${formatFriendlyDate(expiryDate)}*).\n\nReach out anytime to extend your subscription! 🚀`;
  }

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Builds a pre-filled WhatsApp share/intent URL with no fixed recipient
 * so the Admin can select the library's WhatsApp broadcast list directly.
 */
export function generateWhatsAppBroadcastUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent((message || '').trim())}`;
}

export function isStudentExited(student: { is_active?: boolean; notes?: string }): boolean {
  if (student.is_active === false) return true;
  return /\[EXITED(?::[^\]]*)?\]/i.test(student.notes || '');
}

export function getStudentExitDate(student: { notes?: string }): string | null {
  const match = (student.notes || '').match(/\[EXITED:([^\]]+)\]/i);
  return match ? match[1] : null;
}

export function getStudentJoinedDate(student: { notes?: string }): string | null {
  const match = (student.notes || '').match(/\[JOINED:([^\]]+)\]/i);
  return match ? match[1] : null;
}

export function getStudentRenewedDate(student: { notes?: string }): string | null {
  const match = (student.notes || '').match(/\[RENEWED:([^\]]+)\]/i);
  return match ? match[1] : null;
}

export function isStudentThanked(student: { notes?: string }): boolean {
  return /\[THANKED\]/i.test(student.notes || '');
}

export function isExitAlertDismissed(student: { notes?: string }): boolean {
  return /\[EXIT_ACK\]/i.test(student.notes || '');
}

export function isExitAlertSent(student: { notes?: string }): boolean {
  return /\[(?:EXIT_SENT|THANKED)\]/i.test(student.notes || '');
}

export function isJoinAlertDismissed(student: { notes?: string }): boolean {
  return /\[JOIN_ACK\]/i.test(student.notes || '');
}

export function isJoinAlertSent(student: { notes?: string }): boolean {
  return /\[JOIN_SENT\]/i.test(student.notes || '');
}

export function isRenewAlertDismissed(student: { notes?: string }): boolean {
  return /\[RENEW_ACK\]/i.test(student.notes || '');
}

export function isRenewAlertSent(student: { notes?: string }): boolean {
  return /\[RENEW_SENT\]/i.test(student.notes || '');
}

export function isExpiringAlertDismissed(student: { notes?: string; subscription_end?: string }): boolean {
  const match = (student.notes || '').match(/\[EXPIRING_ACK:([^\]]+)\]/i);
  if (!match) return false;
  return match[1] === (student.subscription_end || '');
}

export function isExpiringAlertSent(student: { notes?: string; subscription_end?: string }): boolean {
  const match = (student.notes || '').match(/\[EXPIRING_SENT:([^\]]+)\]/i);
  if (!match) return false;
  return match[1] === (student.subscription_end || '');
}

export function stripSystemNoteTags(notes?: string): string {
  return (notes || '')
    .replace(/\s*\[EXITED(?::[^\]]*)?\]/gi, '')
    .replace(/\s*\[THANKED\]/gi, '')
    .replace(/\s*\[EXIT_ACK\]/gi, '')
    .replace(/\s*\[EXIT_SENT\]/gi, '')
    .replace(/\s*\[JOINED(?::[^\]]*)?\]/gi, '')
    .replace(/\s*\[JOIN_ACK\]/gi, '')
    .replace(/\s*\[JOIN_SENT\]/gi, '')
    .replace(/\s*\[RENEWED(?::[^\]]*)?\]/gi, '')
    .replace(/\s*\[RENEW_ACK\]/gi, '')
    .replace(/\s*\[RENEW_SENT\]/gi, '')
    .replace(/\s*\[EXPIRING_ACK(?::[^\]]*)?\]/gi, '')
    .replace(/\s*\[EXPIRING_SENT(?::[^\]]*)?\]/gi, '')
    .replace(/\s*\[FEE_PAID(?::[^\]]*)?\]/gi, '')
    .replace(/\s*·?\s*Fee:\s*₹\d+/gi, '')
    .trim();
}

