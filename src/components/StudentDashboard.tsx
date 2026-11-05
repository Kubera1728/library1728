/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Calendar,
  Clock,
  Sparkles,
  Flame,
  CheckCircle2,
  Building2,
  Phone,
  MessageCircle,
  AlertTriangle,
  Award,
  BookOpen,
} from 'lucide-react';
import { Library, Student } from '../types/database';
import {
  calculateDaysRemaining,
  formatFriendlyDate,
  playSound,
  fireDuolingoConfetti,
} from '../lib/utils';
import { MascotOwl } from './MascotOwl';

interface StudentDashboardProps {
  studentCode: string;
  student: Student;
  library?: Library | null;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  studentCode,
  student,
  library,
}) => {
  const [checkedInToday, setCheckedInToday] = useState(false);
  const [streakDays, setStreakDays] = useState(3);

  const daysRemaining = calculateDaysRemaining(student.subscription_end);
  const isExpired = daysRemaining < 0;
  const isExpiringSoon = daysRemaining >= 0 && daysRemaining <= 2;

  // Total duration of subscription for percentage calculation
  const startDate = new Date(student.subscription_start || Date.now());
  const endDate = new Date(student.subscription_end || Date.now());
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const elapsedDays = Math.max(0, totalDays - Math.max(0, daysRemaining));
  const progressPercent = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));

  const handleCheckIn = () => {
    if (!checkedInToday) {
      setCheckedInToday(true);
      setStreakDays((prev) => prev + 1);
      playSound('success');
      fireDuolingoConfetti();
    }
  };

  // WhatsApp renewal link to library owner
  const ownerPhone = library?.contact_phone || '919876543210';
  const cleanPhone = ownerPhone.replace(/[^0-9]/g, '');
  const renewalMessage = `Hi ${library?.owner_name || 'Library Desk'}! 👋\nI am ${student.name} from Seat #${student.seat_number}.\nI would like to renew my study subscription (Current end date: ${formatFriendlyDate(student.subscription_end)}).\nPlease let me know the renewal payment details. Thank you!`;
  const waRenewalUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(renewalMessage)}`;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      
      {/* Top Hero Banner */}
      <div className="bg-white p-6 sm:p-8 duo-card flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
        <div className="relative shrink-0">
          <MascotOwl mood="studying" size={110} />
          {checkedInToday && (
            <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-[#58cc02] border-2 border-white flex items-center justify-center text-white text-xs font-black shadow-xs">
              ✓
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h1 className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c]">
              Welcome back, {student.name}!
            </h1>
            <span className="text-xs font-black px-2.5 py-0.5 rounded-lg bg-[#58cc02]/15 text-[#46a302] border border-[#58cc02]/30">
              ACTIVE SCHOLAR
            </span>
          </div>

          <p className="text-xs sm:text-sm font-semibold text-slate-500">
            {library?.name || 'Study Library'} · {library?.location || 'Central Reading Hall'}
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-2 text-xs font-bold">
            <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-700 font-mono">
              Access Code: {studentCode}
            </span>
            {student.notes && (
              <span className="px-3 py-1 rounded-xl bg-purple-50 text-purple-700 border border-purple-200">
                Focus: {student.notes}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* CARD 1: Assigned Seat Number */}
        <div className="bg-white p-6 duo-card flex flex-col justify-between space-y-4">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              Assigned Study Space
            </span>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-16 h-16 rounded-2xl bg-[#1cb0f6] text-white flex flex-col items-center justify-center border-b-4 border-[#1899d6] shadow-sm">
                <span className="text-[10px] uppercase font-black tracking-wider opacity-80">SEAT</span>
                <span className="font-display text-2xl font-black leading-tight">{student.seat_number}</span>
              </div>
              <div>
                <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                  Desk #{student.seat_number}
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  Reserved exclusively for you
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 font-medium">
            💡 Keep your desk clean and maintain complete silence in the reading hall.
          </div>
        </div>

        {/* CARD 2: Shift Details */}
        <div className="bg-white p-6 duo-card flex flex-col justify-between space-y-4">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              Timing & Shift Schedule
            </span>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-16 h-16 rounded-2xl bg-[#ce82ff] text-white flex items-center justify-center border-b-4 border-[#a855f7] shadow-sm">
                <Clock className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                  {student.shift}
                </h3>
                <span className="text-xs font-bold text-[#a855f7] inline-block">
                  Dedicated Study Slot
                </span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-purple-50/60 border border-purple-200 text-xs text-purple-900 font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-purple-600 shrink-0" />
            <span>High-speed Wi-Fi, air conditioning, and power outlet enabled at your desk.</span>
          </div>
        </div>

      </div>

      {/* CARD 3: Subscription Status & Countdown */}
      <div className={`p-6 sm:p-8 duo-card ${
        isExpired
          ? 'bg-red-50/70 border-red-300'
          : isExpiringSoon
          ? 'bg-amber-50/70 border-amber-300'
          : 'bg-white'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Subscription Validity
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-display text-4xl sm:text-5xl font-black text-[#3c3c3c] tabular-nums">
                {isExpired ? '0' : daysRemaining}
              </span>
              <span className="font-display text-xl font-black text-slate-600">
                {isExpired ? 'Days (Expired)' : 'Days Remaining'}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-500 mt-1">
              Period: <strong className="text-slate-700">{formatFriendlyDate(student.subscription_start)}</strong> to{' '}
              <strong className="text-slate-700">{formatFriendlyDate(student.subscription_end)}</strong>
            </p>
          </div>

          {/* Renewal CTA if expiring soon */}
          <div className="shrink-0">
            <a
              href={waRenewalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 px-5 rounded-2xl text-xs font-black duo-btn-green flex items-center justify-center gap-2 cursor-pointer shadow-sm uppercase tracking-wider"
            >
              <MessageCircle className="w-4 h-4 fill-white" />
              <span>Renew on WhatsApp</span>
            </a>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-5 space-y-1.5">
          <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isExpired ? 'bg-red-500' : isExpiringSoon ? 'bg-[#ff9600]' : 'bg-[#58cc02]'
              }`}
              style={{ width: `${Math.min(100, Math.max(8, 100 - progressPercent))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-bold text-slate-400">
            <span>Started: {formatFriendlyDate(student.subscription_start)}</span>
            <span>Ends: {formatFriendlyDate(student.subscription_end)}</span>
          </div>
        </div>

        {/* Expiring notice */}
        {isExpiringSoon && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-100/80 border border-amber-300 text-xs font-bold text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Your subscription expires in {daysRemaining} day(s)! Please renew to avoid seat reallocation.
            </span>
          </div>
        )}
      </div>

      {/* CARD 4: Gamified Daily Study Streak */}
      <div className="bg-white p-6 sm:p-8 duo-card flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#ff9600] text-white flex items-center justify-center border-b-4 border-[#e08500] shadow-sm">
            <Flame className="w-9 h-9 fill-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-2xl font-black text-[#3c3c3c] tabular-nums">
                {streakDays} Day Streak!
              </span>
              <span className="text-xl">🔥</span>
            </div>
            <p className="text-xs font-semibold text-slate-500 mt-0.5">
              Consistent daily study is your superpower. Keep the momentum going!
            </p>
          </div>
        </div>

        <button
          onClick={handleCheckIn}
          disabled={checkedInToday}
          className={`py-3.5 px-6 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-all ${
            checkedInToday
              ? 'bg-emerald-100 text-emerald-800 border-2 border-emerald-300 cursor-default'
              : 'duo-btn-orange'
          }`}
        >
          {checkedInToday ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span>Checked In For Today!</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 stroke-[3]" />
              <span>Tap to Check In Today</span>
            </>
          )}
        </button>
      </div>

      {/* Library Information & Help Desk */}
      {library && (
        <div className="bg-white p-6 duo-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div>
            <h4 className="font-display font-black text-sm text-[#3c3c3c]">
              Need Help or Seat Extension?
            </h4>
            <p className="font-semibold text-slate-500 mt-0.5">
              Contact Library Desk ({library.owner_name}) · Phone: {library.contact_phone}
            </p>
          </div>

          <a
            href={waRenewalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl font-black duo-btn-white flex items-center justify-center gap-1.5 cursor-pointer text-[#3c3c3c]"
          >
            <MessageCircle className="w-3.5 h-3.5 text-[#58cc02]" />
            <span>Chat on WhatsApp</span>
          </a>
        </div>
      )}

    </div>
  );
};
