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
  X,
  ChevronRight,
  Timer,
  Play,
  Pause,
  RotateCcw,
  BellOff,
  Bell,
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
import { EkaSigmaIcon } from './EkaLogoMark';

interface StudentDashboardProps {
  studentCode: string;
  student: Student;
  library?: Library | null;
  onLogout?: () => void;
}

export type StudentModalSection = 'scanner' | 'validity' | 'streak' | 'rules' | 'focus';

type PomodoroPhase = 'focus' | 'break';

const DEFAULT_FOCUS_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;
const FOCUS_PRESETS_MIN = [15, 25, 45, 60];
const BREAK_PRESETS_MIN = [5, 10, 15];

function formatTimerClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

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
  const [activeModal, setActiveModal] = useState<StudentModalSection | null>(null);
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
    if (activeModal !== 'scanner') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeModal]);

  useEffect(() => {
    if (!activeModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal]);

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

  // Focus Mode / Pomodoro State
  const focusStorageKey = `eka_focus_sessions_${student.id}_${todayKey}`;
  const focusMinutesStorageKey = `eka_focus_minutes_${student.id}_${todayKey}`;
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>('focus');
  const [focusMinutes, setFocusMinutes] = useState<number>(DEFAULT_FOCUS_MINUTES);
  const [breakMinutes, setBreakMinutes] = useState<number>(DEFAULT_BREAK_MINUTES);
  const [customMinutesDraft, setCustomMinutesDraft] = useState<string>(String(DEFAULT_FOCUS_MINUTES));
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState<number>(DEFAULT_FOCUS_MINUTES * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState<boolean>(false);
  const [dndEnabled, setDndEnabled] = useState<boolean>(true);
  const [completedFocusSessions, setCompletedFocusSessions] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`eka_focus_sessions_${student.id}_${getLocalDateKey()}`);
      const parsed = saved ? parseInt(saved, 10) : 0;
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  });
  const [completedFocusMinutes, setCompletedFocusMinutes] = useState<number>(() => {
    try {
      const dateStr = getLocalDateKey();
      const savedMins = localStorage.getItem(`eka_focus_minutes_${student.id}_${dateStr}`);
      if (savedMins !== null) {
        const parsedMins = parseInt(savedMins, 10);
        if (Number.isFinite(parsedMins) && parsedMins >= 0) return parsedMins;
      }
      const savedCount = localStorage.getItem(`eka_focus_sessions_${student.id}_${dateStr}`);
      const parsedCount = savedCount ? parseInt(savedCount, 10) : 0;
      return Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount * DEFAULT_FOCUS_MINUTES : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(focusStorageKey);
      const parsed = saved ? parseInt(saved, 10) : 0;
      const validCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      setCompletedFocusSessions(validCount);

      const savedMins = localStorage.getItem(focusMinutesStorageKey);
      const parsedMins = savedMins !== null ? parseInt(savedMins, 10) : NaN;
      setCompletedFocusMinutes(
        Number.isFinite(parsedMins) && parsedMins >= 0
          ? parsedMins
          : validCount * DEFAULT_FOCUS_MINUTES
      );
    } catch {
      setCompletedFocusSessions(0);
      setCompletedFocusMinutes(0);
    }
  }, [focusStorageKey, focusMinutesStorageKey]);

  useEffect(() => {
    if (!pomodoroRunning) return;

    const timerId = window.setInterval(() => {
      setPomodoroSecondsLeft((prev) => {
        if (prev > 1) {
          return prev - 1;
        }

        // Phase completed
        setPomodoroRunning(false);
        if (pomodoroPhase === 'focus') {
          setCompletedFocusSessions((count) => {
            const nextCount = count + 1;
            try {
              localStorage.setItem(focusStorageKey, String(nextCount));
            } catch {
              // ignore storage errors
            }
            return nextCount;
          });
          setCompletedFocusMinutes((mins) => {
            const nextMins = mins + focusMinutes;
            try {
              localStorage.setItem(focusMinutesStorageKey, String(nextMins));
            } catch {
              // ignore storage errors
            }
            return nextMins;
          });
          if (!dndEnabled) {
            playSound('success');
          }
          setPomodoroPhase('break');
          setCustomMinutesDraft(String(breakMinutes));
          return breakMinutes * 60;
        } else {
          if (!dndEnabled) {
            playSound('pop');
          }
          setPomodoroPhase('focus');
          setCustomMinutesDraft(String(focusMinutes));
          return focusMinutes * 60;
        }
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [
    pomodoroRunning,
    pomodoroPhase,
    dndEnabled,
    focusStorageKey,
    focusMinutesStorageKey,
    focusMinutes,
    breakMinutes,
  ]);

  const handleSelectPomodoroPhase = (phase: PomodoroPhase) => {
    playSound('pop');
    const nextMins = phase === 'focus' ? focusMinutes : breakMinutes;
    setPomodoroRunning(false);
    setPomodoroPhase(phase);
    setCustomMinutesDraft(String(nextMins));
    setPomodoroSecondsLeft(nextMins * 60);
  };

  const handleUpdatePhaseMinutes = (nextMinutesRaw: number, syncDraft = true) => {
    if (pomodoroRunning) return;
    const maxMinutes = pomodoroPhase === 'focus' ? 180 : 60;
    const clamped = Math.min(maxMinutes, Math.max(1, Math.round(nextMinutesRaw)));
    if (pomodoroPhase === 'focus') {
      setFocusMinutes(clamped);
    } else {
      setBreakMinutes(clamped);
    }
    if (syncDraft) {
      setCustomMinutesDraft(String(clamped));
    }
    setPomodoroSecondsLeft(clamped * 60);
  };

  const handleTogglePomodoro = () => {
    playSound('pop');
    setPomodoroRunning((running) => !running);
  };

  const handleResetPomodoro = () => {
    playSound('pop');
    setPomodoroRunning(false);
    setPomodoroSecondsLeft((pomodoroPhase === 'focus' ? focusMinutes : breakMinutes) * 60);
  };

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
    [student.shift, activeSession, activeModal]
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
          detail: parsed.error || 'Scan a valid Ekā seat QR sticker.',
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

  const handleOpenModal = (section: StudentModalSection) => {
    playSound('pop');
    setActiveModal(section);
  };

  const handleCloseModal = () => {
    playSound('pop');
    if (activeModal === 'scanner') {
      stopCamera();
    }
    setActiveModal(null);
  };

  const ownerPhone = library?.contact_phone || '919876543210';
  const cleanPhone = ownerPhone.replace(/[^0-9]/g, '');
  const waChatUrl = `https://wa.me/${cleanPhone}`;

  const weekDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const assignedSeatNorm = normalizeSeatLabel(student.seat_number);

  const modalMeta: Record<StudentModalSection, { title: string; subtitle: string }> = {
    scanner: {
      title: 'Check-In / QR Scan',
      subtitle: `Seat #${assignedSeatNorm} · ${student.shift}`,
    },
    validity: {
      title: 'Validity & Plan Status',
      subtitle: `${library?.name || 'Study Library'} Membership`,
    },
    streak: {
      title: 'Focus Streak & Activity',
      subtitle: `Verified attendance for ${student.name}`,
    },
    rules: {
      title: 'Library Rules & Amenities',
      subtitle: `${library?.name || 'Study Library'} · Desk #${assignedSeatNorm}`,
    },
    focus: {
      title: 'Focus Mode & Pomodoro Timer',
      subtitle: `Seat #${assignedSeatNorm} · Deep Study Session`,
    },
  };

  const currentPhaseMinutes = pomodoroPhase === 'focus' ? focusMinutes : breakMinutes;
  const currentPhaseTotalSec = currentPhaseMinutes * 60;
  const activePresets = pomodoroPhase === 'focus' ? FOCUS_PRESETS_MIN : BREAK_PRESETS_MIN;
  const pomodoroProgressPct = Math.min(
    100,
    Math.max(0, Math.round(((currentPhaseTotalSec - pomodoroSecondsLeft) / currentPhaseTotalSec) * 100))
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* SINGLE-PAGE ZERO-SCROLL DASHBOARD */}
      <div className="flex-1 min-h-0 overflow-hidden max-w-4xl w-full mx-auto px-3 sm:px-6 py-2.5 sm:py-5 flex flex-col justify-between gap-2.5 sm:gap-4">
        {/* TOP SECTION: COMPACT USER IDENTITY CARD */}
        <div className="bg-white p-3 sm:p-4 duo-card flex items-center gap-3 sm:gap-3.5 shrink-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#FAFAFA] border-2 border-[#e5e5e5] flex items-center justify-center shrink-0">
            <EkaSigmaIcon className="w-7 h-7 sm:w-8 sm:h-8" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-[#46a302] truncate">
              {activeSession ? 'Seated & Checked In' : 'Active Scholar'} · {library?.name || 'Study Library'}
            </p>
            <h1 className="font-display text-lg sm:text-2xl font-black text-[#3c3c3c] truncate leading-tight">
              {student.name}
            </h1>
            <p className="text-[11px] font-semibold text-slate-500 truncate mt-0.5">
              PIN <span className="font-mono font-bold text-slate-700">{studentCode}</span>
              {library?.location ? ` · ${library.location}` : ''}
            </p>
          </div>
        </div>

        {/* CORE SEAT DETAILS CARD */}
        <div className="bg-white p-3.5 sm:p-5 duo-card flex flex-col justify-center gap-2.5 sm:gap-3.5 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span className="uppercase tracking-wider text-[11px] font-black">Reserved Study Desk</span>
            <span className={`font-black ${activeSession ? 'text-[#46a302]' : 'text-[#1899d6]'}`}>
              {activeSession
                ? `In Hall since ${formatTimeDisplay(activeSession.check_in_time)}`
                : 'Verified Pass'}
            </span>
          </div>

          <div className="flex items-center gap-3.5 sm:gap-4">
            <div className="w-16 h-16 sm:w-22 sm:h-22 rounded-2xl bg-[#1cb0f6] text-white flex flex-col items-center justify-center border-b-4 border-[#1899d6] shadow-sm shrink-0">
              <span className="text-[10px] uppercase font-black tracking-wider opacity-90">Desk</span>
              <span className="font-display text-xl sm:text-3xl font-black leading-tight tabular-nums">
                {assignedSeatNorm}
              </span>
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="font-display text-lg sm:text-2xl font-black text-[#3c3c3c] truncate">
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
        </div>

        {/* PRIMARY ACTION BUTTONS GRID / LIST (ALL VISIBLE WITHOUT SCROLLING) */}
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-2 sm:gap-3">
          {/* Primary CTA: Check-In / QR Scan */}
          <button
            type="button"
            onClick={() => handleOpenModal('scanner')}
            className={`w-full py-3 sm:py-3.5 px-4 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer min-h-[48px] sm:min-h-[54px] shrink-0 ${
              activeSession ? 'duo-btn-orange' : 'duo-btn-green'
            }`}
          >
            <QrCode className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="truncate">
              {activeSession
                ? `Check-Out / QR Scan (${assignedSeatNorm})`
                : `Check-In / QR Scan (${assignedSeatNorm})`}
            </span>
          </button>

          {/* Secondary Feature Buttons (2x2 Clean Flat Cards) */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {/* Validity & Plan Status */}
            <button
              type="button"
              onClick={() => handleOpenModal('validity')}
              className="relative bg-white p-3 sm:p-4 duo-card text-left cursor-pointer hover:border-[#E53935] transition-colors flex flex-col justify-between gap-1.5 min-h-[76px] sm:min-h-[88px]"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isExpired
                      ? 'bg-[#E53935]/10 text-[#E53935]'
                      : isExpiringSoon
                      ? 'bg-amber-50 text-[#e08500]'
                      : 'bg-[#1cb0f6]/12 text-[#1899d6]'
                  }`}
                >
                  <Calendar className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {(isExpired || isExpiringSoon) && (
                    <span className="w-2 h-2 rounded-full bg-[#E53935]" aria-hidden="true" />
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block truncate">
                  Validity & Plan Status
                </span>
                <span
                  className={`font-display text-xs sm:text-base font-black tabular-nums block truncate ${
                    isExpired ? 'text-[#E53935]' : isExpiringSoon ? 'text-[#e08500]' : 'text-[#3c3c3c]'
                  }`}
                >
                  {isExpired ? 'Expired' : `${daysRemaining} Days Left`}
                </span>
              </div>
            </button>

            {/* Focus Streak & Activity */}
            <button
              type="button"
              onClick={() => handleOpenModal('streak')}
              className="bg-white p-3 sm:p-4 duo-card text-left cursor-pointer hover:border-[#E53935] transition-colors flex flex-col justify-between gap-1.5 min-h-[76px] sm:min-h-[88px]"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#E53935]/10 text-[#E53935] flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block truncate">
                  Focus Streak & Activity
                </span>
                <span className="font-display text-xs sm:text-base font-black text-[#3c3c3c] tabular-nums block truncate">
                  {streakDays} {streakDays === 1 ? 'Day' : 'Days'}
                </span>
              </div>
            </button>

            {/* Focus Mode & Pomodoro Timer */}
            <button
              type="button"
              onClick={() => handleOpenModal('focus')}
              className="bg-white p-3 sm:p-4 duo-card text-left cursor-pointer hover:border-[#E53935] transition-colors flex flex-col justify-between gap-1.5 min-h-[76px] sm:min-h-[88px]"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div
                  className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    pomodoroRunning
                      ? 'bg-[#E53935] text-white'
                      : 'bg-[#E53935]/10 text-[#E53935]'
                  }`}
                >
                  <Timer className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {pomodoroRunning && (
                    <span className="w-2 h-2 rounded-full bg-[#E53935] animate-pulse" aria-hidden="true" />
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block truncate">
                  Focus Mode & Pomodoro Timer
                </span>
                <span
                  className={`font-display text-xs sm:text-base font-black tabular-nums block truncate ${
                    pomodoroRunning ? 'text-[#E53935]' : 'text-[#3c3c3c]'
                  }`}
                >
                  {pomodoroRunning
                    ? `${formatTimerClock(pomodoroSecondsLeft)} · ${pomodoroPhase === 'focus' ? 'Study' : 'Break'}`
                    : `${completedFocusSessions} ${completedFocusSessions === 1 ? 'Session' : 'Sessions'} Today`}
                </span>
              </div>
            </button>

            {/* Library Rules & Amenities */}
            <button
              type="button"
              onClick={() => handleOpenModal('rules')}
              className="bg-white p-3 sm:p-4 duo-card text-left cursor-pointer hover:border-[#1899d6] transition-colors flex flex-col justify-between gap-1.5 min-h-[76px] sm:min-h-[88px]"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#1cb0f6]/12 text-[#1899d6] flex items-center justify-center shrink-0">
                  <BookOpen className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block truncate">
                  Library Rules & Amenities
                </span>
                <span className="font-display text-xs sm:text-base font-black text-[#3c3c3c] block truncate">
                  Guidelines & Desk
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL / SUB-PAGE OVERLAY */}
      {activeModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-modal-title"
          onClick={handleCloseModal}
        >
          <div
            className="bg-[#f7f9fa] w-full sm:max-w-lg max-h-[90dvh] rounded-t-3xl sm:rounded-3xl border-2 border-[#e5e5e5] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-white px-4 sm:px-5 py-3.5 border-b-2 border-[#e5e5e5] flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h2
                  id="student-modal-title"
                  className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate"
                >
                  {modalMeta[activeModal].title}
                </h2>
                <p className="text-[11px] font-semibold text-slate-500 truncate">
                  {modalMeta[activeModal].subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                aria-label="Close modal"
                className="w-10 h-10 rounded-xl duo-btn-white flex items-center justify-center text-slate-600 hover:text-[#3c3c3c] cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
              {/* MODAL 1: IN-APP QR SCANNER & REAL-TIME ATTENDANCE */}
              {activeModal === 'scanner' && (
                <div className="flex flex-col gap-2.5">
                  {/* Live Session Status Header */}
                  <div
                    className={`p-3 duo-card flex items-center justify-between gap-2.5 ${
                      activeSession ? 'bg-emerald-50/90 border-emerald-300' : 'bg-white'
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
                      className={`p-3 rounded-2xl border-2 flex items-start gap-2.5 ${
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
                  <div className="bg-white p-3.5 duo-card flex flex-col gap-3">
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
                  <div className="bg-white p-3.5 duo-card flex flex-col gap-2">
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

              {/* MODAL 2: SHIFT & SUBSCRIPTION VALIDITY */}
              {activeModal === 'validity' && (
                <div className="flex flex-col gap-3">
                  {/* Shift Banner */}
                  <div className="bg-white p-3.5 sm:p-4 duo-card flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#ce82ff] text-white flex items-center justify-center border-b-3 border-[#a855f7] shrink-0">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                        Assigned Study Shift
                      </span>
                      <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                        {student.shift}
                      </h3>
                      <p className="text-[11px] font-semibold text-slate-500 truncate">
                        Wi-Fi · AC Hall · Power Outlet Included
                      </p>
                    </div>
                  </div>

                  {/* Validity & Countdown Card */}
                  <div
                    className={`p-4 sm:p-5 duo-card flex flex-col gap-3.5 ${
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
                  </div>
                </div>
              )}

              {/* MODAL 3: DAILY CHECK-IN & STREAK */}
              {activeModal === 'streak' && (
                <div className="flex flex-col gap-3">
                  <div className="bg-white p-5 sm:p-6 duo-card flex flex-col items-center justify-center text-center gap-4">
                    <div className="w-18 h-18 rounded-2xl bg-[#FAFAFA] border-2 border-[#e5e5e5] flex items-center justify-center">
                      <EkaSigmaIcon className="w-10 h-10" />
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
                    onClick={() => handleOpenModal('scanner')}
                    className={`w-full py-3.5 px-6 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all min-h-[48px] ${
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

              {/* MODAL 4: RULES & LIBRARY SUPPORT */}
              {activeModal === 'rules' && (
                <div className="flex flex-col gap-3">
                  <div className="bg-white p-4 sm:p-5 duo-card flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display font-black text-base text-[#3c3c3c]">
                        Hall Rules & Amenities
                      </h3>
                      <span className="text-[11px] font-bold text-slate-400">Seat #{assignedSeatNorm}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
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
                  <div className="bg-emerald-50/90 border-2 border-emerald-200 rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3">
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
                        href={waChatUrl}
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

              {/* MODAL 5: FOCUS MODE & POMODORO TIMER */}
              {activeModal === 'focus' && (
                <div className="flex flex-col gap-3">
                  {/* Pomodoro Timer Card */}
                  <div className="bg-white p-4 sm:p-5 duo-card flex flex-col gap-4">
                    {/* Phase Toggle */}
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
                      <button
                        type="button"
                        onClick={() => handleSelectPomodoroPhase('focus')}
                        className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider cursor-pointer transition-colors min-h-[38px] ${
                          pomodoroPhase === 'focus'
                            ? 'bg-[#E53935] text-white shadow-xs'
                            : 'text-slate-600 hover:text-[#3c3c3c]'
                        }`}
                      >
                        Focus · {focusMinutes}m
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectPomodoroPhase('break')}
                        className={`py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider cursor-pointer transition-colors min-h-[38px] ${
                          pomodoroPhase === 'break'
                            ? 'bg-[#1cb0f6] text-white shadow-xs'
                            : 'text-slate-600 hover:text-[#3c3c3c]'
                        }`}
                      >
                        Break · {breakMinutes}m
                      </button>
                    </div>

                    {/* Quick Duration Presets */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Quick Presets
                        </span>
                        {pomodoroRunning && (
                          <span className="text-[10px] font-bold text-slate-400">
                            Pause or reset to adjust
                          </span>
                        )}
                      </div>

                      <div className={`grid gap-1.5 ${activePresets.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                        {activePresets.map((presetMin) => {
                          const isSelected = currentPhaseMinutes === presetMin;
                          return (
                            <button
                              key={presetMin}
                              type="button"
                              disabled={pomodoroRunning}
                              onClick={() => {
                                playSound('pop');
                                handleUpdatePhaseMinutes(presetMin);
                              }}
                              className={`py-1.5 px-2 rounded-xl border-2 text-xs font-black tabular-nums transition-colors min-h-[36px] ${
                                isSelected
                                  ? pomodoroPhase === 'focus'
                                    ? 'bg-[#E53935] border-[#B71C1C] text-white'
                                    : 'bg-[#1cb0f6] border-[#1899d6] text-white'
                                  : 'bg-white border-[#e5e5e5] text-[#3c3c3c] hover:border-slate-300'
                              } ${pomodoroRunning ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              {presetMin}m
                            </button>
                          );
                        })}
                      </div>

                      {/* Custom Time Stepper (-5m / Input / +5m) */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={pomodoroRunning || currentPhaseMinutes <= 1}
                          onClick={() => {
                            playSound('pop');
                            handleUpdatePhaseMinutes(currentPhaseMinutes - 5);
                          }}
                          className={`px-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] bg-white text-xs font-black text-[#3c3c3c] min-h-[38px] tabular-nums transition-colors ${
                            pomodoroRunning || currentPhaseMinutes <= 1
                              ? 'opacity-45 cursor-not-allowed'
                              : 'hover:border-[#3c3c3c] cursor-pointer'
                          }`}
                        >
                          -5m
                        </button>

                        <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] bg-slate-50 focus-within:border-[#E53935] min-h-[38px]">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Custom
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={pomodoroPhase === 'focus' ? 180 : 60}
                            disabled={pomodoroRunning}
                            value={customMinutesDraft}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setCustomMinutesDraft(raw);
                              const parsed = parseInt(raw, 10);
                              if (!Number.isNaN(parsed) && parsed >= 1) {
                                handleUpdatePhaseMinutes(parsed, false);
                              }
                            }}
                            onBlur={() => {
                              const parsed = parseInt(customMinutesDraft, 10);
                              if (Number.isNaN(parsed) || parsed < 1) {
                                setCustomMinutesDraft(String(currentPhaseMinutes));
                              } else {
                                handleUpdatePhaseMinutes(parsed, true);
                              }
                            }}
                            aria-label="Custom duration in minutes"
                            className="w-14 text-center font-display text-sm font-black text-[#3c3c3c] bg-transparent focus:outline-hidden tabular-nums disabled:opacity-50"
                          />
                          <span className="text-[11px] font-bold text-slate-500">min</span>
                        </label>

                        <button
                          type="button"
                          disabled={
                            pomodoroRunning ||
                            currentPhaseMinutes >= (pomodoroPhase === 'focus' ? 180 : 60)
                          }
                          onClick={() => {
                            playSound('pop');
                            handleUpdatePhaseMinutes(currentPhaseMinutes + 5);
                          }}
                          className={`px-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] bg-white text-xs font-black text-[#3c3c3c] min-h-[38px] tabular-nums transition-colors ${
                            pomodoroRunning ||
                            currentPhaseMinutes >= (pomodoroPhase === 'focus' ? 180 : 60)
                              ? 'opacity-45 cursor-not-allowed'
                              : 'hover:border-[#3c3c3c] cursor-pointer'
                          }`}
                        >
                          +5m
                        </button>
                      </div>
                    </div>

                    {/* Countdown Display */}
                    <div className="py-1 flex flex-col items-center text-center gap-2">
                      <span
                        className={`text-[11px] font-black uppercase tracking-wider ${
                          pomodoroPhase === 'focus' ? 'text-[#E53935]' : 'text-[#1899d6]'
                        }`}
                      >
                        {pomodoroRunning
                          ? pomodoroPhase === 'focus'
                            ? 'Deep Study in Progress'
                            : 'Short Break in Progress'
                          : pomodoroPhase === 'focus'
                          ? 'Ready to Focus'
                          : 'Break Ready'}
                      </span>

                      <div className="font-display text-5xl sm:text-6xl font-black text-[#3c3c3c] tabular-nums tracking-tight leading-none">
                        {formatTimerClock(pomodoroSecondsLeft)}
                      </div>

                      {/* Lightweight Progress Bar */}
                      <div className="w-full max-w-xs h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200 mt-1">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            pomodoroPhase === 'focus' ? 'bg-[#E53935]' : 'bg-[#1cb0f6]'
                          }`}
                          style={{ width: `${pomodoroProgressPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Start / Pause & Reset Controls */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={handleTogglePomodoro}
                        className={`col-span-2 py-3 px-4 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer min-h-[46px] ${
                          pomodoroPhase === 'focus' ? 'duo-btn-green' : 'duo-btn-blue'
                        }`}
                      >
                        {pomodoroRunning ? (
                          <>
                            <Pause className="w-4 h-4 shrink-0" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 shrink-0" />
                            <span>Start</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleResetPomodoro}
                        className="py-3 px-3 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-wider duo-btn-white text-[#3c3c3c] flex items-center justify-center gap-1.5 cursor-pointer min-h-[46px]"
                      >
                        <RotateCcw className="w-4 h-4 shrink-0" />
                        <span>Reset</span>
                      </button>
                    </div>
                  </div>

                  {/* Daily Session Counter Card */}
                  <div className="bg-white p-3.5 sm:p-4 duo-card flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                        Completed Focus Sessions Today
                      </span>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="font-display text-2xl font-black text-[#3c3c3c] tabular-nums">
                          {completedFocusSessions}
                        </span>
                        <span className="text-xs font-bold text-slate-500 tabular-nums">
                          ({completedFocusMinutes} min deep focus)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
                      {[0, 1, 2, 3].map((slot) => (
                        <span
                          key={slot}
                          className={`w-3 h-3 rounded-full border ${
                            slot < completedFocusSessions
                              ? 'bg-[#E53935] border-[#B71C1C]'
                              : 'bg-slate-100 border-slate-300'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Ambient / DND Indicator Toggle */}
                  <button
                    type="button"
                    onClick={() => setDndEnabled((prev) => !prev)}
                    aria-pressed={dndEnabled}
                    className={`w-full p-3.5 sm:p-4 duo-card text-left cursor-pointer transition-colors flex items-center justify-between gap-3 ${
                      dndEnabled ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white text-[#3c3c3c]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          dndEnabled ? 'bg-[#E53935] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {dndEnabled ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <span
                          className={`font-display text-xs sm:text-sm font-black block truncate ${
                            dndEnabled ? 'text-white' : 'text-[#3c3c3c]'
                          }`}
                        >
                          {dndEnabled ? 'Silent Study · DND Active' : 'Timer Chime Enabled'}
                        </span>
                        <span
                          className={`text-[11px] font-semibold block truncate ${
                            dndEnabled ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {dndEnabled
                            ? 'Keep phone notifications silenced in the hall'
                            : 'Tap to silence timer sound for library mode'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg shrink-0 ${
                        dndEnabled
                          ? 'bg-white/15 text-white'
                          : 'bg-[#1cb0f6]/12 text-[#1899d6]'
                      }`}
                    >
                      {dndEnabled ? 'Muted' : 'Sound On'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
