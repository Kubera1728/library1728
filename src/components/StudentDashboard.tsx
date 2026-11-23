/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Calendar,
  Clock,
  Flame,
  CheckCircle2,
  MessageCircle,
  AlertTriangle,
  BookOpen,
  Armchair,
  LogOut,
  Wifi,
  Zap,
  VolumeX,
  Droplets,
  QrCode,
  Camera,
  CameraOff,
  Upload,
  ShieldCheck,
  XCircle,
  ArrowRightLeft,
} from 'lucide-react';
import { AttendanceRecord, Library, Student } from '../types/database';
import { dataService, DUPLICATE_ATTENDANCE_MESSAGE } from '../lib/supabase';
import {
  formatDurationMinutes,
  formatTimeDisplay,
  getLocalDateKey,
  normalizeSeatLabel,
  parseSeatQrPayload,
  validateStudentShiftTiming,
} from '../lib/qrAndPdf';
import {
  calculateDaysRemaining,
  formatFriendlyDate,
  isStudentExited,
  playSound,
  fireDuolingoConfetti,
} from '../lib/utils';
import { MascotOwl } from './MascotOwl';

interface StudentDashboardProps {
  studentCode: string;
  student: Student;
  library?: Library | null;
  onLogout?: () => void;
}

export type StudentTab = 'pass' | 'scanner' | 'validity' | 'streak' | 'rules';

interface ScanFeedback {
  type: 'success' | 'error';
  title: string;
  detail: string;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  studentCode,
  student,
  library,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<StudentTab>('pass');
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(true);

