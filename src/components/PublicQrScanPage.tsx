/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  QrCode,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { AttendanceRecord, AuthSession, Library, Student } from '../types/database';
import { dataService, DUPLICATE_ATTENDANCE_MESSAGE, isValidStudentPin } from '../lib/supabase';
import {
  encodeSeatQrPayload,
  formatDurationMinutes,
  formatNumericDate,
  formatTimeDisplay,
  getLocalDateKey,
  normalizeSeatLabel,
  validateStudentShiftTiming,
} from '../lib/qrAndPdf';
import {
  calculateDaysRemaining,
  fireDuolingoConfetti,
  formatFriendlyDate,
  isStudentExited,
  playSound,
} from '../lib/utils';
import { MascotOwl } from './MascotOwl';

interface PublicQrScanPageProps {
  seatParam: string;
  libraryIdParam: string;
  onNavigateHome: () => void;
  onOpenStudentSession: (session: AuthSession) => void;
}

interface ScanResultSuccess {
  mode: 'check_in' | 'check_out';
  student: Student;
  library: Library;
  record: AttendanceRecord;
  shiftWindow: string;
  session: AuthSession;
}

export const PublicQrScanPage: React.FC<PublicQrScanPageProps> = ({
  seatParam,
  libraryIdParam,
  onNavigateHome,
  onOpenStudentSession,
}) => {
  const normalizedSeat = seatParam ? normalizeSeatLabel(seatParam) : '';
  const cleanLibId = (libraryIdParam || '').trim();

  const [library, setLibrary] = useState<Library | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(Boolean(cleanLibId));
  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [showPin, setShowPin] = useState(false);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [errorState, setErrorState] = useState<{ title: string; detail: string } | null>(null);
  const [successResult, setSuccessResult] = useState<ScanResultSuccess | null>(null);
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  const pinCode = pinDigits.join('');

  const handlePinDigitChange = (index: number, rawValue: string) => {
    const digitsOnly = rawValue.replace(/[^0-9]/g, '');
    setErrorState(null);

    if (!digitsOnly) {
      setPinDigits((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }

    // Handle multi-digit paste or mobile keyboard autofill across boxes
    if (digitsOnly.length > 1) {
      const incoming = digitsOnly.slice(0, 4).split('');
      setPinDigits((prev) => {
        const next = [...prev];
        if (incoming.length === 4 && index === 0) {
          return incoming;
        }
        for (let offset = 0; offset < incoming.length && index + offset < 4; offset++) {
          next[index + offset] = incoming[offset];
        }
        return next;
      });
      const focusIdx = Math.min(3, index + incoming.length - 1);
      pinInputRefs.current[focusIdx]?.focus();
      return;
    }

    const singleDigit = digitsOnly.slice(-1);
    setPinDigits((prev) => {
      const next = [...prev];
      next[index] = singleDigit;
      return next;
    });
    if (index < 3) {
      pinInputRefs.current[index + 1]?.focus();
    }
  };

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (pinDigits[index]) {
        e.preventDefault();
        setPinDigits((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        });
        setErrorState(null);
      } else if (index > 0) {
        e.preventDefault();
        setPinDigits((prev) => {
          const next = [...prev];
          next[index - 1] = '';
          return next;
        });
        pinInputRefs.current[index - 1]?.focus();
        setErrorState(null);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      pinInputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 3) {
      e.preventDefault();
      pinInputRefs.current[index + 1]?.focus();
    }
  };

  const handlePinPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 4);
    if (!pasted) return;
    e.preventDefault();
    const chars = pasted.split('');
    const next = ['', '', '', ''];
    for (let i = 0; i < chars.length; i++) {
      next[i] = chars[i];
    }
    setPinDigits(next);
    setErrorState(null);
    pinInputRefs.current[Math.min(3, chars.length - 1)]?.focus();
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowClock(new Date());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!cleanLibId) {
      setLoadingLibrary(false);
      setLibrary(null);
      return;
    }

    setLoadingLibrary(true);
    void dataService
      .getLibraryById(cleanLibId)
      .then((lib) => {
        if (!cancelled) {
          setLibrary(lib);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLibrary(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingLibrary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cleanLibId]);

  const handleVerifyAndMarkAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying) return;

    const cleanCode = pinDigits.join('').trim();
    if (!isValidStudentPin(cleanCode)) {
      playSound('pop');
      setErrorState({
        title: '4-Digit Student Pin Required',
        detail: 'Please enter a valid 4-digit numeric Student Pin (1000–9999) to verify attendance.',
      });
      return;
    }

    if (!normalizedSeat || !cleanLibId) {
      setErrorState({
        title: 'Invalid Seat QR Link',
        detail: 'This QR link is missing seat or library details. Please scan the desk QR sticker again.',
      });
      return;
    }

    setVerifying(true);
    setErrorState(null);

    try {
      // 1. Strictly validate 4-digit numeric Student PIN (1000-9999 only)
      const loginRecord = await dataService.verifyStudentPin(cleanCode);
      if (!loginRecord || !loginRecord.reference_id) {
        playSound('pop');
        setErrorState({
          title: 'Invalid or Inactive Student Pin',
          detail: 'No active student account matched that 4-digit Student Pin. Double-check your PIN or ask the library desk.',
        });
        return;
      }

      // 2. Load Student & Parent Library
      const student = await dataService.getStudentById(loginRecord.reference_id);
      if (!student) {
        playSound('pop');
        setErrorState({
          title: 'Student Profile Not Found',
          detail: 'Your student profile could not be found. Please contact your library owner.',
        });
        return;
      }

      const parentLibrary =
        library && library.id === student.library_id
          ? library
          : await dataService.getLibraryById(student.library_id);

      if (!parentLibrary) {
        playSound('pop');
        setErrorState({
          title: 'Library Not Found',
          detail: 'The library linked to this QR code could not be verified.',
        });
        return;
      }

      if ((parentLibrary.subscription_status || '').trim().toLowerCase() !== 'active') {
        playSound('pop');
        setErrorState({
          title: 'Library Subscription Paused',
          detail: `${parentLibrary.name} is currently paused. Please contact the library administrator.`,
        });
        return;
      }

      // 3. Verify Library Branch Match
      if (student.library_id !== cleanLibId) {
        playSound('pop');
        setErrorState({
          title: 'Wrong Library QR',
          detail: `Your pass is registered at ${parentLibrary.name}, not this library branch.`,
        });
        return;
      }

      // 4. Verify Assigned Seat Match
      const assignedSeat = normalizeSeatLabel(student.seat_number);
      if (assignedSeat !== normalizedSeat) {
        playSound('pop');
        setErrorState({
          title: `Seat Mismatch (Scanned ${normalizedSeat})`,
          detail: `Your Student PIN belongs to Seat #${assignedSeat}. Please scan the QR sticker on Seat #${assignedSeat}.`,
        });
        return;
      }

      // 5. Check Existing Active Session (supports Check-In on arrival & Check-Out on departure)
      const studentLogs = await dataService.getAttendanceByStudent(student.id);
      const activeSession = studentLogs.find((r) => r.status === 'checked_in') || null;
      const isCheckingOut = Boolean(activeSession);
      const now = new Date();
      const todayDateKey = getLocalDateKey(now);
      const normalizeShiftKey = (s: string) => s.trim().toLowerCase();

      if (!isCheckingOut) {
        const alreadyRecordedToday = studentLogs.some(
          (r) =>
            r.date === todayDateKey &&
            r.status !== 'absent' &&
            normalizeShiftKey(r.shift) === normalizeShiftKey(student.shift)
        );
        if (alreadyRecordedToday) {
          playSound('pop');
          setErrorState({
            title: 'Attendance Already Completed',
            detail: DUPLICATE_ATTENDANCE_MESSAGE,
          });
          return;
        }
      }

      // 6. Verify Active Student Membership & Subscription Expiry (required for Check-In)
      if (!isCheckingOut) {
        if (student.is_active === false || isStudentExited(student)) {
          playSound('pop');
          setErrorState({
            title: 'Membership Marked Exited',
            detail: 'Your seat pass has been marked exited. Contact the library owner to re-enroll.',
          });
          return;
        }

        const daysLeft = calculateDaysRemaining(student.subscription_end);
        if (daysLeft < 0) {
          playSound('pop');
          setErrorState({
            title: 'Subscription Expired',
            detail: `Your seat validity ended on ${formatFriendlyDate(student.subscription_end)}. Please renew at the library desk before checking in.`,
          });
          return;
        }
      }

      // 7. Verify Active Shift Timing
      const timingResult = validateStudentShiftTiming(student.shift, now, isCheckingOut);
      if (!timingResult.valid) {
        playSound('pop');
        setErrorState({
          title: 'Outside Assigned Shift Timing',
          detail: timingResult.reason,
        });
        return;
      }

      const qrPayload = encodeSeatQrPayload(student.library_id, assignedSeat);

      const verifiedSession: AuthSession = {
        code: loginRecord.code,
        role: 'student',
        reference_id: loginRecord.reference_id,
        library: parentLibrary,
        student,
      };

      if (isCheckingOut && activeSession) {
        const checkInMs = new Date(activeSession.check_in_time || now.toISOString()).getTime();
        const durationMinutes = Math.max(1, Math.round((now.getTime() - checkInMs) / 60000));
        const updatedRecord: AttendanceRecord = {
          ...activeSession,
          check_out_time: now.toISOString(),
          duration_minutes: durationMinutes,
          status: 'checked_out',
        };
        await dataService.saveAttendanceRecord(updatedRecord);
        playSound('success');
        fireDuolingoConfetti();
        setSuccessResult({
          mode: 'check_out',
          student,
          library: parentLibrary,
          record: updatedRecord,
          shiftWindow: timingResult.shiftWindow,
          session: verifiedSession,
        });
      } else {
        const dateKey = getLocalDateKey(now);
        const newRecord: AttendanceRecord = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          library_id: student.library_id,
          student_id: student.id,
          student_name: student.name,
          seat_number: assignedSeat,
          shift: student.shift,
          date: dateKey,
          check_in_time: now.toISOString(),
          check_out_time: null,
          duration_minutes: null,
          status: 'checked_in',
          qr_payload: qrPayload,
          created_at: now.toISOString(),
        };
        dataService.ensureLibraryActivationDate(student.library_id, dateKey);
        await dataService.saveAttendanceRecord(newRecord);
        playSound('success');
        fireDuolingoConfetti();
        setSuccessResult({
          mode: 'check_in',
          student,
          library: parentLibrary,
          record: newRecord,
          shiftWindow: timingResult.shiftWindow,
          session: verifiedSession,
        });
      }
    } catch (err: any) {
      playSound('pop');
      const errMsg = err?.message || 'Unable to verify attendance right now. Please try again.';
      const isDuplicate =
        errMsg === DUPLICATE_ATTENDANCE_MESSAGE ||
        errMsg.toLowerCase().includes('already been recorded');
      setErrorState({
        title: isDuplicate ? 'Duplicate Scan Blocked' : 'Verification Failed',
        detail: errMsg,
      });
    } finally {
      setVerifying(false);
    }
  };

  const hasValidParams = Boolean(normalizedSeat && cleanLibId);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col items-center justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-md space-y-4">
        {/* Top Scanned Desk Context Card */}
        <div className="bg-white p-4 duo-card flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-[#1cb0f6] text-white flex flex-col items-center justify-center border-b-4 border-[#1899d6] shrink-0 shadow-xs">
              <span className="text-[9px] font-black uppercase tracking-wider opacity-90 leading-none">
                Seat
              </span>
              <span className="font-display text-base font-black leading-tight tabular-nums mt-0.5">
                {normalizedSeat || '—'}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#1899d6]">
                <QrCode className="w-3 h-3 shrink-0" />
                <span>QR Desk Attendance</span>
              </div>
              <h1 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate leading-tight mt-0.5">
                {loadingLibrary
                  ? 'Verifying Library...'
                  : library?.name || (cleanLibId ? 'Study Hall Desk' : 'Invalid QR Link')}
              </h1>
              {library?.location && (
                <p className="text-[11px] font-semibold text-slate-500 truncate flex items-center gap-1 mt-0.5">
                  <Building2 className="w-3 h-3 shrink-0 text-slate-400" />
                  <span className="truncate">{library.location}</span>
                </p>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span className="text-[10px] font-black uppercase text-slate-400 block">Time</span>
            <span className="font-mono text-xs font-black text-[#3c3c3c] tabular-nums">
              {formatTimeDisplay(nowClock.toISOString())}
            </span>
          </div>
        </div>

        {/* Missing / Malformed Query Params State */}
        {!hasValidParams ? (
          <div className="bg-white p-6 duo-card text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 text-red-500 border-2 border-red-200 flex items-center justify-center">
              <XCircle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-lg font-black text-[#3c3c3c]">
                Incomplete Desk QR Link
              </h2>
              <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                This URL does not contain a valid seat number and library ID. Please scan an official StudyLingo QR sticker on your study desk.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateHome}
              className="w-full py-3 px-5 rounded-2xl text-xs font-black duo-btn-blue uppercase tracking-wide cursor-pointer"
            >
              Go to StudyLingo Login
            </button>
          </div>
        ) : !loadingLibrary && !library ? (
          <div className="bg-white p-6 duo-card text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 border-2 border-amber-200 flex items-center justify-center">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-lg font-black text-[#3c3c3c]">
                Library Branch Not Found
              </h2>
              <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                We couldn&apos;t locate the library associated with this QR sticker. Ask your library owner for an updated QR code or log in to your pass.
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateHome}
              className="w-full py-3 px-5 rounded-2xl text-xs font-black duo-btn-blue uppercase tracking-wide cursor-pointer"
            >
              Go to StudyLingo Login
            </button>
          </div>
        ) : successResult ? (
          /* SUCCESS CONFIRMATION SCREEN */
          <div className="bg-white p-6 duo-card space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="text-center space-y-2">
              <div className="inline-block">
                <MascotOwl mood="celebrating" size={88} />
              </div>
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                  successResult.mode === 'check_in'
                    ? 'bg-emerald-100 text-[#46a302] border border-emerald-200'
                    : 'bg-sky-100 text-[#1899d6] border border-sky-200'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {successResult.mode === 'check_in'
                    ? 'Check-In Verified & Recorded'
                    : 'Check-Out Completed'}
                </span>
              </div>
              <h2 className="font-display text-2xl font-black text-[#3c3c3c]">
                {successResult.mode === 'check_in'
                  ? `Welcome, ${successResult.student.name.split(' ')[0]}!`
                  : `Great Session, ${successResult.student.name.split(' ')[0]}!`}
              </h2>
              <p className="text-xs font-semibold text-slate-500">
                {successResult.mode === 'check_in'
                  ? `Attendance marked for Seat #${normalizeSeatLabel(successResult.student.seat_number)}.`
                  : `Session closed for Seat #${normalizeSeatLabel(successResult.student.seat_number)}.`}
              </p>
            </div>

            {/* Verified Attendance Receipt */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200/80 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-500">Student</span>
                <span className="font-black text-[#3c3c3c] text-right truncate">
                  {successResult.student.name}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-500">Seat &amp; Library</span>
                <span className="font-black text-[#1899d6] text-right truncate">
                  Seat #{normalizeSeatLabel(successResult.student.seat_number)} · {successResult.library.name}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-500">Assigned Shift</span>
                <span className="font-bold text-[#a855f7] text-right truncate">
                  {successResult.student.shift}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 tabular-nums">
                <span className="font-bold text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Date</span>
                </span>
                <span className="font-black text-[#3c3c3c]">
                  {formatNumericDate(successResult.record.date)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 tabular-nums">
                <span className="font-bold text-slate-500 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-[#58cc02]" />
                  <span>Check-In Time</span>
                </span>
                <span className="font-black text-[#46a302]">
                  {formatTimeDisplay(successResult.record.check_in_time)}
                </span>
              </div>
              {successResult.mode === 'check_out' && successResult.record.check_out_time && (
                <>
                  <div className="flex items-center justify-between gap-2 tabular-nums">
                    <span className="font-bold text-slate-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-[#1899d6]" />
                      <span>Check-Out Time</span>
                    </span>
                    <span className="font-black text-[#1899d6]">
                      {formatTimeDisplay(successResult.record.check_out_time)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 tabular-nums">
                    <span className="font-bold text-slate-500 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-[#ff9600]" />
                      <span>Study Duration</span>
                    </span>
                    <span className="font-black text-[#e08500]">
                      {formatDurationMinutes(successResult.record.duration_minutes)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {successResult.mode === 'check_in' && (
              <p className="text-[11px] font-semibold text-center text-slate-500 leading-snug">
                Scan this desk QR sticker again when leaving to mark your Check-Out timestamp.
              </p>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => onOpenStudentSession(successResult.session)}
                className="w-full py-3.5 px-5 rounded-2xl text-sm font-black duo-btn-green flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wide"
              >
                <span>Open My Student Pass</span>
                <ArrowRight className="w-4 h-4 stroke-[3]" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuccessResult(null);
                  setPinDigits(['', '', '', '']);
                  setErrorState(null);
                  setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
                }}
                className="w-full py-2.5 px-4 rounded-2xl text-xs font-black duo-btn-white cursor-pointer"
              >
                Check In Another Student
              </button>
            </div>
          </div>
        ) : (
          /* UPI-STYLE 4-DIGIT STUDENT PIN VERIFICATION PORTAL */
          <div className="bg-white p-6 sm:p-7 duo-card space-y-5">
            <div className="text-center space-y-1.5">
              <div className="inline-block mb-1">
                <MascotOwl mood="studying" size={84} />
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-black text-[#3c3c3c]">
                Verify Seat #{normalizedSeat}
              </h2>
              <p className="text-xs font-semibold text-slate-500 max-w-xs mx-auto leading-relaxed">
                Enter your 4-digit Student PIN to verify this seat and record your Check-In or Check-Out.
              </p>
            </div>

            <form onSubmit={handleVerifyAndMarkAttendance} className="space-y-5">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <label
                    htmlFor="scanPinDigit0"
                    className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[#777777]"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#58cc02]" />
                    <span>Enter 4-Digit Student PIN</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPin((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-[11px] font-black text-[#1899d6] hover:underline cursor-pointer"
                  >
                    {showPin ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span>Show</span>
                      </>
                    )}
                  </button>
                </div>

                {/* UPI-Style 4-Box Numeric PIN Entry */}
                <div className="flex items-center justify-center gap-3 sm:gap-3.5">
                  {[0, 1, 2, 3].map((idx) => {
                    const hasVal = Boolean(pinDigits[idx]);
                    return (
                      <input
                        key={idx}
                        id={`scanPinDigit${idx}`}
                        ref={(el) => {
                          pinInputRefs.current[idx] = el;
                        }}
                        type={showPin ? 'text' : 'password'}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        autoComplete="one-time-code"
                        autoFocus={idx === 0}
                        aria-label={`Student PIN digit ${idx + 1}`}
                        value={pinDigits[idx]}
                        onChange={(e) => handlePinDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handlePinKeyDown(idx, e)}
                        onPaste={handlePinPaste}
                        onFocus={(e) => e.currentTarget.select()}
                        className={`w-14 h-16 sm:w-16 sm:h-[68px] rounded-2xl border-2 text-center font-display text-2xl sm:text-3xl font-black transition-all focus:outline-hidden ${
                          hasVal
                            ? 'border-[#58cc02] bg-emerald-50/40 text-[#3c3c3c] shadow-xs'
                            : 'border-[#e5e5e5] bg-slate-50/50 text-[#3c3c3c]'
                        } focus:border-[#1cb0f6] focus:bg-white focus:ring-4 focus:ring-[#1cb0f6]/15`}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mt-2.5 px-1">
                  <span className="text-[11px] font-semibold text-slate-400">
                    {pinCode.length}/4 digits entered
                  </span>
                  {pinCode.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setPinDigits(['', '', '', '']);
                        setErrorState(null);
                        pinInputRefs.current[0]?.focus();
                      }}
                      className="text-[11px] font-black text-slate-500 hover:text-slate-700 cursor-pointer"
                    >
                      Clear PIN
                    </button>
                  )}
                </div>
              </div>

              {errorState && (
                <div className="p-3.5 rounded-2xl bg-[#ff4b4b]/10 border-2 border-[#ff4b4b]/40 text-xs text-[#b91c1c] flex items-start gap-2.5">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#d33131]" />
                  <div className="min-w-0">
                    <div className="font-black text-[#b91c1c] leading-tight">
                      {errorState.title}
                    </div>
                    <p className="font-semibold text-[#991b1b] mt-0.5 leading-snug">
                      {errorState.detail}
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={verifying || pinCode.length !== 4 || loadingLibrary}
                className="w-full py-3.5 px-6 rounded-2xl text-sm sm:text-base font-black duo-btn-green flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Verifying PIN &amp; Seat...</span>
                  </>
                ) : (
                  <>
                    <span>Verify PIN &amp; Mark Attendance</span>
                    <ArrowRight className="w-5 h-5 stroke-[3]" />
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-[#58cc02]" />
                <span>Validates seat &amp; shift timing</span>
              </span>
              <button
                type="button"
                onClick={onNavigateHome}
                className="font-black text-[#1899d6] hover:underline cursor-pointer"
              >
                Portal Login
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
