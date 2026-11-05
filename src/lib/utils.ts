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
      colors: ['#58cc02', '#1cb0f6', '#ff9600', '#ffc800', '#ce82ff'],
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

/**
 * Builds WhatsApp Click-to-Chat URL
 */
export function generateWhatsAppReminderUrl(
  phone: string,
  studentName: string,
  libraryName: string,
  seatNumber: string,
  endDate: string,
  daysLeft: number
): string {
  // Sanitize phone number (strip spaces, dashes, parentheses, plus)
  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length === 10) {
    // Default country code if 10-digit, prefix with 91 for India or as needed
    cleanPhone = '91' + cleanPhone;
  }

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

  const message = `Hi ${studentName}! 📚\n\nGentle reminder from *${libraryName}*:\nYour study seat subscription (*Seat #${seatNumber}*) is expiring *${urgencyText}* (${formatFriendlyDate(endDate)}).\n\nPlease renew your seat reservation to ensure your spot is kept reserved.\n\nKeep up your focused study sessions! 🚀`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