  // QR Scanner State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualQrInput, setManualQrInput] = useState('');
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [processingScan, setProcessingScan] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ payload: string; at: number }>({ payload: '', at: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAttendance = async (silent = false) => {
    if (!silent) setLoadingAttendance(true);
    try {
      const logs = await dataService.getAttendanceByStudent(student.id);
      setAttendanceLogs(logs);
    } catch (e) {
      console.error('Failed to load attendance logs:', e);
    } finally {
      if (!silent) setLoadingAttendance(false);
    }
  };

  useEffect(() => {
    void loadAttendance(false);

    const triggerRefresh = () => {
      void loadAttendance(true);
    };

    const unsubscribeLive = dataService.subscribeToAttendanceUpdates({
      studentId: student.id,
      onUpdate: triggerRefresh,
    });

    const pollId = window.setInterval(triggerRefresh, 10000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerRefresh();
      }
    };

    window.addEventListener('focus', triggerRefresh);
    window.addEventListener('storage', triggerRefresh);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribeLive();
      window.clearInterval(pollId);
      window.removeEventListener('focus', triggerRefresh);
      window.removeEventListener('storage', triggerRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [student.id]);

  // Stop camera helper
  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (activeTab !== 'scanner') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeTab]);

  const daysRemaining = calculateDaysRemaining(student.subscription_end);
  const isExpired = daysRemaining < 0;
  const isExpiringSoon = daysRemaining >= 0 && daysRemaining <= 2;
  const isExited = isStudentExited(student);

  const startDate = new Date(student.subscription_start || Date.now());
  const endDate = new Date(student.subscription_end || Date.now());
  const totalDays = Math.max(
    1,
    Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const elapsedDays = Math.max(0, totalDays - Math.max(0, daysRemaining));
  const progressPercent = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));

  const todayKey = getLocalDateKey();

  const activeSession = useMemo(
    () => attendanceLogs.find((r) => r.status === 'checked_in') || null,
    [attendanceLogs]
  );

  const checkedInToday = useMemo(
    () => attendanceLogs.some((r) => r.date === todayKey),
    [attendanceLogs, todayKey]
  );

  const streakDays = useMemo(() => {
    const uniqueDates = Array.from(new Set(attendanceLogs.map((r) => r.date))).sort((a, b) =>
      b.localeCompare(a)
    );
    if (uniqueDates.length === 0) return 0;

    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    const latestKey = uniqueDates[0];
    const todayStr = getLocalDateKey(cursor);
    const yesterday = new Date(cursor);
    yesterday.setDate(cursor.getDate() - 1);
    const yesterdayStr = getLocalDateKey(yesterday);

    if (latestKey !== todayStr && latestKey !== yesterdayStr) {
      return 0;
    }

    const dateSet = new Set(uniqueDates);
    const checkDate = new Date(latestKey + 'T00:00:00');
    while (dateSet.has(getLocalDateKey(checkDate))) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
    return streak;
  }, [attendanceLogs]);

  const shiftCheck = useMemo(
    () => validateStudentShiftTiming(student.shift, new Date(), Boolean(activeSession)),
    [student.shift, activeSession, activeTab]
  );

  // Core QR validation + attendance logging
  const processScannedQr = async (rawPayload: string) => {
    if (processingScan) return;
    const trimmed = (rawPayload || '').trim();
    if (!trimmed) return;

    const nowTs = Date.now();
    if (
      lastScannedRef.current.payload === trimmed &&
      nowTs - lastScannedRef.current.at < 2500
    ) {
      return;
    }
    lastScannedRef.current = { payload: trimmed, at: nowTs };

    setProcessingScan(true);
    try {
      const parsed = parseSeatQrPayload(trimmed);
      if (!parsed.valid || !parsed.libraryId || !parsed.seatLabel) {
        playSound('pop');
        setScanFeedback({
          type: 'error',
          title: 'Invalid QR Code',
          detail: parsed.error || 'Scan a valid StudyLingo seat QR sticker.',
        });
        return;
      }

      if (parsed.libraryId !== student.library_id) {
        playSound('pop');
        setScanFeedback({
          type: 'error',
          title: 'Wrong Library QR',
          detail: `This QR belongs to a different branch. Please scan a seat QR inside ${library?.name || 'your library'}.`,
        });
        return;
      }

      const assignedSeat = normalizeSeatLabel(student.seat_number);
      const scannedSeat = normalizeSeatLabel(parsed.seatLabel);

      if (scannedSeat !== assignedSeat) {
        playSound('pop');
        setScanFeedback({
          type: 'error',
          title: `Seat Mismatch (${scannedSeat})`,
          detail: `Your assigned desk is Seat #${assignedSeat}. Please scan the QR code on Seat #${assignedSeat}.`,
        });
        return;
      }

      const latestLogs = await dataService.getAttendanceByStudent(student.id);
      const liveActiveSession = latestLogs.find((r) => r.status === 'checked_in') || null;
      const isCheckingOut = Boolean(liveActiveSession);
      const now = new Date();
      const todayDateKey = getLocalDateKey(now);
      const normalizeShiftKey = (s: string) => s.trim().toLowerCase();

      if (!isCheckingOut) {
        const alreadyRecordedToday = latestLogs.some(
          (r) =>
            r.date === todayDateKey &&
            r.status !== 'absent' &&
            normalizeShiftKey(r.shift) === normalizeShiftKey(student.shift)
        );
        if (alreadyRecordedToday) {
          setAttendanceLogs(latestLogs);
          stopCamera();
          playSound('pop');
          setScanFeedback({
            type: 'error',
            title: 'Attendance Already Completed',
            detail: DUPLICATE_ATTENDANCE_MESSAGE,
          });
          return;
        }
      }

      if (!isCheckingOut && (isExited || isExpired)) {
        playSound('pop');
        setScanFeedback({
          type: 'error',
          title: 'Subscription Inactive',
          detail: isExited
            ? 'Your seat membership has been marked exited. Contact the library desk to re-enroll.'
            : 'Your subscription has expired. Please renew your plan before checking in.',
        });
        return;
      }

      const timingResult = validateStudentShiftTiming(student.shift, now, isCheckingOut);
      if (!timingResult.valid) {
        playSound('pop');
        setScanFeedback({
          type: 'error',
          title: 'Outside Assigned Shift Timing',
          detail: timingResult.reason,
        });
        return;
      }

      if (isCheckingOut && liveActiveSession) {
        const checkInMs = new Date(liveActiveSession.check_in_time || now.toISOString()).getTime();
        const durationMinutes = Math.max(1, Math.round((now.getTime() - checkInMs) / 60000));
        const updatedRecord: AttendanceRecord = {
          ...liveActiveSession,
          check_out_time: now.toISOString(),
          duration_minutes: durationMinutes,
          status: 'checked_out',
        };
        await dataService.saveAttendanceRecord(updatedRecord);
        setAttendanceLogs((prev) =>
          prev.map((item) => (item.id === updatedRecord.id ? updatedRecord : item))
        );
        stopCamera();
        playSound('success');
        fireDuolingoConfetti();
        setScanFeedback({
          type: 'success',
          title: `Checked Out · Seat #${assignedSeat}`,
          detail: `Session ended at ${formatTimeDisplay(updatedRecord.check_out_time)} · Studied ${formatDurationMinutes(durationMinutes)}.`,
        });
      } else {
        const newRecord: AttendanceRecord = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          library_id: student.library_id,
          student_id: student.id,
          student_name: student.name,
          seat_number: assignedSeat,
          shift: student.shift,
          date: todayDateKey,
          check_in_time: now.toISOString(),
          check_out_time: null,
          duration_minutes: null,
          status: 'checked_in',
          qr_payload: trimmed,
          created_at: now.toISOString(),
        };
        dataService.ensureLibraryActivationDate(student.library_id, newRecord.date);
        await dataService.saveAttendanceRecord(newRecord);
        setAttendanceLogs((prev) => [newRecord, ...prev]);
        stopCamera();
        playSound('success');
        fireDuolingoConfetti();
        setScanFeedback({
          type: 'success',
          title: `Checked In · Seat #${assignedSeat}`,
          detail: `Verified at ${formatTimeDisplay(newRecord.check_in_time)} (${timingResult.shiftWindow}). Scan again when leaving to Check Out.`,
        });
      }
      setManualQrInput('');
    } catch (err: any) {
      playSound('pop');
      const errMsg = err?.message || 'Unable to record attendance right now. Please try again.';
      const isDuplicate =
        errMsg === DUPLICATE_ATTENDANCE_MESSAGE ||
        errMsg.toLowerCase().includes('already been recorded');
      setScanFeedback({
        type: 'error',
        title: isDuplicate ? 'Duplicate Scan Blocked' : 'Attendance Error',
        detail: errMsg,
      });
      await loadAttendance(true);
    } finally {
      setProcessingScan(false);
    }
  };

  const scanVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          void processScannedQr(code.data);
          return;
        }
      }
    }

    rafRef.current = requestAnimationFrame(scanVideoFrame);
  };

  const handleStartCamera = async () => {
    setCameraError(null);
    setScanFeedback(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera is not supported in this browser view. Use Upload QR Image or Enter QR Code below.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().then(() => {
            rafRef.current = requestAnimationFrame(scanVideoFrame);
          });
        }
      }, 60);
    } catch {
      setCameraError(
        'Camera permission denied or unavailable. You can upload a QR screenshot/photo or paste the seat QR code below.'
      );
      stopCamera();
    }
  };

  const handleUploadQrImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setCameraError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded && decoded.data) {
          void processScannedQr(decoded.data);
        } else {
          playSound('pop');
          setScanFeedback({
            type: 'error',
            title: 'No QR Found in Image',
            detail: 'Could not detect a clear QR code in that image. Try cropping closer to the QR square.',
          });
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleManualQrSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualQrInput.trim()) return;
    void processScannedQr(manualQrInput);
  };

  const handleSwitchTab = (tab: StudentTab) => {
    if (tab !== activeTab) {
      playSound('pop');
      setActiveTab(tab);
    }
  };

  const ownerPhone = library?.contact_phone || '919876543210';
  const cleanPhone = ownerPhone.replace(/[^0-9]/g, '');
  const renewalMessage = `Hi ${library?.owner_name || 'Library Desk'}! I am ${student.name} from Seat #${student.seat_number}. I would like to renew my study subscription (Current end date: ${formatFriendlyDate(student.subscription_end)}).`;
  const waRenewalUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(renewalMessage)}`;

  const navTabs: { id: StudentTab; label: string; icon: React.ComponentType<any>; alert?: boolean }[] = [
    { id: 'pass', label: 'Desk Pass', icon: Armchair },
    { id: 'scanner', label: 'QR Scan', icon: QrCode, alert: Boolean(activeSession) },
    { id: 'validity', label: 'Validity', icon: Calendar, alert: isExpired || isExpiringSoon },
    { id: 'streak', label: 'Streak', icon: Flame },
    { id: 'rules', label: 'Rules', icon: BookOpen },
  ];

  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const assignedSeatNorm = normalizeSeatLabel(student.seat_number);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* SINGLE-SCREEN CONTENT STAGE */}
      <div className="flex-1 min-h-0 overflow-hidden max-w-4xl w-full mx-auto px-3 sm:px-6 py-3 sm:py-5 flex flex-col justify-between">
        {/* TAB 1: DESK PASS */}
        {activeTab === 'pass' && (
          <div className="h-full flex flex-col justify-between gap-2.5 sm:gap-3.5 min-h-0">
            {/* Compact Scholar Header */}
            <div className="bg-white p-3.5 sm:p-4 duo-card flex items-center gap-3.5 shrink-0">
              <div className="shrink-0">
                <MascotOwl mood={activeSession ? 'celebrating' : 'studying'} size={60} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-[#46a302] truncate">
                  {activeSession ? 'Seated & Checked In' : 'Active Scholar'} · {library?.name || 'Study Library'}
                </p>
                <h1 className="font-display text-lg sm:text-2xl font-black text-[#3c3c3c] truncate">
                  {student.name}
                </h1>
                <p className="text-[11px] font-semibold text-slate-500 truncate mt-0.5">
                  PIN <span className="font-mono font-bold text-slate-700">{studentCode}</span>
                  {library?.location ? ` · ${library.location}` : ''}
                </p>
              </div>
            </div>

            {/* Hero Desk Pass Card */}
            <div className="flex-1 min-h-0 bg-white p-4 sm:p-5 duo-card flex flex-col justify-center gap-3 sm:gap-4">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                <span className="uppercase tracking-wider text-[11px] font-black">Reserved Study Desk</span>
                <span className={`font-black ${activeSession ? 'text-[#46a302]' : 'text-[#1899d6]'}`}>
                  {activeSession ? `In Hall since ${formatTimeDisplay(activeSession.check_in_time)}` : 'Verified Pass'}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-[#1cb0f6] text-white flex flex-col items-center justify-center border-b-4 border-[#1899d6] shadow-sm shrink-0">
                  <span className="text-[10px] uppercase font-black tracking-wider opacity-90">Desk</span>
                  <span className="font-display text-2xl sm:text-3xl font-black leading-tight tabular-nums">
                    {assignedSeatNorm}
                  </span>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <h2 className="font-display text-xl sm:text-2xl font-black text-[#3c3c3c] truncate">
                    Seat #{assignedSeatNorm}
                  </h2>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#a855f7] truncate">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{student.shift}</span>
                  </div>
                  {student.notes && (
                    <p className="text-[11px] font-semibold text-slate-500 truncate">
                      Goal: {student.notes}
                    </p>
                  )}
                </div>
              </div>

              {/* Prominent QR Attendance CTA */}
              <button
                type="button"
                onClick={() => handleSwitchTab('scanner')}
                className={`w-full py-3 px-4 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer min-h-[46px] ${
                  activeSession ? 'duo-btn-orange' : 'duo-btn-green'
                }`}
              >
                <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>
                  {activeSession
                    ? `Scan Desk QR to Check Out (${assignedSeatNorm})`
                    : `Scan Desk QR to Check In (${assignedSeatNorm})`}
                </span>
              </button>
            </div>

            {/* Quick Summary Strip */}
            <div className="grid grid-cols-2 gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => handleSwitchTab('validity')}
                className="bg-white p-3 duo-card text-left cursor-pointer hover:border-[#58cc02] transition-colors flex items-center justify-between min-h-[44px]"
              >
                <div className="min-w-0">
                  <span className="text-[10px] font-black uppercase text-slate-400 block">Validity</span>
                  <span
                    className={`font-display text-sm font-black tabular-nums ${
                      isExpired ? 'text-red-600' : isExpiringSoon ? 'text-[#e08500]' : 'text-[#46a302]'
                    }`}
                  >
                    {isExpired ? 'Expired' : `${daysRemaining} Days Left`}
                  </span>
                </div>
                <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => handleSwitchTab('streak')}
                className="bg-white p-3 duo-card text-left cursor-pointer hover:border-[#ff9600] transition-colors flex items-center justify-between min-h-[44px]"
              >
                <div className="min-w-0">
                  <span className="text-[10px] font-black uppercase text-slate-400 block">Focus Streak</span>
                  <span className="font-display text-sm font-black text-[#e08500] tabular-nums">
                    {streakDays} {streakDays === 1 ? 'Day' : 'Days'}
                  </span>
                </div>
                <Flame className="w-4 h-4 text-[#ff9600] shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: IN-APP QR SCANNER & REAL-TIME ATTENDANCE */}
        {activeTab === 'scanner' && (
          <div className="h-full flex flex-col gap-2.5 min-h-0 overflow-y-auto pr-0.5">
            {/* Live Session Status Header */}
            <div
              className={`p-3 duo-card flex items-center justify-between gap-2.5 shrink-0 ${
                activeSession
                  ? 'bg-emerald-50/90 border-emerald-300'
                  : 'bg-white'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${activeSession ? 'text-[#46a302]' : 'text-[#1899d6]'}`}
                  />
                  <span className="font-display text-sm font-black text-[#3c3c3c] truncate">
                    {activeSession ? 'Checked In · Active Session' : 'QR Desk Attendance Scanner'}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-500 truncate mt-0.5 tabular-nums">
                  Seat #{assignedSeatNorm} · {student.shift}
                </p>
              </div>
              <span
                className={`text-[10px] font-black uppercase shrink-0 px-2 py-1 rounded-lg ${
                  activeSession
                    ? 'bg-emerald-100 text-emerald-800'
                    : shiftCheck.valid
                    ? 'bg-sky-50 text-[#1899d6]'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {activeSession ? 'Scan to Out' : shiftCheck.valid ? 'Shift Active' : 'Off Shift'}
              </span>
            </div>

            {/* Validation / Success Feedback Banner */}
            {scanFeedback && (
              <div
                className={`p-3 rounded-2xl border-2 flex items-start gap-2.5 shrink-0 ${
                  scanFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-red-50 border-red-300 text-red-900'
                }`}
              >
                {scanFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-[#46a302] shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs sm:text-sm font-black leading-tight">
                    {scanFeedback.title}
                  </div>
                  <p className="text-[11px] font-semibold mt-0.5 leading-snug">
                    {scanFeedback.detail}
                  </p>
                </div>
              </div>
            )}

            {/* Camera & Upload Scanner Card */}
            <div className="bg-white p-3.5 duo-card flex flex-col gap-3 shrink-0">
              {cameraActive ? (
                <div className="relative w-full aspect-[4/3] max-h-[220px] rounded-2xl overflow-hidden bg-slate-900 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  {/* Target Reticle */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-40 h-40 border-3 border-dashed border-[#58cc02] rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                  </div>
                  <span className="absolute bottom-2 px-2.5 py-1 rounded-lg bg-slate-900/80 text-white text-[10px] font-bold">
                    Point camera at Seat #{assignedSeatNorm} QR sticker
                  </span>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center gap-1.5">
                  <div className="w-12 h-12 rounded-2xl bg-[#1cb0f6]/12 text-[#1899d6] flex items-center justify-center">
                    <QrCode className="w-6 h-6" />
                  </div>
                  <p className="font-display text-xs sm:text-sm font-black text-[#3c3c3c]">
                    {activeSession
                      ? `Ready to Check Out from Seat #${assignedSeatNorm}`
                      : `Scan Seat #${assignedSeatNorm} QR Code`}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500 max-w-xs">
                    Validates your library branch, assigned desk, active plan, and shift window in real time.
                  </p>
                </div>
              )}

              {cameraError && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
                  {cameraError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {cameraActive ? (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-red flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                  >
                    <CameraOff className="w-4 h-4" />
                    <span>Stop Camera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleStartCamera()}
                    className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Start Camera</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-blue flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload QR Image</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUploadQrImage}
                  className="hidden"
                />
              </div>

              {/* Manual QR Code Payload Fallback (accessible if camera blocked) */}
              <form onSubmit={handleManualQrSubmit} className="flex items-center gap-2 pt-1 border-t border-slate-100">
                <input
                  type="text"
                  value={manualQrInput}
                  onChange={(e) => setManualQrInput(e.target.value)}
                  placeholder="Or paste Desk QR link / payload..."
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden text-xs font-bold bg-white"
                />
                <button
                  type="submit"
                  disabled={!manualQrInput.trim() || processingScan}
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-white text-[#1899d6] cursor-pointer min-h-[38px] shrink-0 disabled:opacity-50"
                >
                  Verify
                </button>
              </form>
            </div>

            {/* Recent Check-In / Check-Out History */}
            <div className="bg-white p-3.5 duo-card flex flex-col gap-2 shrink-0">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-[#1cb0f6]" />
                  <span>Recent Attendance Logs</span>
                </span>
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                  {attendanceLogs.length} total
                </span>
              </div>

              {loadingAttendance ? (
                <p className="text-xs font-semibold text-slate-400 py-2">Loading logs...</p>
              ) : attendanceLogs.length === 0 ? (
                <p className="text-xs font-semibold text-slate-400 py-2">
                  No QR check-ins yet. Scan your desk sticker when you arrive!
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {attendanceLogs.slice(0, 5).map((log) => (
                    <div
                      key={log.id}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-[#3c3c3c] truncate tabular-nums">
                          {formatFriendlyDate(log.date)} · Seat #{log.seat_number}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
                          In {formatTimeDisplay(log.check_in_time)} ·{' '}
                          {log.check_out_time ? `Out ${formatTimeDisplay(log.check_out_time)}` : 'Active'}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-black shrink-0 tabular-nums ${
                          log.status === 'checked_in' ? 'text-[#46a302]' : 'text-[#1899d6]'
                        }`}
                      >
                        {log.status === 'checked_in'
                          ? 'In Hall'
                          : formatDurationMinutes(log.duration_minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SHIFT & SUBSCRIPTION VALIDITY */}
        {activeTab === 'validity' && (
          <div className="h-full flex flex-col justify-between gap-2.5 sm:gap-4 min-h-0">
            {/* Shift Banner */}
            <div className="bg-white p-3.5 sm:p-5 duo-card flex items-center gap-3.5 shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-[#ce82ff] text-white flex items-center justify-center border-b-3 border-[#a855f7] shrink-0">
                <Clock className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                  Assigned Study Shift
                </span>
                <h2 className="font-display text-base sm:text-xl font-black text-[#3c3c3c] truncate">
                  {student.shift}
                </h2>
                <p className="text-[11px] font-semibold text-slate-500 truncate">
                  Wi-Fi · AC Hall · Power Outlet Included
                </p>
              </div>
            </div>

            {/* Validity & Countdown Card */}
            <div
              className={`flex-1 min-h-0 p-4 sm:p-6 duo-card flex flex-col justify-between gap-3 ${
                isExpired
                  ? 'bg-red-50/90 border-red-300'
                  : isExpiringSoon
                  ? 'bg-amber-50/90 border-amber-300'
                  : 'bg-white'
              }`}
            >
              <div>
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Subscription Status
                </span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-display text-4xl sm:text-5xl font-black text-[#3c3c3c] tabular-nums">
                    {isExpired ? '0' : daysRemaining}
                  </span>
                  <span className="font-display text-base sm:text-xl font-black text-slate-600">
                    {isExpired ? 'Days (Expired)' : 'Days Remaining'}
                  </span>
                </div>
              </div>

              {/* Start / End Grid */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-400 block">Start Date</span>
                  <span className="font-bold text-slate-800 tabular-nums">
                    {formatFriendlyDate(student.subscription_start)}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-black uppercase text-slate-400 block">Valid Till</span>
                  <span className="font-bold text-slate-800 tabular-nums">
                    {formatFriendlyDate(student.subscription_end)}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isExpired ? 'bg-red-500' : isExpiringSoon ? 'bg-[#ff9600]' : 'bg-[#58cc02]'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(8, 100 - progressPercent))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-slate-400 tabular-nums">
                  <span>{elapsedDays}d used</span>
                  <span>{totalDays}d total cycle</span>
                </div>
              </div>

              {isExpiringSoon && (
                <div className="p-2.5 rounded-xl bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="truncate">
                    Expires in {daysRemaining} day(s). Renew early to hold your seat.
                  </span>
                </div>
              )}

              <a
                href={waRenewalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3 px-4 rounded-2xl text-xs font-black duo-btn-green flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider min-h-[44px]"
              >
                <MessageCircle className="w-4 h-4 fill-white" />
                <span>Renew on WhatsApp</span>
              </a>
            </div>
          </div>
        )}

        {/* TAB 4: DAILY CHECK-IN & STREAK */}
        {activeTab === 'streak' && (
          <div className="h-full flex flex-col justify-between gap-2.5 sm:gap-4 min-h-0">
            <div className="flex-1 min-h-0 bg-white p-5 sm:p-7 duo-card flex flex-col items-center justify-center text-center gap-4">
              <div className="relative">
                <MascotOwl mood={checkedInToday ? 'celebrating' : 'happy'} size={84} />
              </div>

              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#ff9600]/15 text-[#e08500] text-xs font-black mb-1">
                  <Flame className="w-4 h-4 fill-[#ff9600]" />
                  <span>QR Verified Study Streak</span>
                </div>
                <div className="font-display text-4xl sm:text-5xl font-black text-[#3c3c3c] tabular-nums">
                  {streakDays} {streakDays === 1 ? 'Day' : 'Days'}
                </div>
                <p className="text-xs font-semibold text-slate-500 mt-1 max-w-xs mx-auto">
                  Scan your Seat #{assignedSeatNorm} QR sticker on arrival and departure to log verified study hours.
                </p>
              </div>

              {/* 7-Day Visual Row */}
              <div className="flex items-center justify-center gap-2 pt-1">
                {weekDays.map((day, idx) => {
                  const completed = idx < Math.min(7, streakDays);
                  return (
                    <div key={idx} className="flex flex-col items-center gap-1">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all ${
                          completed
                            ? 'bg-[#ff9600] border-[#e08500] text-white'
                            : 'bg-slate-100 border-slate-200 text-slate-400'
                        }`}
                      >
                        {completed ? '✓' : day}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleSwitchTab('scanner')}
              className={`w-full py-3.5 px-6 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all min-h-[48px] shrink-0 ${
                activeSession ? 'duo-btn-orange' : 'duo-btn-green'
              }`}
            >
              <QrCode className="w-5 h-5" />
              <span>
                {activeSession
                  ? 'Scan Desk QR to Check Out'
                  : checkedInToday
                  ? 'Open QR Attendance Scanner'
                  : 'Scan Desk QR to Check In'}
              </span>
            </button>
          </div>
        )}

        {/* TAB 5: RULES & LIBRARY SUPPORT */}
        {activeTab === 'rules' && (
          <div className="h-full flex flex-col justify-between gap-2.5 sm:gap-4 min-h-0">
            <div className="flex-1 min-h-0 bg-white p-4 sm:p-6 duo-card flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-black text-base sm:text-lg text-[#3c3c3c]">
                  Hall Rules & Amenities
                </h2>
                <span className="text-[11px] font-bold text-slate-400">Seat #{assignedSeatNorm}</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 flex-1 min-h-0">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center gap-1">
                  <div className="flex items-center gap-1.5 font-black text-xs text-slate-800">
                    <VolumeX className="w-3.5 h-3.5 text-[#ff4b4b] shrink-0" />
                    <span>Silence Zone</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Keep phones silent and take all calls outside the hall.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center gap-1">
                  <div className="flex items-center gap-1.5 font-black text-xs text-slate-800">
                    <Wifi className="w-3.5 h-3.5 text-[#1cb0f6] shrink-0" />
                    <span>Fiber Wi-Fi</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    High-speed optical network included during your shift.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center gap-1">
                  <div className="flex items-center gap-1.5 font-black text-xs text-slate-800">
                    <Zap className="w-3.5 h-3.5 text-[#ff9600] shrink-0" />
                    <span>Power Socket</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Dedicated outlet at every desk for laptops & tablets.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center gap-1">
                  <div className="flex items-center gap-1.5 font-black text-xs text-slate-800">
                    <Droplets className="w-3.5 h-3.5 text-[#58cc02] shrink-0" />
                    <span>RO & Locker</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-tight">
                    Filtered drinking water and personal desk storage.
                  </p>
                </div>
              </div>
            </div>

            {/* Library Help Desk Card */}
            <div className="bg-emerald-50/90 border-2 border-emerald-200 rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <span className="font-display font-black text-xs sm:text-sm text-emerald-950 block truncate">
                  {library?.name || 'Study Library'} · {library?.owner_name || 'Help Desk'}
                </span>
                <span className="text-[11px] font-semibold text-emerald-800 block truncate">
                  {library?.contact_phone || 'Owner Support'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={waRenewalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1.5 cursor-pointer min-h-[40px]"
                >
                  <MessageCircle className="w-3.5 h-3.5 fill-white" />
                  <span>WhatsApp</span>
                </a>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="p-2 rounded-xl text-xs font-black duo-btn-white text-red-600 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                    title="Log Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FIXED BOTTOM NAVIGATION TAB BAR */}
      <nav
        aria-label="Student Dashboard Tabs"
        className="shrink-0 bg-white/95 backdrop-blur-md border-t-2 border-[#e5e5e5] px-1.5 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] z-30"
      >
        <div className="max-w-xl mx-auto grid grid-cols-5 gap-1">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSwitchTab(tab.id)}
                className={`relative min-h-[44px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#58cc02]/12 text-[#46a302]'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.6]' : 'stroke-[2]'}`} />
                <span className="text-[10px] font-black tracking-tight whitespace-nowrap">
                  {tab.label}
                </span>
                {tab.alert && !isActive && (
                  <span className="absolute top-1.5 right-1/4 w-2 h-2 rounded-full bg-amber-500" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
