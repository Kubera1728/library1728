/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Building2,
  Users,
  Clock,
  AlertCircle,
  Plus,
  Search,
  MessageCircle,
  Calendar,
  CheckCircle,
  Layers,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Phone,
  Trash2,
  LogOut,
  KeyRound,
  Grid3X3,
  ChevronDown,
  Pencil,
  IndianRupee,
  Sparkles,
  Check,
  Sunrise,
  Sunset,
  Sun,
  Moon,
  GraduationCap,
  CheckCircle2,
  Megaphone,
  Send,
  CheckCheck,
  MessageSquare,
  X,
  Wand2,
  Loader2,
  CheckSquare,
  QrCode,
  Download,
  ClipboardCheck,
  FileDown,
} from 'lucide-react';
import { AttendanceRecord, BroadcastRequest, Library, Shift, Student } from '../types/database';
import {
  dataService,
  isValidStudentPin,
  isWithinBroadcastRetention,
  pickAvailableFourDigitPin,
} from '../lib/supabase';
import {
  buildAttendanceTableRows,
  downloadAttendanceReportPdf,
  downloadMasterQrPdf,
  encodeSeatQrPayload,
  formatNumericDate,
  formatSeatBadgeNumber,
  generateSeatQrDataUrl,
  getLocalDateKey,
  hasShiftEndedForDate,
} from '../lib/qrAndPdf';
import { buildCanonicalSeatLabels } from '../lib/masterQrPdfBuilder';
import {
  calculateDaysRemaining,
  formatFriendlyDate,
  generatePhoneCallUrl,
  generateWhatsAppBlankChatUrl,
  getStudentExitDate,
  isStudentExited,
  stripSystemNoteTags,
  playSound,
  fireDuolingoConfetti,
} from '../lib/utils';
import { MascotOwl } from './MascotOwl';

export type OwnerNavSection =
  | 'overview'
  | 'students'
  | 'seatmap'
  | 'shifts'
  | 'qrcodes'
  | 'attendance'
  | 'broadcasts';

interface OwnerDashboardProps {
  ownerCode: string;
  libraryId: string;
  onLogout?: () => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  ownerCode,
  libraryId,
}) => {
  const [library, setLibrary] = useState<Library | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [studentViewFilter, setStudentViewFilter] = useState<'all' | 'renewals'>('all');
  const [showShiftFilterModal, setShowShiftFilterModal] = useState(false);

  // Single-Screen Navigation & Pagination States
  const [ownerSection, setOwnerSection] = useState<OwnerNavSection>('overview');
  const [studentPage, setStudentPage] = useState(0);
  const [seatPage, setSeatPage] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  // QR Codes & Attendance States
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceRecord[]>([]);
  const [refreshingAttendance, setRefreshingAttendance] = useState(false);
  const [qrSearch, setQrSearch] = useState('');
  const [qrPage, setQrPage] = useState(0);
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [downloadingQrPdf, setDownloadingQrPdf] = useState(false);
  const [previewSeatQr, setPreviewSeatQr] = useState<{
    seatLabel: string;
    dataUrl: string;
    payload: string;
  } | null>(null);

  const [attendanceFilterType, setAttendanceFilterType] = useState<'daily' | 'monthly' | 'custom'>('daily');
  const [attendanceDailyDate, setAttendanceDailyDate] = useState(() => getLocalDateKey());
  const [attendanceMonth, setAttendanceMonth] = useState(() => getLocalDateKey().slice(0, 7));
  const [attendanceRangeStart, setAttendanceRangeStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return getLocalDateKey(d);
  });
  const [attendanceRangeEnd, setAttendanceRangeEnd] = useState(() => getLocalDateKey());
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<
    'all' | 'present' | 'checked_in' | 'absent'
  >('all');
  const [attendancePage, setAttendancePage] = useState(0);
  const [attendanceTick, setAttendanceTick] = useState(() => Date.now());
  const [libraryActivationDate, setLibraryActivationDate] = useState<string>(() =>
    dataService.getLibraryActivationDate(libraryId)
  );
  const lastTodayKeyRef = useRef<string>(getLocalDateKey());

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Seat Capacity Modal
  const [showSeatModal, setShowSeatModal] = useState(false);
  const [seatCapacityInput, setSeatCapacityInput] = useState<number>(50);
  const [savingSeatCapacity, setSavingSeatCapacity] = useState(false);
  const [seatModalError, setSeatModalError] = useState<string | null>(null);

  // Student exit / vacate confirmation modal state
  const [studentToExit, setStudentToExit] = useState<Student | null>(null);
  const [exitingStudent, setExitingStudent] = useState(false);
  const [exitStudentError, setExitStudentError] = useState<string | null>(null);
  const [exitSuccessToast, setExitSuccessToast] = useState<{
    studentName: string;
    seatNumber: string;
  } | null>(null);

  // Broadcast Notice Request & WhatsApp Chat History states
  const [broadcastHistory, setBroadcastHistory] = useState<BroadcastRequest[]>([]);
  const [refreshingBroadcasts, setRefreshingBroadcasts] = useState(false);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [showBroadcastSuccessModal, setShowBroadcastSuccessModal] = useState(false);
  const [lastSubmittedBroadcast, setLastSubmittedBroadcast] = useState('');
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const broadcastTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedBroadcastIds, setSelectedBroadcastIds] = useState<string[]>([]);
  const [bulkDeletingBroadcasts, setBulkDeletingBroadcasts] = useState(false);
  const bubbleLongPressTimerRef = useRef<number | null>(null);
  const bubbleLongPressTriggeredRef = useRef(false);

  // Magic Wand AI Broadcast Generator states
  const getTodayDateStr = () => new Date().toISOString().split('T')[0];
  const getTomorrowDateStr = () => new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [showMagicWandModal, setShowMagicWandModal] = useState(false);
  const [magicCategory, setMagicCategory] = useState<
    'Festival' | 'Maintenance' | 'Cleaning' | 'Emergency' | 'General Notice'
  >('Festival');
  const [magicReason, setMagicReason] = useState('');
  const [magicScheduleMode, setMagicScheduleMode] = useState<'single' | 'range' | 'hours'>('single');
  const [magicSingleDate, setMagicSingleDate] = useState(getTomorrowDateStr);
  const [magicFromDate, setMagicFromDate] = useState(getTodayDateStr);
  const [magicToDate, setMagicToDate] = useState(getTomorrowDateStr);
  const [magicHoursDate, setMagicHoursDate] = useState(getTodayDateStr);
  const [magicStartTime, setMagicStartTime] = useState('16:00');
  const [magicEndTime, setMagicEndTime] = useState('22:00');
  const [generatingMagicNotice, setGeneratingMagicNotice] = useState(false);
  const [magicWandError, setMagicWandError] = useState<string | null>(null);

  const handleOpenMagicWand = () => {
    playSound('pop');
    setMagicWandError(null);
    setShowMagicWandModal(true);
  };

  const handleGenerateMagicNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicReason.trim()) {
      setMagicWandError('Please enter an event or reason (e.g. Chhath Puja, Water Tank Cleaning).');
      return;
    }

    setGeneratingMagicNotice(true);
    setMagicWandError(null);
    try {
      const response = await fetch('/api/broadcast/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          libraryName: library?.name || 'Study Library',
          category: magicCategory,
          reason: magicReason.trim(),
          scheduleMode: magicScheduleMode,
          singleDate: magicSingleDate,
          fromDate: magicFromDate,
          toDate: magicToDate,
          hoursDate: magicHoursDate,
          startTime: magicStartTime,
          endTime: magicEndTime,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.message) {
        throw new Error(data?.error || 'Could not generate notice. Please try again.');
      }

      setBroadcastMessage(data.message);
      setShowMagicWandModal(false);
      playSound('success');
      requestAnimationFrame(() => broadcastTextareaRef.current?.focus());
    } catch (err: any) {
      setMagicWandError(err?.message || 'Failed to generate broadcast message.');
    } finally {
      setGeneratingMagicNotice(false);
    }
  };

  const refreshBroadcastHistory = async (showSpinner = false) => {
    if (showSpinner) setRefreshingBroadcasts(true);
    try {
      const items = await dataService.getBroadcastRequestsByLibrary(libraryId);
      const retained = items.filter((item) => isWithinBroadcastRetention(item.created_at));
      setBroadcastHistory(retained);
      const retainedIds = new Set(retained.map((item) => item.id));
      setSelectedBroadcastIds((prev) => prev.filter((id) => retainedIds.has(id)));
    } catch (err) {
      console.warn('Failed to refresh broadcast history:', err);
    } finally {
      if (showSpinner) setRefreshingBroadcasts(false);
    }
  };

  const exitMultiSelectMode = () => {
    setIsMultiSelectMode(false);
    setSelectedBroadcastIds([]);
  };

  const enterMultiSelectWith = (id?: string) => {
    setIsMultiSelectMode(true);
    if (id) {
      setSelectedBroadcastIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
    playSound('pop');
  };

  const toggleBroadcastSelection = (id: string) => {
    setSelectedBroadcastIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
    playSound('pop');
  };

  const handleDeleteBroadcastMessage = async (id: string) => {
    setBroadcastHistory((prev) => prev.filter((item) => item.id !== id));
    setSelectedBroadcastIds((prev) => prev.filter((item) => item !== id));
    playSound('pop');
    try {
      await dataService.deleteBroadcastRequest(id);
    } catch (err) {
      console.warn('Failed to delete broadcast message:', err);
    }
  };

  const handleBulkDeleteBroadcasts = async () => {
    if (selectedBroadcastIds.length === 0 || bulkDeletingBroadcasts) return;
    const idsToDelete = [...selectedBroadcastIds];
    const idSet = new Set(idsToDelete);

    setBulkDeletingBroadcasts(true);
    // Instant optimistic purge from chat view & exit selection mode cleanly
    setBroadcastHistory((prev) => prev.filter((item) => !idSet.has(item.id)));
    setIsMultiSelectMode(false);
    setSelectedBroadcastIds([]);
    playSound('pop');

    try {
      await dataService.deleteBroadcastRequests(idsToDelete);
    } catch (err) {
      console.warn('Failed to bulk delete broadcast messages:', err);
    } finally {
      setBulkDeletingBroadcasts(false);
    }
  };

  const handleSubmitBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = broadcastMessage.trim();
    if (!trimmed) return;

    const newReq: BroadcastRequest = {
      id: `bcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      library_id: libraryId,
      library_name: library?.name || 'Study Library',
      message: trimmed,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    // Instant confirmation UI & optimistic chat bubble append
    exitMultiSelectMode();
    setBroadcastHistory((prev) =>
      [...prev, newReq].filter((item) => isWithinBroadcastRetention(item.created_at))
    );
    setLastSubmittedBroadcast(trimmed);
    setBroadcastMessage('');
    setShowBroadcastSuccessModal(true);
    playSound('success');
    fireDuolingoConfetti();

    void dataService.createBroadcastRequest(newReq);
  };

  // Custom Shifts Modal
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftForm, setShiftForm] = useState({
    name: '',
    timing: '',
    fee: 800,
  });
  const [savingShift, setSavingShift] = useState(false);
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);

  // In-App Delete Shift Confirmation State
  const [shiftToDelete, setShiftToDelete] = useState<Shift | null>(null);
  const [deletingShift, setDeletingShift] = useState(false);
  const [shiftDeleteError, setShiftDeleteError] = useState<string | null>(null);

  // Time Picker Helper State
  const [customStartTime, setCustomStartTime] = useState('07:00 AM');
  const [customEndTime, setCustomEndTime] = useState('01:00 PM');

  // Collapsible pickers in Student Assignment Modal (hidden by default for compact initial view)
  const [isShiftMenuOpen, setIsShiftMenuOpen] = useState(false);
  const [isSeatPickerOpen, setIsSeatPickerOpen] = useState(false);
  const [checkingSeatAvailability, setCheckingSeatAvailability] = useState(false);

  // Total Seats & Availability Helpers
  const totalSeats = library?.total_seats || 50;
  const allSeatLabels = Array.from({ length: totalSeats }, (_, i) => `A-${i + 1}`);

  // Normalize seat identifiers so "1", "01", "Seat 1", "A1", "A-01", "A-1" all resolve to "A-1"
  const normalizeSeatLabel = (raw: string): string => {
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
  };

  // Parse shift operating window (e.g. "07:00 AM - 01:00 PM") into [startMin, endMin]
  const parseShiftMinutesRange = (shiftStr: string): [number, number] | null => {
    const timeRegex = /(\d{1,2}):(\d{2})\s*(AM|PM)?/gi;
    const matches = Array.from(shiftStr.matchAll(timeRegex));
    if (matches.length < 2) return null;

    const toMinutes = (m: RegExpMatchArray): number => {
      let hour = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const meridiem = (m[3] || '').toUpperCase();
      if (meridiem === 'PM' && hour < 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;
      return hour * 60 + min;
    };

    const start = toMinutes(matches[0]);
    let end = toMinutes(matches[1]);
    if (end <= start) end += 1440; // overnight window
    return [start, end];
  };

  const normalizeShiftCoreName = (shiftStr: string): string =>
    shiftStr
      .split('(')[0]
      .toLowerCase()
      .replace(/\b(shift|batch|slot|hours|access)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const doShiftsOverlap = (targetShift: string, studentShift: string): boolean => {
    const targetLower = (targetShift || '').toLowerCase();
    const studentLower = (studentShift || '').toLowerCase();

    const isTargetFullDay =
      targetLower.includes('full') || targetLower.includes('24') || targetLower.includes('all day');
    const isStudentFullDay =
      studentLower.includes('full') || studentLower.includes('24') || studentLower.includes('all day');

    if (isTargetFullDay || isStudentFullDay) return true;

    const targetCore = normalizeShiftCoreName(targetShift);
    const studentCore = normalizeShiftCoreName(studentShift);

    if (targetShift.trim().toLowerCase() === studentShift.trim().toLowerCase()) return true;
    if (targetCore && studentCore && (targetCore === studentCore || targetCore.includes(studentCore) || studentCore.includes(targetCore))) {
      return true;
    }

    const rangeA = parseShiftMinutesRange(targetShift);
    const rangeB = parseShiftMinutesRange(studentShift);
    if (rangeA && rangeB) {
      // Check both standard day and +24h shifted window for overnight overlap accuracy
      return (
        (rangeA[0] < rangeB[1] && rangeB[0] < rangeA[1]) ||
        (rangeA[0] + 1440 < rangeB[1] && rangeB[0] < rangeA[1] + 1440)
      );
    }

    return false;
  };

  // Check if a seat is occupied in a specific shift
  const getSeatOccupancyInShift = (
    seatLabel: string,
    targetShiftString: string,
    currentStudentId?: string,
    studentsList: Student[] = students
  ): { isOccupied: boolean; occupantName?: string; occupantShift?: string } => {
    const cleanSeat = normalizeSeatLabel(seatLabel);

    for (const st of studentsList) {
      if (currentStudentId && st.id === currentStudentId) continue;
      if (st.is_active === false || isStudentExited(st)) continue;
      if (normalizeSeatLabel(st.seat_number) !== cleanSeat) continue;

      if (doShiftsOverlap(targetShiftString, st.shift)) {
        return { isOccupied: true, occupantName: st.name, occupantShift: st.shift };
      }
    }

    return { isOccupied: false };
  };

  const getAvailableSeatsForShift = (
    targetShift: string,
    currentStudentId?: string,
    studentsList: Student[] = students
  ) => {
    const excludeId = currentStudentId || editingStudent?.id;
    return allSeatLabels.filter(
      (seat) => !getSeatOccupancyInShift(seat, targetShift, excludeId, studentsList).isOccupied
    );
  };

  // Interactive Shift Slider Popup Modal State
  const [showShiftSliderModal, setShowShiftSliderModal] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [shiftSwipeDir, setShiftSwipeDir] = useState<'left' | 'right' | null>(null);

  // Multi-Shift Seat Details Popup Modal State
  const [selectedSeatForDetails, setSelectedSeatForDetails] = useState<string | null>(null);
  const [seatSlideIndex, setSeatSlideIndex] = useState(0);
  const [seatTouchStartX, setSeatTouchStartX] = useState<number | null>(null);
  const [seatSwipeDir, setSeatSwipeDir] = useState<'left' | 'right' | null>(null);
  const [studentPinMap, setStudentPinMap] = useState<Record<string, string>>({});
  const allExistingPinsRef = useRef<string[]>([]);
  const [copiedSeatPin, setCopiedSeatPin] = useState<string | null>(null);

  // Helper to theme shift slides with vibrant Duolingo colors
  const getShiftTheme = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('morning') || lower.includes('dawn') || lower.includes('early')) {
      return {
        bg: 'from-amber-50 to-orange-50',
        border: 'border-amber-300',
        badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
        iconBg: 'bg-amber-500 border-amber-600',
        accentText: 'text-amber-800',
        tag: 'Morning Batch',
        icon: Sunrise,
      };
    }
    if (lower.includes('afternoon') || lower.includes('noon')) {
      return {
        bg: 'from-yellow-50 to-amber-50',
        border: 'border-yellow-300',
        badgeBg: 'bg-yellow-100 text-yellow-900 border-yellow-300',
        iconBg: 'bg-yellow-500 border-yellow-600',
        accentText: 'text-yellow-800',
        tag: 'Afternoon Batch',
        icon: Sun,
      };
    }
    if (lower.includes('evening') || lower.includes('dusk')) {
      return {
        bg: 'from-purple-50 to-indigo-50',
        border: 'border-purple-300',
        badgeBg: 'bg-purple-100 text-purple-900 border-purple-300',
        iconBg: 'bg-[#ce82ff] border-[#a855f7]',
        accentText: 'text-purple-800',
        tag: 'Evening Batch',
        icon: Sunset,
      };
    }
    if (lower.includes('night') || lower.includes('owl')) {
      return {
        bg: 'from-indigo-50 to-slate-100',
        border: 'border-indigo-300',
        badgeBg: 'bg-indigo-100 text-indigo-900 border-indigo-300',
        iconBg: 'bg-indigo-600 border-indigo-700',
        accentText: 'text-indigo-800',
        tag: 'Night Owls',
        icon: Moon,
      };
    }
    if (lower.includes('full') || lower.includes('24') || lower.includes('day')) {
      return {
        bg: 'from-emerald-50 to-teal-50',
        border: 'border-emerald-300',
        badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        iconBg: 'bg-[#58cc02] border-[#46a302]',
        accentText: 'text-emerald-800',
        tag: '24/7 Full Access',
        icon: Sparkles,
      };
    }
    return {
      bg: 'from-sky-50 to-blue-50',
      border: 'border-sky-300',
      badgeBg: 'bg-sky-100 text-sky-900 border-sky-300',
      iconBg: 'bg-[#1cb0f6] border-[#1899d6]',
      accentText: 'text-[#1899d6]',
      tag: 'Custom Shift',
      icon: Clock,
    };
  };

  const goToPrevSlide = () => {
    if (shifts.length <= 1) return;
    playSound('pop');
    setShiftSwipeDir('right');
    setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : shifts.length - 1));
  };

  const goToNextSlide = () => {
    if (shifts.length <= 1) return;
    playSound('pop');
    setShiftSwipeDir('left');
    setCurrentSlideIndex((prev) => (prev < shifts.length - 1 ? prev + 1 : 0));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.targetTouches[0].clientX);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartX - touchEndX;
    const diffY = touchStartY !== null ? touchStartY - touchEndY : 0;

    if (Math.abs(diffX) > 36 && Math.abs(diffX) > Math.abs(diffY) * 1.15) {
      if (diffX > 0) {
        goToNextSlide();
      } else {
        goToPrevSlide();
      }
    }
    setTouchStartX(null);
    setTouchStartY(null);
  };

  const handleShiftMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a')) return;
    setTouchStartX(e.clientX);
    setTouchStartY(e.clientY);
  };

  const handleShiftMouseUp = (e: React.MouseEvent) => {
    if (touchStartX === null) return;
    const diffX = touchStartX - e.clientX;
    const diffY = touchStartY !== null ? touchStartY - e.clientY : 0;
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.15) {
      if (diffX > 0) {
        goToNextSlide();
      } else {
        goToPrevSlide();
      }
    }
    setTouchStartX(null);
    setTouchStartY(null);
  };

  // Keyboard navigation for slider popup
  useEffect(() => {
    if (!showShiftSliderModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPrevSlide();
      } else if (e.key === 'ArrowRight') {
        goToNextSlide();
      } else if (e.key === 'Escape') {
        setShiftSwipeDir(null);
        setTouchStartX(null);
        setTouchStartY(null);
        setShowShiftSliderModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showShiftSliderModal, shifts.length]);

  const isFullDayShiftString = (shiftStr: string): boolean => {
    const lower = (shiftStr || '').toLowerCase();
    return lower.includes('full') || lower.includes('24') || lower.includes('all day');
  };

  type SeatSlideItem = {
    id: string;
    shiftName: string;
    shiftTiming: string;
    shiftFullString: string;
    shiftFee: number;
    student: Student | null;
  };

  const getSeatSlides = (seatLabel: string, studentsList: Student[] = students): SeatSlideItem[] => {
    const cleanSeat = normalizeSeatLabel(seatLabel);
    const seatStudents = studentsList.filter(
      (s) => !isStudentExited(s) && normalizeSeatLabel(s.seat_number) === cleanSeat
    );

    const hasFullDayBooking = seatStudents.some((st) => isFullDayShiftString(st.shift));
    const hasPartialBooking = seatStudents.some((st) => !isFullDayShiftString(st.shift));

    const matchedIds = new Set<string>();
    const slides: SeatSlideItem[] = [];

    if (shifts.length > 0) {
      shifts.forEach((sh) => {
        const shiftStr = `${sh.name} (${sh.timing})`;
        const coreA = normalizeShiftCoreName(shiftStr);

        const directStudent =
          seatStudents.find((st) => {
            const stLower = (st.shift || '').trim().toLowerCase();
            const shLower = shiftStr.trim().toLowerCase();
            if (stLower === shLower) return true;
            const coreB = normalizeShiftCoreName(st.shift);
            return Boolean(
              coreA && coreB && (coreA === coreB || coreA.includes(coreB) || coreB.includes(coreA))
            );
          }) || null;

        if (directStudent) {
          matchedIds.add(directStudent.id);
          slides.push({
            id: sh.id,
            shiftName: sh.name,
            shiftTiming: sh.timing,
            shiftFullString: shiftStr,
            shiftFee: Number(sh.fee) || 0,
            student: directStudent,
          });
          return;
        }

        // Mutually exclusive hiding for unbooked shifts:
        // 1) If seat is booked for Full Day (24h), hide all partial shifts (Morning/Evening/etc.)
        if (hasFullDayBooking) return;
        // 2) If seat has any partial booking (Morning and/or Evening), hide Full Day (24h)
        if (isFullDayShiftString(shiftStr) && hasPartialBooking) return;
        // 3) Hide any other shift whose hours conflict with an existing booking on this seat
        if (seatStudents.some((st) => doShiftsOverlap(shiftStr, st.shift))) return;

        slides.push({
          id: sh.id,
          shiftName: sh.name,
          shiftTiming: sh.timing,
          shiftFullString: shiftStr,
          shiftFee: Number(sh.fee) || 0,
          student: null,
        });
      });
    } else if (seatStudents.length === 0) {
      slides.push({
        id: 'general',
        shiftName: 'General Shift',
        shiftTiming: 'Full Day',
        shiftFullString: 'General Shift (Full Day)',
        shiftFee: 800,
        student: null,
      });
    }

    // Include any active students on this seat assigned to legacy/custom shift names
    seatStudents.forEach((st) => {
      if (!matchedIds.has(st.id)) {
        const nameOnly = st.shift.split('(')[0].trim() || st.shift;
        const timingMatch = st.shift.match(/\(([^)]+)\)/);
        slides.push({
          id: `extra_${st.id}`,
          shiftName: nameOnly,
          shiftTiming: timingMatch ? timingMatch[1] : st.shift,
          shiftFullString: st.shift,
          shiftFee: getShiftFeeByString(st.shift),
          student: st,
        });
      }
    });

    return slides;
  };

  const handleOpenSeatDetailsModal = async (seatLabel: string) => {
    const cleanSeat = normalizeSeatLabel(seatLabel);
    playSound('pop');

    const slides = getSeatSlides(cleanSeat, students);
    const firstOccupiedIdx = slides.findIndex((sl) => Boolean(sl.student));
    setSeatSwipeDir(null);
    setSeatSlideIndex(firstOccupiedIdx >= 0 ? firstOccupiedIdx : 0);
    setSelectedSeatForDetails(cleanSeat);

    // Refresh students from DB silently to guarantee fresh occupancy info
    try {
      const latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
    } catch (err) {
      console.warn('Error refreshing seat details from DB:', err);
    }
  };

  useEffect(() => {
    if (!selectedSeatForDetails) return;
    const totalSlides = Math.max(1, getSeatSlides(selectedSeatForDetails, students).length);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && totalSlides > 1) {
        setSeatSwipeDir('right');
        setSeatSlideIndex((prev) => (prev > 0 ? prev - 1 : totalSlides - 1));
      } else if (e.key === 'ArrowRight' && totalSlides > 1) {
        setSeatSwipeDir('left');
        setSeatSlideIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : 0));
      } else if (e.key === 'Escape') {
        setSeatSwipeDir(null);
        setSelectedSeatForDetails(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSeatForDetails, shifts, students]);

  // Add/Edit Student Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [studentFormError, setStudentFormError] = useState<string | null>(null);
  const [studentForm, setStudentForm] = useState({
    name: '',
    phone: '',
    seat_number: '',
    shift: '',
    monthly_fee: 800,
    subscription_start: new Date().toISOString().split('T')[0],
    subscription_end: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    student_pin: '',
    notes: '',
  });

  // Dedicated Student Subscription Renewal Modal states
  const [renewStudentTarget, setRenewStudentTarget] = useState<Student | null>(null);
  const [renewFormError, setRenewFormError] = useState<string | null>(null);
  const [renewingStudent, setRenewingStudent] = useState(false);
  const [isRenewShiftMenuOpen, setIsRenewShiftMenuOpen] = useState(false);
  const [isRenewSeatPickerOpen, setIsRenewSeatPickerOpen] = useState(false);
  const [renewSuccessToast, setRenewSuccessToast] = useState<{
    studentName: string;
    validTill: string;
  } | null>(null);
  const [renewForm, setRenewForm] = useState({
    plan_months: 1,
    shift: '',
    seat_number: '',
    monthly_fee: 800,
    subscription_start: '',
    subscription_end: '',
    notes: '',
  });

  const loadData = async () => {
    if (!libraryId) {
      setLoading(false);
      setSyncError('Library ID is missing for this session. Please log out and sign in again.');
      return;
    }

    setLoading(true);
    setSyncError(null);
    try {
      const [libRes, studsRes, shiftsRes, bcastsRes, attRes, loginsRes] = await Promise.allSettled([
        dataService.getLibraryById(libraryId),
        dataService.getStudentsByLibrary(libraryId),
        dataService.getShiftsByLibrary(libraryId),
        dataService.getBroadcastRequestsByLibrary(libraryId),
        dataService.getAttendanceByLibrary(libraryId),
        dataService.getAllLogins(),
      ]);

      const lib = libRes.status === 'fulfilled' ? libRes.value : null;
      const studs = studsRes.status === 'fulfilled' ? studsRes.value : null;
      const customShifts = shiftsRes.status === 'fulfilled' ? shiftsRes.value : null;
      const bcasts = bcastsRes.status === 'fulfilled' ? bcastsRes.value : null;
      const attLogs = attRes.status === 'fulfilled' ? attRes.value : null;
      const allLogins = loginsRes.status === 'fulfilled' ? loginsRes.value : [];

      const safeAttLogs = attLogs ?? [];
      const activationDate = dataService.getLibraryActivationDate(libraryId, safeAttLogs);
      if (attLogs) {
        await dataService.purgePreActivationAbsentLogs(libraryId, activationDate).catch(() => {});
      }
      setLibraryActivationDate(activationDate);

      if (studs) {
        const pinMap: Record<string, string> = {};
        for (const st of studs) {
          if (isValidStudentPin(st.student_pin)) {
            pinMap[st.id] = st.student_pin!;
          }
        }
        for (const item of allLogins) {
          if (item.role === 'student' && item.reference_id && isValidStudentPin(item.code)) {
            pinMap[item.reference_id] = item.code;
          }
        }
        setStudentPinMap(pinMap);
        setStudents(studs);
      }
      allExistingPinsRef.current = allLogins.map((l) => l.code);

      if (lib) {
        setLibrary(lib);
        setSeatCapacityInput(lib.total_seats || 50);
      }
      if (customShifts) {
        setShifts(customShifts);
      }
      if (bcasts) {
        setBroadcastHistory(bcasts);
      }
      if (attLogs) {
        setAttendanceLogs(attLogs.filter((r) => r.date >= activationDate));
      }

      const syncErrors: string[] = [];
      if (libRes.status === 'rejected') {
        syncErrors.push(`Library: ${libRes.reason?.message || 'Failed to load'}`);
      }
      if (studsRes.status === 'rejected') {
        syncErrors.push(`Students: ${studsRes.reason?.message || 'Failed to load'}`);
      }
      if (shiftsRes.status === 'rejected') {
        const msg = shiftsRes.reason?.message || 'Failed to load shifts';
        const isMissing = /could not find the table|schema cache|does not exist|pgrst205|42p01/i.test(msg);
        const isRls = /row-level security|permission denied|42501/i.test(msg);
        syncErrors.push(
          isMissing
            ? `Supabase table "public.shifts" is missing (${msg}). Open DB Settings, copy the SQL Setup Script, and run it in your Supabase SQL Editor.`
            : isRls
            ? `Shifts blocked by Supabase RLS policy (${msg}). Open DB Settings and run the updated SQL Setup Script.`
            : `Shifts: ${msg}`
        );
      }
      if (syncErrors.length > 0) {
        setSyncError(syncErrors.join(' · '));
      }
    } catch (e: any) {
      console.error('Error loading library data:', e);
      setSyncError(e?.message || 'Unable to sync library data from Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const unsubscribeLibrary = dataService.subscribeToLibraryUpdates({
      libraryId,
      onUpdate: () => {
        void loadData();
      },
    });
    const unsubscribeStudents = dataService.subscribeToStudentUpdates({
      libraryId,
      onUpdate: () => {
        void loadData();
      },
    });
    const unsubscribeShifts = dataService.subscribeToShiftUpdates({
      libraryId,
      onUpdate: () => {
        void loadData();
      },
    });
    return () => {
      unsubscribeLibrary();
      unsubscribeStudents();
      unsubscribeShifts();
    };
  }, [libraryId]);

  const syncAttendanceAndAbsentLogs = async (showSpinner = false) => {
    if (showSpinner) setRefreshingAttendance(true);
    const now = new Date();
    const currentToday = getLocalDateKey(now);
    if (lastTodayKeyRef.current !== currentToday) {
      setAttendanceDailyDate((prev) =>
        prev === lastTodayKeyRef.current ? currentToday : prev
      );
      lastTodayKeyRef.current = currentToday;
    }

    try {
      const [rawLogs, fetchedShifts] = await Promise.all([
        dataService.getAttendanceByLibrary(libraryId),
        dataService.getShiftsByLibrary(libraryId).catch(() => shifts),
      ]);
      const activeShifts = fetchedShifts.length > 0 ? fetchedShifts : shifts;
      const activationDate = dataService.getLibraryActivationDate(libraryId, rawLogs);
      setLibraryActivationDate(activationDate);
      await dataService.purgePreActivationAbsentLogs(libraryId, activationDate);

      const validLogs = rawLogs.filter((r) => r.date >= activationDate);

      // Persist absent records for both past days AND today once the student's shift end time has passed
      const activeStudents = students.filter(
        (s) => s.is_active !== false && !isStudentExited(s)
      );
      if (activeStudents.length > 0) {
        const existingKeys = new Set(
          validLogs.map((r) => `${r.student_id}::${r.date}`)
        );
        const absentToPersist: AttendanceRecord[] = [];
        for (let offset = 0; offset <= 7; offset++) {
          const d = new Date(now);
          d.setDate(d.getDate() - offset);
          const dateStr = getLocalDateKey(d);
          if (dateStr < activationDate) continue;

          for (const stu of activeStudents) {
            if (stu.subscription_start && dateStr < stu.subscription_start) continue;
            if (stu.subscription_end && dateStr > stu.subscription_end) continue;

            const key = `${stu.id}::${dateStr}`;
            if (existingKeys.has(key)) continue;

            // On today (offset === 0), only auto-mark Absent after the shift's end time has passed
            if (offset === 0 && !hasShiftEndedForDate(stu.shift, dateStr, now, activeShifts)) {
              continue;
            }

            existingKeys.add(key);
            absentToPersist.push({
              id: `abs_${libraryId}_${stu.id}_${dateStr}`,
              library_id: libraryId,
              student_id: stu.id,
              student_name: stu.name,
              seat_number: normalizeSeatLabel(stu.seat_number),
              shift: stu.shift,
              date: dateStr,
              check_in_time: null,
              check_out_time: null,
              duration_minutes: null,
              status: 'absent',
              qr_payload: '',
              created_at:
                offset === 0 ? now.toISOString() : `${dateStr}T23:59:59.000Z`,
            });
          }
        }

        if (absentToPersist.length > 0) {
          await Promise.allSettled(
            absentToPersist.map((rec) => dataService.saveAttendanceRecord(rec))
          );
          const persistedIds = new Set(absentToPersist.map((r) => r.id));
          setAttendanceLogs([
            ...absentToPersist,
            ...validLogs.filter((r) => !persistedIds.has(r.id)),
          ]);
          return;
        }
      }

      setAttendanceLogs(validLogs);
    } catch (err) {
      console.warn('Attendance refresh skipped:', err);
    } finally {
      if (showSpinner) setRefreshingAttendance(false);
    }
  };

  // Real-time daily attendance refresh, SSE + Supabase Realtime stream, and midnight roll-over
  useEffect(() => {
    const triggerSync = () => {
      setAttendanceTick(Date.now());
      void syncAttendanceAndAbsentLogs(false);
    };

    if (ownerSection === 'attendance' || ownerSection === 'overview') {
      triggerSync();
    }

    const unsubscribeLive = dataService.subscribeToAttendanceUpdates({
      libraryId,
      onUpdate: triggerSync,
    });

    const pollIntervalMs = ownerSection === 'attendance' ? 6000 : 15000;
    const pollId = window.setInterval(triggerSync, pollIntervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        triggerSync();
      }
    };

    window.addEventListener('focus', triggerSync);
    window.addEventListener('storage', triggerSync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribeLive();
      window.clearInterval(pollId);
      window.removeEventListener('focus', triggerSync);
      window.removeEventListener('storage', triggerSync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ownerSection, libraryId, students, shifts]);

  // Dynamically generate Center-Badge Level-H QR DataURLs & sync Supabase references when viewing QR section
  useEffect(() => {
    if (ownerSection !== 'qrcodes') return;
    let cancelled = false;
    const cap = library?.total_seats || 50;
    const allLabels = buildCanonicalSeatLabels(
      cap,
      students.map((s) => s.seat_number)
    );
    const q = qrSearch.trim().toLowerCase();
    const filteredLabels = q
      ? allLabels.filter((label) => {
          return (
            label.toLowerCase().includes(q) ||
            label.replace('A-', '').toLowerCase() === q ||
            formatSeatBadgeNumber(label).toLowerCase() === q
          );
        })
      : allLabels;
    const perPage = isDesktop ? 12 : 8;
    const maxPage = Math.max(0, Math.ceil(filteredLabels.length / perPage) - 1);
    const safePage = Math.min(qrPage, maxPage);
    const slice = filteredLabels.slice(safePage * perPage, safePage * perPage + perPage);

    void dataService.getLibrarySeatRoster(libraryId, library).catch(() => null);

    void Promise.all(
      slice.map(async (label) => {
        const url = await generateSeatQrDataUrl(libraryId, label, 280);
        return [label, url] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setQrDataUrls((prev) => {
        const next = { ...prev };
        for (const [label, url] of entries) {
          next[label] = url;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [ownerSection, library, library?.total_seats, qrPage, qrSearch, libraryId, isDesktop, students]);

  // Real-time delivery status sync while viewing Broadcasts chat tab
  useEffect(() => {
    if (ownerSection !== 'broadcasts') {
      setIsMultiSelectMode(false);
      setSelectedBroadcastIds([]);
      if (bubbleLongPressTimerRef.current !== null) {
        window.clearTimeout(bubbleLongPressTimerRef.current);
        bubbleLongPressTimerRef.current = null;
      }
      return;
    }
    void refreshBroadcastHistory(false);

    const intervalId = window.setInterval(() => {
      void refreshBroadcastHistory(false);
    }, 6000);

    const onStorageOrFocus = () => {
      void refreshBroadcastHistory(false);
    };

    window.addEventListener('storage', onStorageOrFocus);
    window.addEventListener('focus', onStorageOrFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onStorageOrFocus);
      window.removeEventListener('focus', onStorageOrFocus);
      if (bubbleLongPressTimerRef.current !== null) {
        window.clearTimeout(bubbleLongPressTimerRef.current);
        bubbleLongPressTimerRef.current = null;
      }
    };
  }, [ownerSection, libraryId]);

  useEffect(() => {
    if (ownerSection === 'broadcasts') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [ownerSection, broadcastHistory.length]);

  // WhatsApp-style auto-expanding multiline composer height & scroll preservation
  useEffect(() => {
    if (ownerSection !== 'broadcasts') return;
    const el = broadcastTextareaRef.current;
    if (!el) return;

    const scroller = chatScrollContainerRef.current;
    const wasNearBottom = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96
      : false;

    el.style.height = 'auto';
    const maxHeight = 160;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(24, nextHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';

    if (wasNearBottom && scroller) {
      requestAnimationFrame(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'auto' });
      });
    }
  }, [broadcastMessage, ownerSection]);

  // Active students list (exited students are immediately removed from active view)
  const activeStudents = students.filter((s) => !isStudentExited(s));
  const isStudentRenewalDue = (s: Student) => calculateDaysRemaining(s.subscription_end) <= 2;
  const renewalDueStudents = activeStudents.filter(isStudentRenewalDue);

  // Filtered students for active roster & dedicated Renewals Due view
  const filteredStudents = activeStudents
    .filter((s) => {
      if (studentViewFilter === 'renewals' && !isStudentRenewalDue(s)) {
        return false;
      }

      const stPin = studentPinMap[s.id] || s.student_pin || '';
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.seat_number.toLowerCase().includes(q) ||
        s.phone.includes(searchQuery) ||
        stPin.toLowerCase().includes(q);

      const matchesShift =
        shiftFilter === 'all' || s.shift.toLowerCase().includes(shiftFilter.toLowerCase());
      return matchesSearch && matchesShift;
    })
    .sort((a, b) => {
      if (studentViewFilter === 'renewals') {
        return calculateDaysRemaining(a.subscription_end) - calculateDaysRemaining(b.subscription_end);
      }
      return 0;
    });

  // Dynamic Seat Capacity Handler
  const handleSaveSeatCapacity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!library) return;
    const newCap = Number(seatCapacityInput);
    if (!newCap || newCap < 1) {
      setSeatModalError('Please enter a valid seat capacity greater than 0.');
      return;
    }

    setSavingSeatCapacity(true);
    setSeatModalError(null);
    try {
      await dataService.updateLibrary({
        id: libraryId,
        total_seats: newCap,
      });
      setLibrary((prev) => (prev ? { ...prev, total_seats: newCap } : null));
      playSound('success');
      fireDuolingoConfetti();
      setShowSeatModal(false);
    } catch (err: any) {
      setSeatModalError(`Error updating seat capacity: ${err.message}`);
    } finally {
      setSavingSeatCapacity(false);
    }
  };

  // Custom Shifts Handlers
  const handleOpenAddShiftModal = () => {
    setEditingShift(null);
    setShiftFormError(null);
    setShiftForm({
      name: 'Morning Shift',
      timing: '07:00 AM - 01:00 PM',
      fee: 800,
    });
    setCustomStartTime('07:00 AM');
    setCustomEndTime('01:00 PM');
    setShowShiftModal(true);
  };

  const handleOpenEditShiftModal = (shift: Shift) => {
    setEditingShift(shift);
    setShiftFormError(null);
    setShiftForm({
      name: shift.name,
      timing: shift.timing,
      fee: Number(shift.fee) || 0,
    });
    const parts = shift.timing.split(' - ');
    if (parts.length === 2) {
      setCustomStartTime(parts[0].trim());
      setCustomEndTime(parts[1].trim());
    }
    setShowShiftModal(true);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftForm.name.trim() || !shiftForm.timing.trim()) return;
    if (!libraryId) {
      setShiftFormError('Library ID is missing. Please sign in again.');
      return;
    }

    setSavingShift(true);
    setShiftFormError(null);
    try {
      if (editingShift) {
        const updated: Shift = {
          ...editingShift,
          library_id: editingShift.library_id || libraryId,
          name: shiftForm.name.trim(),
          timing: shiftForm.timing.trim(),
          fee: Number(shiftForm.fee) || 0,
        };

        await dataService.updateShift(updated);
        const freshShifts = await dataService.getShiftsByLibrary(libraryId);
        setShifts(freshShifts);
        setShowShiftModal(false);
        playSound('success');
        fireDuolingoConfetti();
      } else {
        const newShiftId = `shift_${libraryId}_${Date.now()}`;
        const newShift: Shift = {
          id: newShiftId,
          library_id: libraryId,
          name: shiftForm.name.trim(),
          timing: shiftForm.timing.trim(),
          fee: Number(shiftForm.fee) || 0,
          is_active: true,
        };

        await dataService.createShift(newShift);
        const freshShifts = await dataService.getShiftsByLibrary(libraryId);
        setShifts(freshShifts);
        const newIdx = freshShifts.findIndex((s) => s.id === newShiftId);
        if (newIdx >= 0) {
          setCurrentSlideIndex(newIdx);
        } else {
          setCurrentSlideIndex(Math.max(0, freshShifts.length - 1));
        }
        setShowShiftModal(false);
        playSound('success');
        fireDuolingoConfetti();
      }
    } catch (err: any) {
      console.error('Error saving shift:', err);
      const rawMsg = err?.message || 'Failed to save shift to Supabase.';
      const isMissing = /could not find the table|schema cache|does not exist|pgrst205|42p01/i.test(rawMsg);
      const isRls = /row-level security|permission denied|42501/i.test(rawMsg);
      setShiftFormError(
        isMissing
          ? `Supabase table "public.shifts" is missing (${rawMsg}). Copy the SQL Setup Script from DB Settings and run it in your Supabase SQL Editor.`
          : isRls
          ? `Supabase RLS policy blocked saving this shift (${rawMsg}). Please run the updated SQL Setup Script in Supabase.`
          : rawMsg
      );
    } finally {
      setSavingShift(false);
    }
  };

  const handleInitiateDeleteShift = (shift: Shift) => {
    playSound('pop');
    setShiftDeleteError(null);
    setShiftToDelete(shift);
  };

  const handleConfirmDeleteShift = async () => {
    if (!shiftToDelete) return;
    setDeletingShift(true);
    setShiftDeleteError(null);

    try {
      const shiftId = shiftToDelete.id;
      await dataService.deleteShift(shiftId);
      const freshShifts = await dataService.getShiftsByLibrary(libraryId);
      setShifts(freshShifts);
      setCurrentSlideIndex((oldIdx) =>
        Math.max(0, Math.min(oldIdx, Math.max(0, freshShifts.length - 1)))
      );
      playSound('pop');
      setShiftToDelete(null);
    } catch (err: any) {
      console.error('Error deleting shift:', err);
      setShiftDeleteError(err?.message || 'Failed to delete shift from Supabase.');
    } finally {
      setDeletingShift(false);
    }
  };

  const getShiftFeeByString = (shiftString: string): number => {
    const matched = shifts.find((sh) => {
      const fullStr = `${sh.name} (${sh.timing})`;
      return (
        fullStr === shiftString ||
        shiftString.toLowerCase().includes(sh.name.toLowerCase())
      );
    });
    return matched ? Number(matched.fee) || 0 : 800;
  };

  // Student Assignment Handlers (Smart, Dynamic & Shift-Driven with Live DB Check)
  const handleShiftChange = async (newShift: string) => {
    playSound('pop');
    setIsShiftMenuOpen(false);
    const defaultFee = getShiftFeeByString(newShift);

    // Immediate local update
    const localFreeSeats = getAvailableSeatsForShift(newShift, editingStudent?.id, students);
    const normalizedCurrent = normalizeSeatLabel(studentForm.seat_number);
    const initialNextSeat = localFreeSeats.includes(normalizedCurrent)
      ? normalizedCurrent
      : localFreeSeats[0] || '';

    setStudentForm((prev) => ({
      ...prev,
      shift: newShift,
      seat_number: initialNextSeat,
      monthly_fee: defaultFee,
    }));

    // Live query from database for strict shift-wise seat filtering
    setCheckingSeatAvailability(true);
    try {
      const latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
      const verifiedFreeSeats = getAvailableSeatsForShift(newShift, editingStudent?.id, latestStudents);
      setStudentForm((prev) => {
        const curNorm = normalizeSeatLabel(prev.seat_number);
        const verifiedSeat = verifiedFreeSeats.includes(curNorm)
          ? curNorm
          : verifiedFreeSeats[0] || '';
        return {
          ...prev,
          seat_number: verifiedSeat,
        };
      });
    } catch (err) {
      console.warn('Error refreshing seat availability from database:', err);
    } finally {
      setCheckingSeatAvailability(false);
    }
  };

  const handleOpenAddModal = async (presetSeat?: string, presetShift?: string) => {
    setEditingStudent(null);
    setStudentFormError(null);
    setIsShiftMenuOpen(false);
    setIsSeatPickerOpen(false);
    let chosenShift =
      presetShift ||
      (shifts.length > 0 ? `${shifts[0].name} (${shifts[0].timing})` : 'General Shift (Full Day)');
    let chosenSeat = presetSeat ? normalizeSeatLabel(presetSeat) : '';

    if (presetSeat && !presetShift) {
      const freeShift = shifts.find((sh) => {
        const shiftStr = `${sh.name} (${sh.timing})`;
        return !getSeatOccupancyInShift(chosenSeat, shiftStr, undefined, students).isOccupied;
      });
      if (freeShift) {
        chosenShift = `${freeShift.name} (${freeShift.timing})`;
      }
    } else if (!presetSeat) {
      const freeSeats = getAvailableSeatsForShift(chosenShift, undefined, students);
      if (freeSeats.length > 0) {
        chosenSeat = freeSeats[0];
      }
    }

    setStudentForm({
      name: '',
      phone: '',
      seat_number: chosenSeat,
      shift: chosenShift,
      monthly_fee: getShiftFeeByString(chosenShift),
      subscription_start: new Date().toISOString().split('T')[0],
      subscription_end: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      student_pin: '',
      notes: '',
    });
    setShowAddModal(true);

    // Sync live students from DB so newly assigned/removed seats are strictly filtered
    setCheckingSeatAvailability(true);
    try {
      const latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
      const verifiedFreeSeats = getAvailableSeatsForShift(chosenShift, undefined, latestStudents);
      setStudentForm((prev) => {
        if (presetSeat && verifiedFreeSeats.includes(normalizeSeatLabel(presetSeat))) {
          return prev;
        }
        const curNorm = normalizeSeatLabel(prev.seat_number);
        if (verifiedFreeSeats.includes(curNorm)) return prev;
        return {
          ...prev,
          seat_number: verifiedFreeSeats[0] || '',
        };
      });
    } catch (err) {
      console.warn('Error fetching live seat occupancy:', err);
    } finally {
      setCheckingSeatAvailability(false);
    }
  };

  const handleEditClick = (student: Student) => {
    setEditingStudent(student);
    setStudentFormError(null);
    setIsShiftMenuOpen(false);
    setIsSeatPickerOpen(false);

    const rawNotes = student.notes || '';
    const feeMatch = rawNotes.match(/Fee:\s*₹(\d+)/i);
    const parsedFee = feeMatch ? Number(feeMatch[1]) : getShiftFeeByString(student.shift);
    const cleanNotes = stripSystemNoteTags(rawNotes);

    setStudentForm({
      name: student.name,
      phone: student.phone,
      seat_number: student.seat_number,
      shift: student.shift,
      monthly_fee: parsedFee,
      subscription_start: student.subscription_start,
      subscription_end: student.subscription_end,
      student_pin: studentPinMap[student.id] || '',
      notes: cleanNotes,
    });
    setShowAddModal(true);
  };

  const applyDurationMonths = (months: number) => {
    const startStr = studentForm.subscription_start || new Date().toISOString().split('T')[0];
    const startDate = new Date(startStr);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + months * 30);
    setStudentForm((prev) => ({
      ...prev,
      subscription_end: endDate.toISOString().split('T')[0],
    }));
    playSound('pop');
  };

  const generateRandomStudentPin = () => {
    const pin = pickAvailableFourDigitPin(allExistingPinsRef.current);
    setStudentForm((prev) => ({
      ...prev,
      student_pin: pin,
    }));
    playSound('pop');
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentFormError(null);

    if (!studentForm.name.trim()) {
      setStudentFormError('Please enter the student\'s full name.');
      return;
    }
    if (!studentForm.phone.trim()) {
      setStudentFormError('Please enter a valid WhatsApp contact number.');
      return;
    }
    if (!studentForm.shift.trim()) {
      setStudentFormError('Please select an assigned shift.');
      return;
    }
    if (!studentForm.seat_number.trim()) {
      setStudentFormError('Please choose an available seat for this shift.');
      return;
    }

    const cleanSeat = normalizeSeatLabel(studentForm.seat_number);
    const cleanPhone = studentForm.phone.trim().replace(/[^0-9]/g, '');

    // Query latest students from DB and strictly prevent double-booking on the chosen shift
    let latestStudents = students;
    try {
      latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
    } catch {
      // fallback to local state
    }

    const occupancy = getSeatOccupancyInShift(cleanSeat, studentForm.shift, editingStudent?.id, latestStudents);
    if (occupancy.isOccupied) {
      setStudentFormError(`Seat ${cleanSeat} is already occupied by ${occupancy.occupantName} in ${occupancy.occupantShift}. Please select another vacant seat.`);
      return;
    }

    const nowLocal = new Date();
    const todayStr = [
      nowLocal.getFullYear(),
      String(nowLocal.getMonth() + 1).padStart(2, '0'),
      String(nowLocal.getDate()).padStart(2, '0'),
    ].join('-');
    const trimmedNotes = studentForm.notes.trim();
    const feeVal = Math.max(0, Number(studentForm.monthly_fee) || 0);
    const baseComposedNotes = trimmedNotes ? `${trimmedNotes} · Fee: ₹${feeVal}` : `Fee: ₹${feeVal}`;

    const trimmedPin = studentForm.student_pin.trim();

    if (editingStudent) {
      const existingPin = studentPinMap[editingStudent.id] || '';
      const pinChanged = trimmedPin !== existingPin;
      let nextPinToSave: string | null = null;

      if (pinChanged) {
        if (!trimmedPin && !existingPin) {
          nextPinToSave = await dataService.generateUniqueStudentPin();
        } else if (!isValidStudentPin(trimmedPin)) {
          setStudentFormError('Student Pin must be a 4-digit numeric PIN between 1000 and 9999.');
          return;
        } else {
          nextPinToSave = trimmedPin;
        }
      } else if (!existingPin || !isValidStudentPin(existingPin)) {
        nextPinToSave = await dataService.generateUniqueStudentPin();
      }

      const isRenewalExtended =
        Boolean(studentForm.subscription_end) &&
        Boolean(editingStudent.subscription_end) &&
        studentForm.subscription_end > editingStudent.subscription_end;

      const existingSystemTags = (
        (editingStudent.notes || '').match(
          /\[(?:JOINED(?::[^\]]*)?|JOIN_ACK|JOIN_SENT|RENEWED(?::[^\]]*)?|RENEW_ACK|RENEW_SENT|EXPIRING_ACK(?::[^\]]*)?|EXPIRING_SENT(?::[^\]]*)?)\]/gi
        ) || []
      ).filter((tag) => {
        if (isRenewalExtended) {
          return !/^\[(?:RENEWED|RENEW_ACK|RENEW_SENT|EXPIRING_ACK|EXPIRING_SENT)/i.test(tag);
        }
        return true;
      });

      if (isRenewalExtended) {
        existingSystemTags.push(`[RENEWED:${todayStr}]`);
      }

      const finalEditNotes = [baseComposedNotes, ...existingSystemTags].filter(Boolean).join(' ');

      try {
        if (nextPinToSave) {
          await dataService.updateStudentPin(editingStudent.id, nextPinToSave);
        }
        await dataService.updateStudent({
          id: editingStudent.id,
          name: studentForm.name.trim(),
          phone: cleanPhone,
          seat_number: cleanSeat,
          shift: studentForm.shift,
          subscription_start: studentForm.subscription_start,
          subscription_end: studentForm.subscription_end,
          notes: finalEditNotes,
        });
        playSound('success');
        setShowAddModal(false);
        loadData();
      } catch (err: any) {
        setStudentFormError(`Error updating student: ${err.message}`);
      }
    } else {
      if (trimmedPin && !isValidStudentPin(trimmedPin)) {
        setStudentFormError('Student Pin must be a 4-digit numeric PIN between 1000 and 9999.');
        return;
      }

      const studentId = 'stu_' + Math.random().toString(36).substring(2, 9);
      const generatedPin = trimmedPin || (await dataService.generateUniqueStudentPin());

      const finalNewNotes = `${baseComposedNotes} [JOINED:${todayStr}]`;

      const newStudent: Student = {
        id: studentId,
        library_id: libraryId,
        name: studentForm.name.trim(),
        phone: cleanPhone,
        seat_number: cleanSeat,
        shift: studentForm.shift,
        subscription_start: studentForm.subscription_start,
        subscription_end: studentForm.subscription_end,
        is_active: true,
        notes: finalNewNotes,
      };

      try {
        await dataService.createStudent(newStudent, generatedPin);
        playSound('success');
        fireDuolingoConfetti();
        setShowAddModal(false);
        loadData();
      } catch (err: any) {
        setStudentFormError(`Error adding student: ${err.message}`);
      }
    }
  };

  const computeRenewalDates = (student: Student, months: number) => {
    const today = new Date();
    const todayStr = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const currentEnd = student.subscription_end || todayStr;
    const isStillActiveOrToday = currentEnd >= todayStr;
    const baseStr = isStillActiveOrToday ? currentEnd : todayStr;
    const [y, m, d] = baseStr.split('-').map((n) => parseInt(n, 10));
    const baseDate = y && m && d ? new Date(y, m - 1, d) : new Date();
    baseDate.setDate(baseDate.getDate() + months * 30);
    const nextEndStr = [
      baseDate.getFullYear(),
      String(baseDate.getMonth() + 1).padStart(2, '0'),
      String(baseDate.getDate()).padStart(2, '0'),
    ].join('-');
    const nextStartStr = isStillActiveOrToday ? (student.subscription_start || todayStr) : todayStr;
    return { nextStartStr, nextEndStr };
  };

  const handleOpenRenewModal = async (student: Student) => {
    playSound('pop');
    setRenewStudentTarget(student);
    setRenewFormError(null);
    setIsRenewShiftMenuOpen(false);
    setIsRenewSeatPickerOpen(false);

    const rawNotes = student.notes || '';
    const feeMatch = rawNotes.match(/Fee:\s*₹(\d+)/i);
    const parsedFee = feeMatch ? Number(feeMatch[1]) : getShiftFeeByString(student.shift);
    const cleanNotes = stripSystemNoteTags(rawNotes);
    const { nextStartStr, nextEndStr } = computeRenewalDates(student, 1);

    setRenewForm({
      plan_months: 1,
      shift: student.shift,
      seat_number: normalizeSeatLabel(student.seat_number),
      monthly_fee: parsedFee,
      subscription_start: nextStartStr,
      subscription_end: nextEndStr,
      notes: cleanNotes,
    });

    // Live refresh so shift/seat switching checks latest occupancy
    setCheckingSeatAvailability(true);
    try {
      const latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
    } catch (err) {
      console.warn('Error refreshing seat availability for renewal:', err);
    } finally {
      setCheckingSeatAvailability(false);
    }
  };

  const handleRenewShiftChange = async (newShift: string) => {
    if (!renewStudentTarget) return;
    playSound('pop');
    setIsRenewShiftMenuOpen(false);
    setRenewFormError(null);

    const nextFee = getShiftFeeByString(newShift);
    const localFreeSeats = getAvailableSeatsForShift(newShift, renewStudentTarget.id, students);
    const currentSeatNorm = normalizeSeatLabel(renewForm.seat_number);
    const initialNextSeat = localFreeSeats.includes(currentSeatNorm)
      ? currentSeatNorm
      : localFreeSeats[0] || '';

    setRenewForm((prev) => ({
      ...prev,
      shift: newShift,
      seat_number: initialNextSeat,
      monthly_fee: nextFee > 0 ? nextFee : prev.monthly_fee,
    }));

    setCheckingSeatAvailability(true);
    try {
      const latestStudents = await dataService.getStudentsByLibrary(libraryId);
      setStudents(latestStudents);
      const verifiedFreeSeats = getAvailableSeatsForShift(newShift, renewStudentTarget.id, latestStudents);
      setRenewForm((prev) => {
        const curNorm = normalizeSeatLabel(prev.seat_number);
        const verifiedSeat = verifiedFreeSeats.includes(curNorm)
          ? curNorm
          : verifiedFreeSeats[0] || '';
        return {
          ...prev,
          seat_number: verifiedSeat,
        };
      });
    } catch (err) {
      console.warn('Error refreshing seat availability during renewal shift switch:', err);
    } finally {
      setCheckingSeatAvailability(false);
    }
  };

  const applyRenewDurationMonths = (months: number) => {
    if (!renewStudentTarget) return;
    const { nextStartStr, nextEndStr } = computeRenewalDates(renewStudentTarget, months);
    setRenewForm((prev) => ({
      ...prev,
      plan_months: months,
      subscription_start: nextStartStr,
      subscription_end: nextEndStr,
    }));
    playSound('pop');
  };

  const handleConfirmRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewStudentTarget) return;
    setRenewFormError(null);

    if (!renewForm.shift.trim()) {
      setRenewFormError('Please select a shift for this renewal.');
      return;
    }
    if (!renewForm.seat_number.trim()) {
      setRenewFormError('Please select an available seat for the chosen shift.');
      return;
    }
    if (!renewForm.subscription_end) {
      setRenewFormError('Please set a valid renewal expiry date.');
      return;
    }

    const cleanSeat = normalizeSeatLabel(renewForm.seat_number);
    setRenewingStudent(true);

    try {
      let latestStudents = students;
      try {
        latestStudents = await dataService.getStudentsByLibrary(libraryId);
        setStudents(latestStudents);
      } catch {
        // fallback to local list
      }

      const occupancy = getSeatOccupancyInShift(
        cleanSeat,
        renewForm.shift,
        renewStudentTarget.id,
        latestStudents
      );
      if (occupancy.isOccupied) {
        setRenewFormError(
          `Seat ${cleanSeat} is already occupied by ${occupancy.occupantName} in ${occupancy.occupantShift}. Please pick another vacant seat.`
        );
        setRenewingStudent(false);
        return;
      }

      const today = new Date();
      const todayStr = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');
      const trimmedNotes = renewForm.notes.trim();
      const feeVal = Math.max(0, Number(renewForm.monthly_fee) || 0);
      const baseComposedNotes = trimmedNotes ? `${trimmedNotes} · Fee: ₹${feeVal}` : `Fee: ₹${feeVal}`;

      const preservedSystemTags = (
        (renewStudentTarget.notes || '').match(/\[(?:JOINED(?::[^\]]*)?|JOIN_ACK|JOIN_SENT)\]/gi) || []
      );
      const finalRenewNotes = [baseComposedNotes, ...preservedSystemTags, `[RENEWED:${todayStr}]`]
        .filter(Boolean)
        .join(' ');

      await dataService.updateStudent({
        id: renewStudentTarget.id,
        seat_number: cleanSeat,
        shift: renewForm.shift,
        subscription_start: renewForm.subscription_start,
        subscription_end: renewForm.subscription_end,
        is_active: true,
        notes: finalRenewNotes,
      });

      const renewedName = renewStudentTarget.name;
      const renewedTill = renewForm.subscription_end;
      playSound('success');
      fireDuolingoConfetti();
      setRenewStudentTarget(null);
      setRenewSuccessToast({ studentName: renewedName, validTill: renewedTill });
      loadData();
    } catch (err: any) {
      setRenewFormError(`Error renewing subscription: ${err.message}`);
    } finally {
      setRenewingStudent(false);
    }
  };

  useEffect(() => {
    if (!renewSuccessToast) return;
    const timer = window.setTimeout(() => setRenewSuccessToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [renewSuccessToast]);

  useEffect(() => {
    if (!exitSuccessToast) return;
    const timer = window.setTimeout(() => setExitSuccessToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [exitSuccessToast]);

  const handleExitStudentClick = (student: Student) => {
    playSound('pop');
    setExitStudentError(null);
    setStudentToExit(student);
  };

  const handleConfirmExitStudent = async () => {
    if (!studentToExit) return;
    setExitingStudent(true);
    setExitStudentError(null);
    try {
      const target = studentToExit;
      const exitedStudent = await dataService.exitStudent(target);
      setStudents((prev) =>
        prev.map((s) => (s.id === target.id ? exitedStudent : s))
      );
      playSound('pop');
      setStudentToExit(null);
      setExitSuccessToast({
        studentName: target.name,
        seatNumber: target.seat_number,
      });
      await loadData();
    } catch (err: any) {
      setExitStudentError(
        err?.message || 'Could not vacate seat right now. Please try again.'
      );
    } finally {
      setExitingStudent(false);
    }
  };

  // Stats calculation (only active students occupy seats)
  const occupiedSeats = activeStudents.length;
  const availableSeats = Math.max(0, totalSeats - occupiedSeats);
  const occupancyPercent = totalSeats > 0 ? Math.min(100, Math.round((occupiedSeats / totalSeats) * 100)) : 0;

  const handleSwitchSection = (sec: OwnerNavSection) => {
    if (sec !== ownerSection) {
      playSound('pop');
      setOwnerSection(sec);
    }
  };

  // Pagination calculation for zero-scroll single-screen rendering
  const STUDENTS_PER_PAGE = isDesktop ? 7 : 6;
  const totalStudentPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE));
  const safeStudentPage = Math.min(studentPage, totalStudentPages - 1);
  const visibleStudents = filteredStudents.slice(
    safeStudentPage * STUDENTS_PER_PAGE,
    safeStudentPage * STUDENTS_PER_PAGE + STUDENTS_PER_PAGE
  );

  const SEATS_PER_PAGE = 20;
  const totalSeatPages = Math.max(1, Math.ceil(totalSeats / SEATS_PER_PAGE));
  const safeSeatPage = Math.min(seatPage, totalSeatPages - 1);
  const seatStartIndex = safeSeatPage * SEATS_PER_PAGE;
  const seatSliceCount = Math.min(SEATS_PER_PAGE, Math.max(0, totalSeats - seatStartIndex));

  const visibleBroadcastHistory = broadcastHistory.filter((b) =>
    isWithinBroadcastRetention(b.created_at)
  );
  const pendingBroadcastsCount = visibleBroadcastHistory.filter(
    (b) => b.status === 'pending'
  ).length;

  const navTabs: { id: OwnerNavSection; label: string; icon: React.ComponentType<any>; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'students', label: 'Students', icon: Users },
    { id: 'seatmap', label: 'Seat Map', icon: Grid3X3 },
    { id: 'shifts', label: 'Shifts', icon: Clock },
    { id: 'broadcasts', label: 'Broadcasts', icon: MessageSquare, badge: pendingBroadcastsCount },
  ];

  const isLibraryInactive = library && (library.subscription_status || '').toLowerCase() !== 'active';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* SINGLE-SCREEN CONTENT STAGE */}
      <div className="flex-1 min-h-0 overflow-hidden max-w-5xl w-full mx-auto px-3 sm:px-6 py-2 sm:py-4 flex flex-col justify-between gap-2">
        
        {/* TAB 1: ZERO-SCROLL SINGLE-SCREEN OVERVIEW */}
        {ownerSection === 'overview' && (() => {
          const todayStr = getLocalDateKey();
          const todayLogs = attendanceLogs.filter((r) => r.date === todayStr);
          const seatedNowCount = todayLogs.filter((r) => r.status === 'checked_in').length;
          const checkedInTodayTotal = todayLogs.filter((r) => r.status !== 'absent').length;
          const renewalsDueCount = renewalDueStudents.length;

          return (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-2 sm:gap-3">
              {/* 1. Compact Single-Line Header */}
              <div className="bg-white px-3 py-2 sm:px-4 sm:py-2.5 duo-card flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#1cb0f6] text-white flex items-center justify-center border-b-2 border-[#1899d6] shrink-0">
                    <Building2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="font-display text-sm sm:text-lg font-black text-[#3c3c3c] truncate leading-tight">
                      {library?.name || 'Owner Dashboard'}
                    </h1>
                    <p className="text-[10px] sm:text-xs font-semibold text-slate-500 truncate leading-tight">
                      {library?.location || 'Branch'} <span aria-hidden="true">·</span>{' '}
                      <span className="font-mono">{ownerCode}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSeatCapacityInput(library?.total_seats || 50);
                      setShowSeatModal(true);
                    }}
                    className="px-2.5 py-1.5 rounded-xl duo-btn-white text-slate-700 cursor-pointer min-h-[34px] flex items-center gap-1 text-[11px] font-black whitespace-nowrap"
                    title="Edit Seat Capacity"
                  >
                    <Pencil className="w-3 h-3 text-[#1cb0f6]" />
                    <span className="tabular-nums">{totalSeats} Seats</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      loadData();
                      playSound('pop');
                    }}
                    className="w-[34px] h-[34px] rounded-xl duo-btn-white text-slate-700 cursor-pointer flex items-center justify-center shrink-0"
                    title="Sync Data"
                    aria-label="Sync library data"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {isLibraryInactive && (
                <div className="px-2.5 py-1.5 rounded-xl bg-red-100 border border-red-300 text-red-800 text-[11px] font-bold flex items-center gap-1.5 shrink-0">
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span className="truncate">Subscription inactive. Contact administrator to renew.</span>
                </div>
              )}

              {syncError && (
                <div className="px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-bold flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="truncate">{syncError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadData()}
                    className="px-2 py-0.5 rounded-lg bg-amber-200/80 hover:bg-amber-200 text-amber-950 font-black shrink-0 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* 2. Sleek Space-Saving 4-Metric Summary Card */}
              <div className="bg-white px-2.5 py-2.5 sm:px-4 sm:py-3 duo-card shrink-0 space-y-2">
                <div className="grid grid-cols-4 divide-x divide-slate-100 text-center sm:text-left">
                  <button
                    type="button"
                    onClick={() => handleSwitchSection('seatmap')}
                    className="px-1 sm:pr-3 cursor-pointer flex flex-col justify-center items-center sm:items-start"
                  >
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 truncate max-w-full">
                      Occupancy
                    </span>
                    <span className="font-display text-base sm:text-2xl font-black text-[#1899d6] tabular-nums leading-tight">
                      {occupancyPercent}%
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStudentViewFilter('all');
                      setStudentPage(0);
                      handleSwitchSection('students');
                    }}
                    className="px-1 sm:px-3 cursor-pointer flex flex-col justify-center items-center sm:items-start"
                  >
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 truncate max-w-full">
                      Students
                    </span>
                    <span className="font-display text-base sm:text-2xl font-black text-[#3c3c3c] tabular-nums leading-tight">
                      {activeStudents.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSwitchSection('seatmap')}
                    className="px-1 sm:px-3 cursor-pointer flex flex-col justify-center items-center sm:items-start"
                  >
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 truncate max-w-full">
                      Open Seats
                    </span>
                    <span className="font-display text-base sm:text-2xl font-black text-[#46a302] tabular-nums leading-tight">
                      {availableSeats}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setShowShiftSliderModal(true);
                    }}
                    className="px-1 sm:pl-3 cursor-pointer flex flex-col justify-center items-center sm:items-start"
                  >
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 truncate max-w-full">
                      Shifts
                    </span>
                    <span className="font-display text-base sm:text-2xl font-black text-[#a855f7] tabular-nums leading-tight">
                      {shifts.length}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#1cb0f6] rounded-full transition-all duration-500"
                      style={{ width: `${occupancyPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 tabular-nums shrink-0">
                    {occupiedSeats}/{totalSeats} desks
                  </span>
                </div>
              </div>

              {/* 3. Zero-Scroll 2x2 Color-Coded Core Action Buttons */}
              <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-2.5 sm:gap-3.5 max-h-[420px] my-auto">
                {/* BUTTON 1: + ADD (BLUE THEME) */}
                <button
                  type="button"
                  onClick={() => handleOpenAddModal()}
                  className="relative p-3 sm:p-5 rounded-2xl bg-[#1cb0f6] hover:bg-[#35bbf8] border-2 border-[#1899d6] border-b-4 text-white flex flex-col justify-between text-left cursor-pointer transition-all active:translate-y-[2px] min-h-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                      <Plus className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3]" />
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-[10px] sm:text-xs font-black tabular-nums whitespace-nowrap">
                      {availableSeats} free
                    </span>
                  </div>

                  <div className="min-w-0 w-full mt-1">
                    <div className="font-display text-base sm:text-xl font-black text-white leading-tight truncate">
                      + Add
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-white/90 truncate mt-0.5">
                      Assign seat &amp; student
                    </p>
                  </div>
                </button>

                {/* BUTTON 2: ATTENDANCE (GREEN THEME + LIVE CHECK-IN BADGE) */}
                <button
                  type="button"
                  onClick={() => handleSwitchSection('attendance')}
                  className="relative p-3 sm:p-5 rounded-2xl bg-[#58cc02] hover:bg-[#61e002] border-2 border-[#46a302] border-b-4 text-white flex flex-col justify-between text-left cursor-pointer transition-all active:translate-y-[2px] min-h-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                      <QrCode className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span
                      aria-label={`${seatedNowCount} live check-ins`}
                      className="min-w-[28px] h-7 px-2 rounded-full bg-white text-[#46a302] text-xs sm:text-sm font-black flex items-center justify-center tabular-nums shadow-xs shrink-0"
                    >
                      {seatedNowCount}
                    </span>
                  </div>

                  <div className="min-w-0 w-full mt-1">
                    <div className="font-display text-base sm:text-xl font-black text-white leading-tight truncate">
                      Attendance
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-white/90 truncate mt-0.5 tabular-nums">
                      {checkedInTodayTotal} today · {totalSeats} QRs
                    </p>
                  </div>
                </button>

                {/* BUTTON 3: MESSAGE (ORANGE THEME) */}
                <button
                  type="button"
                  onClick={() => handleSwitchSection('broadcasts')}
                  className="relative p-3 sm:p-5 rounded-2xl bg-[#ff9600] hover:bg-[#ffa51f] border-2 border-[#e08500] border-b-4 text-white flex flex-col justify-between text-left cursor-pointer transition-all active:translate-y-[2px] min-h-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                      <Megaphone className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    {pendingBroadcastsCount > 0 ? (
                      <span
                        aria-label={`${pendingBroadcastsCount} pending notices`}
                        className="min-w-[28px] h-7 px-2 rounded-full bg-white text-[#e08500] text-xs sm:text-sm font-black flex items-center justify-center tabular-nums shadow-xs shrink-0"
                      >
                        {pendingBroadcastsCount}
                      </span>
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <Send className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 w-full mt-1">
                    <div className="font-display text-base sm:text-xl font-black text-white leading-tight truncate">
                      Message
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-white/90 truncate mt-0.5">
                      Broadcast quick notice
                    </p>
                  </div>
                </button>

                {/* BUTTON 4: RENEW (RED THEME + PENDING RENEWALS BADGE) */}
                <button
                  type="button"
                  onClick={() => {
                    setStudentViewFilter('renewals');
                    setStudentPage(0);
                    handleSwitchSection('students');
                  }}
                  className="relative p-3 sm:p-5 rounded-2xl bg-[#ff4b4b] hover:bg-[#ff5e5e] border-2 border-[#dc2626] border-b-4 text-white flex flex-col justify-between text-left cursor-pointer transition-all active:translate-y-[2px] min-h-0 overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                      <Calendar className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span
                      aria-label={`${renewalsDueCount} pending renewals`}
                      className="min-w-[28px] h-7 px-2 rounded-full bg-white text-[#dc2626] text-xs sm:text-sm font-black flex items-center justify-center tabular-nums shadow-xs shrink-0"
                    >
                      {renewalsDueCount}
                    </span>
                  </div>

                  <div className="min-w-0 w-full mt-1">
                    <div className="font-display text-base sm:text-xl font-black text-white leading-tight truncate">
                      Renew
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-white/90 truncate mt-0.5 tabular-nums">
                      {renewalsDueCount > 0
                        ? `${renewalsDueCount} renewal${renewalsDueCount === 1 ? '' : 's'} due`
                        : 'All plans active'}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          );
        })()}

        {/* TAB 2: STUDENTS ROSTER (All Students vs Dedicated Renewals Due Tab) */}
        {ownerSection === 'students' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2">
            {/* Compact Top View Switcher + Search & Shift Filter Bar */}
            <div className="bg-white p-2.5 duo-card flex flex-col gap-2 shrink-0">
              {/* Segmented Filter Tabs: All Students vs Renewals Due */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setStudentViewFilter('all');
                    setStudentPage(0);
                  }}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap min-h-[36px] ${
                    studentViewFilter === 'all'
                      ? 'bg-white text-[#3c3c3c] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>All Students</span>
                  <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                    ({activeStudents.length})
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setStudentViewFilter('renewals');
                    setStudentPage(0);
                  }}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap min-h-[36px] ${
                    studentViewFilter === 'renewals'
                      ? 'bg-[#ff9600] text-white shadow-xs'
                      : renewalDueStudents.length > 0
                      ? 'text-amber-700 hover:bg-amber-50'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                  <span>Renewals Due</span>
                  <span
                    className={`text-[11px] font-black tabular-nums ${
                      studentViewFilter === 'renewals'
                        ? 'text-white/90'
                        : renewalDueStudents.length > 0
                        ? 'text-amber-700'
                        : 'text-slate-400'
                    }`}
                  >
                    ({renewalDueStudents.length})
                  </span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder={
                      studentViewFilter === 'renewals'
                        ? 'Search expiring or expired student...'
                        : 'Search student, seat, phone, pin...'
                    }
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setStudentPage(0);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden text-xs font-bold bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenAddModal()}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1 cursor-pointer uppercase shrink-0 min-h-[36px]"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Add</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setShowShiftFilterModal(true);
                }}
                className={`w-full px-3 py-1.5 rounded-xl border-2 text-xs font-bold flex items-center justify-between gap-2 cursor-pointer transition-colors min-h-[36px] ${
                  shiftFilter !== 'all'
                    ? 'border-[#15803d]/40 bg-emerald-50/70 text-[#14532d]'
                    : 'border-[#e5e5e5] hover:border-slate-300 bg-slate-50 text-slate-700'
                }`}
                aria-haspopup="dialog"
                aria-expanded={showShiftFilterModal}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Layers
                    className={`w-3.5 h-3.5 shrink-0 ${
                      shiftFilter !== 'all' ? 'text-[#15803d]' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate tabular-nums">
                    {shiftFilter === 'all'
                      ? studentViewFilter === 'renewals'
                        ? `All Shifts (${renewalDueStudents.length} Due)`
                        : `All Shifts (${activeStudents.length} Students)`
                      : (() => {
                          const selectedShift = shifts.find((sh) => sh.name === shiftFilter);
                          const pool =
                            studentViewFilter === 'renewals' ? renewalDueStudents : activeStudents;
                          const count = pool.filter((s) =>
                            s.shift.toLowerCase().includes(shiftFilter.toLowerCase())
                          ).length;
                          return selectedShift
                            ? `${selectedShift.name} · ${selectedShift.timing} (${count})`
                            : `${shiftFilter} (${count})`;
                        })()}
                  </span>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            </div>

            {/* High-Density Compact Student Rows */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {filteredStudents.length === 0 ? (
                <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                  {studentViewFilter === 'renewals' && renewalDueStudents.length === 0 ? (
                    <>
                      <CheckCircle2 className="w-11 h-11 text-[#58cc02] mb-2" />
                      <h3 className="font-display text-base font-black text-[#3c3c3c]">
                        All Subscriptions Up to Date!
                      </h3>
                      <p className="text-xs font-medium text-slate-500 mt-1 mb-4 max-w-xs">
                        No students are expired or expiring within the next 2 days.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setStudentViewFilter('all');
                          setStudentPage(0);
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white text-[#3c3c3c] cursor-pointer uppercase"
                      >
                        View All Students
                      </button>
                    </>
                  ) : (
                    <>
                      <MascotOwl mood="studying" size={68} className="mb-2" />
                      <h3 className="font-display text-base font-black text-[#3c3c3c]">
                        {activeStudents.length === 0 ? 'No Students Enrolled' : 'No Matching Students'}
                      </h3>
                      <p className="text-xs font-medium text-slate-500 mt-1 mb-4 max-w-xs">
                        {activeStudents.length === 0
                          ? 'Assign your first seat to get started.'
                          : 'Adjust your search or shift filter.'}
                      </p>
                      {activeStudents.length === 0 && (
                        <button
                          type="button"
                          onClick={() => handleOpenAddModal()}
                          className="px-5 py-2.5 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase"
                        >
                          Assign First Seat
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                  {/* Slim Table Column Header */}
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                    <span>
                      {studentViewFilter === 'renewals'
                        ? `Renewals Due (${filteredStudents.length})`
                        : `Student (${filteredStudents.length})`}
                    </span>
                    <span>Actions</span>
                  </div>

                  {/* Streamlined Compact Rows */}
                  <div className="divide-y divide-slate-100 flex-1 min-h-0 overflow-y-auto">
                    {visibleStudents.map((st) => {
                      const daysLeft = calculateDaysRemaining(st.subscription_end);
                      const isExpiring = daysLeft >= 0 && daysLeft <= 2;
                      const isExp = daysLeft < 0;
                      const blankWaUrl = generateWhatsAppBlankChatUrl(st.phone);
                      const callUrl = generatePhoneCallUrl(st.phone);

                      return (
                        <div
                          key={st.id}
                          className="px-3 sm:px-3.5 py-2 flex items-center justify-between gap-2 hover:bg-slate-50/70 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              studentViewFilter === 'renewals'
                                ? void handleOpenRenewModal(st)
                                : handleEditClick(st)
                            }
                            className="min-w-0 flex-1 text-left cursor-pointer group"
                          >
                            <div className="font-display text-xs sm:text-sm font-black text-[#3c3c3c] group-hover:text-[#1899d6] truncate leading-tight">
                              {st.name}
                            </div>
                            <div className="text-[10px] sm:text-[11px] font-semibold text-slate-500 truncate leading-tight mt-0.5 tabular-nums">
                              <span className="font-mono font-black text-[#1899d6]">
                                Seat {st.seat_number}
                              </span>
                              <span aria-hidden="true"> · </span>
                              <span
                                className={`font-black ${
                                  isExp
                                    ? 'text-red-600'
                                    : isExpiring
                                    ? 'text-amber-600'
                                    : 'text-[#46a302]'
                                }`}
                              >
                                {studentViewFilter === 'renewals'
                                  ? isExp
                                    ? `Expired ${Math.abs(daysLeft)}d`
                                    : daysLeft === 0
                                    ? 'Expires Today'
                                    : `${daysLeft}d left`
                                  : isExp
                                  ? 'Expired'
                                  : `${daysLeft}d`}
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                            <a
                              href={callUrl}
                              className="p-1.5 rounded-xl duo-btn-blue flex items-center justify-center cursor-pointer min-h-[34px] min-w-[32px] sm:min-w-[34px]"
                              title={`Call ${st.name}`}
                              aria-label={`Call ${st.name}`}
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </a>
                            <a
                              href={blankWaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-xl duo-btn-green flex items-center justify-center cursor-pointer min-h-[34px] min-w-[32px] sm:min-w-[34px]"
                              title={`WhatsApp ${st.name}`}
                              aria-label={`WhatsApp ${st.name}`}
                            >
                              <MessageCircle className="w-3.5 h-3.5 fill-white" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleEditClick(st)}
                              className="p-1.5 rounded-xl duo-btn-white text-[#1899d6] hover:text-[#1cb0f6] cursor-pointer min-h-[34px] min-w-[32px] sm:min-w-[34px] flex items-center justify-center"
                              title={`Edit ${st.name}`}
                              aria-label={`Edit ${st.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            {studentViewFilter === 'renewals' && (
                              <button
                                type="button"
                                onClick={() => void handleOpenRenewModal(st)}
                                className="px-2 sm:px-2.5 py-1.5 rounded-xl duo-btn-green shadow-xs cursor-pointer min-h-[34px] flex items-center justify-center gap-1 text-[10px] font-black whitespace-nowrap shrink-0 transition-colors"
                                title={`Renew subscription for ${st.name}`}
                                aria-label={`Renew ${st.name}`}
                              >
                                <RefreshCw className="w-3 h-3 stroke-[2.5]" />
                                <span>Renew</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleExitStudentClick(st)}
                              className="p-1.5 sm:px-2.5 rounded-xl duo-btn-red cursor-pointer min-h-[34px] min-w-[32px] sm:min-w-[34px] flex items-center justify-center gap-1 text-[10px] font-black whitespace-nowrap shrink-0 shadow-xs"
                              title={`Exit & Vacate Seat ${st.seat_number}`}
                              aria-label={`Exit and vacate seat for ${st.name}`}
                            >
                              <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span className="hidden sm:inline">Exit</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Compact Pagination Footer */}
            {filteredStudents.length > 0 && (
              <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setStudentPage((p) => Math.max(0, p - 1));
                  }}
                  disabled={safeStudentPage === 0}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setStudentPage((p) => Math.min(totalStudentPages - 1, p + 1));
                  }}
                  disabled={safeStudentPage >= totalStudentPages - 1}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: INTERACTIVE SEAT MAP (Paginated 20-seat grid, Zero Scroll) */}
        {ownerSection === 'seatmap' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
            {/* Compact Legend & Capacity Control */}
            <div className="bg-white p-3 duo-card flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2.5 text-[10px] font-black text-slate-600 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#58cc02] inline-block" />
                  Free ({availableSeats})
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#1cb0f6] inline-block" />
                  Used ({occupiedSeats})
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs bg-[#ff9600] inline-block" />
                  ≤2d
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSeatCapacityInput(library?.total_seats || 50);
                  setShowSeatModal(true);
                }}
                className="px-3 py-1.5 rounded-xl text-[11px] font-black duo-btn-blue flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
              >
                <Pencil className="w-3 h-3" />
                <span>Cap: {totalSeats}</span>
              </button>
            </div>

            {/* 20-Seat Grid Stage */}
            <div className="flex-1 min-h-0 bg-white p-3 sm:p-4 duo-card flex items-center justify-center overflow-hidden">
              <div className="w-full h-full grid grid-cols-4 sm:grid-cols-5 grid-rows-5 sm:grid-rows-4 gap-2">
                {Array.from({ length: seatSliceCount }, (_, offset) => {
                  const seatNum = seatStartIndex + offset + 1;
                  const seatLabel = `A-${seatNum}`;
                  const seatStudents = students.filter(
                    (s) => !isStudentExited(s) && normalizeSeatLabel(s.seat_number) === seatLabel
                  );
                  const primaryStudent = seatStudents[0];
                  const hasExpired = seatStudents.some(
                    (st) => calculateDaysRemaining(st.subscription_end) < 0
                  );
                  const hasExpiring = seatStudents.some((st) => {
                    const d = calculateDaysRemaining(st.subscription_end);
                    return d >= 0 && d <= 2;
                  });

                  return (
                    <button
                      key={seatLabel}
                      type="button"
                      onClick={() => handleOpenSeatDetailsModal(seatLabel)}
                      className={`p-1.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center text-center min-h-[44px] relative ${
                        seatStudents.length === 0
                          ? 'bg-emerald-50/70 border-[#58cc02]/50 hover:bg-[#58cc02]/20'
                          : hasExpired
                          ? 'bg-red-50 border-red-300 hover:bg-red-100'
                          : hasExpiring
                          ? 'bg-amber-50 border-amber-300 hover:bg-amber-100'
                          : 'bg-blue-50 border-blue-300 hover:bg-blue-100'
                      }`}
                    >
                      {seatStudents.length > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-md bg-[#1899d6] text-white text-[9px] font-black leading-none shadow-xs">
                          {seatStudents.length}
                        </span>
                      )}
                      <span className="font-display font-black text-[11px] text-[#3c3c3c] leading-none">
                        {seatLabel}
                      </span>
                      {primaryStudent ? (
                        <span className="text-[9px] font-bold text-slate-600 truncate max-w-full mt-0.5 leading-none">
                          {seatStudents.length > 1
                            ? `${primaryStudent.name.split(' ')[0]} +${seatStudents.length - 1}`
                            : primaryStudent.name.split(' ')[0]}
                        </span>
                      ) : (
                        <span className="text-[9px] font-extrabold text-[#46a302] mt-0.5 leading-none">
                          FREE
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Seat Map Pagination Footer */}
            <div className="bg-white px-3 py-2 duo-card flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setSeatPage((p) => Math.max(0, p - 1));
                }}
                disabled={safeSeatPage === 0}
                className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setSeatPage((p) => Math.min(totalSeatPages - 1, p + 1));
                }}
                disabled={safeSeatPage >= totalSeatPages - 1}
                className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: SHIFTS & PRICING (On-Screen Single-Card Slide Deck) */}
        {ownerSection === 'shifts' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
            {/* Shifts Toolbar */}
            <div className="bg-white p-3 duo-card flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate">
                  Shifts & Pricing ({shifts.length})
                </h2>
                <p className="text-[11px] font-semibold text-slate-500 truncate">
                  Swipe or use arrows to edit batches
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setShowShiftSliderModal(true);
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-black duo-btn-white text-[#a855f7] cursor-pointer min-h-[40px]"
                  title="Full Shift Deck"
                >
                  Popup
                </button>
                <button
                  type="button"
                  onClick={handleOpenAddShiftModal}
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-purple flex items-center gap-1 cursor-pointer uppercase min-h-[40px]"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Add Shift</span>
                </button>
              </div>
            </div>

            {syncError && (
              <div className="px-3 py-2 rounded-2xl bg-red-50 border-2 border-red-200 text-red-800 text-xs font-bold flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span className="truncate">{syncError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadData()}
                  className="px-2.5 py-1 rounded-xl bg-red-100 hover:bg-red-200 text-red-900 font-black shrink-0 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Single-Screen Slide Viewer */}
            {shifts.length === 0 ? (
              <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                <Clock className="w-10 h-10 text-purple-400 mb-2" />
                <h3 className="font-display text-base font-black text-[#3c3c3c]">
                  No Custom Shifts Configured
                </h3>
                <p className="text-xs font-medium text-slate-500 mt-1 mb-4 max-w-xs">
                  Add morning, evening, or 24-hour shifts with preset timings and fees.
                </p>
                <button
                  type="button"
                  onClick={handleOpenAddShiftModal}
                  className="px-5 py-2.5 rounded-xl text-xs font-black duo-btn-purple cursor-pointer uppercase"
                >
                  Create First Shift
                </button>
              </div>
            ) : (
              (() => {
                const safeIdx = Math.min(Math.max(0, currentSlideIndex), shifts.length - 1);
                const sh = shifts[safeIdx];
                const theme = getShiftTheme(sh.name);
                const ShiftIcon = theme.icon;
                const enrolledCount = activeStudents.filter((s) =>
                  s.shift.toLowerCase().includes(sh.name.toLowerCase())
                ).length;

                return (
                  <div
                    className="flex-1 min-h-0 flex flex-col justify-between gap-2.5"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                  >
                    <div
                      className={`flex-1 min-h-0 rounded-3xl p-4 sm:p-6 border-2 ${theme.border} bg-gradient-to-br ${theme.bg} flex flex-col justify-between gap-3`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-12 h-12 rounded-2xl ${theme.iconBg} text-white flex items-center justify-center border-b-3 shrink-0`}>
                            <ShiftIcon className="w-6 h-6" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-[10px] font-black uppercase text-slate-500 block">
                              {theme.tag}
                            </span>
                            <h3 className="font-display text-xl sm:text-2xl font-black text-[#3c3c3c] truncate">
                              {sh.name}
                            </h3>
                          </div>
                        </div>
                        <div className="text-right shrink-0 bg-white px-3 py-1.5 rounded-2xl border border-slate-200">
                          <span className="text-[10px] font-black uppercase text-slate-400 block">Fee</span>
                          <span className="font-display text-lg font-black text-[#3c3c3c] tabular-nums">
                            ₹{sh.fee}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="p-3 bg-white/90 rounded-2xl border border-slate-200 flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-500">Operating Hours</span>
                          <span className="font-mono font-black text-slate-800">{sh.timing}</span>
                        </div>
                        <div className="p-3 bg-white/90 rounded-2xl border border-slate-200 flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-500">Enrolled Students</span>
                          <span className="font-black text-[#3c3c3c] tabular-nums">{enrolledCount} members</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEditShiftModal(sh)}
                          className="flex-1 py-2.5 px-3 rounded-xl text-xs font-black duo-btn-white flex items-center justify-center gap-1.5 cursor-pointer text-slate-700 min-h-[44px]"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#1cb0f6]" />
                          <span>Edit Timing & Fee</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInitiateDeleteShift(sh)}
                          className="py-2.5 px-3.5 rounded-xl text-xs font-black duo-btn-white text-red-600 cursor-pointer min-h-[44px] flex items-center justify-center"
                          title="Delete Shift"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Slide Pager Bar */}
                    <div className="bg-white px-3 py-2 duo-card flex items-center justify-between shrink-0">
                      <button
                        type="button"
                        onClick={goToPrevSlide}
                        disabled={shifts.length <= 1}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>Prev</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        {shifts.map((item, idx) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              playSound('pop');
                              setCurrentSlideIndex(idx);
                            }}
                            className={`h-2 rounded-full transition-all cursor-pointer ${
                              idx === safeIdx ? 'w-6 bg-[#ce82ff]' : 'w-2 bg-slate-300'
                            }`}
                            aria-label={`Shift ${idx + 1}`}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={goToNextSlide}
                        disabled={shifts.length <= 1}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* TAB 5: DEDICATED SEAT QR CODES SECTION (Auto-updates with dynamic seat count) */}
        {ownerSection === 'qrcodes' && (() => {
          const allLabels = buildCanonicalSeatLabels(
            totalSeats,
            students.map((s) => s.seat_number)
          );
          const q = qrSearch.trim().toLowerCase();
          const filteredQrSeats = q
            ? allLabels.filter((label) => {
                return (
                  label.toLowerCase().includes(q) ||
                  label.replace('A-', '').toLowerCase() === q ||
                  formatSeatBadgeNumber(label).toLowerCase() === q
                );
              })
            : allLabels;
          const QR_PER_PAGE = isDesktop ? 12 : 8;
          const totalQrPages = Math.max(1, Math.ceil(filteredQrSeats.length / QR_PER_PAGE));
          const safeQrPage = Math.min(qrPage, totalQrPages - 1);
          const visibleQrSeats = filteredQrSeats.slice(
            safeQrPage * QR_PER_PAGE,
            safeQrPage * QR_PER_PAGE + QR_PER_PAGE
          );

          const handleDownloadAllQrPdf = async () => {
            if (!library || downloadingQrPdf) return;
            setDownloadingQrPdf(true);
            playSound('pop');
            try {
              await downloadMasterQrPdf(library, { seatLabels: allLabels });
              playSound('success');
            } finally {
              setDownloadingQrPdf(false);
            }
          };

          return (
            <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
              {/* Top QR Management Bar with In-Page Switcher */}
              <div className="bg-white p-2.5 sm:p-3.5 duo-card flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSwitchSection('overview')}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-black duo-btn-white flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Home</span>
                    </button>
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate flex items-center gap-1.5">
                        <QrCode className="w-4 h-4 text-[#1cb0f6] shrink-0" />
                        <span>Seat QR Codes ({allLabels.length} Desks)</span>
                      </h2>
                      <p className="text-[10px] font-semibold text-slate-500 truncate">
                        Center-numbered Level-H QR badges · Mobile &amp; App Scannable.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setSeatCapacityInput(library?.total_seats || 50);
                        setShowSeatModal(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-black duo-btn-white text-slate-700 flex items-center gap-1 cursor-pointer min-h-[36px]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Seats ({totalSeats})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadAllQrPdf()}
                      disabled={!library || downloadingQrPdf}
                      className="px-3 py-1.5 rounded-xl text-[11px] font-black duo-btn-blue flex items-center gap-1.5 cursor-pointer min-h-[36px] disabled:opacity-60"
                    >
                      {downloadingQrPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>{downloadingQrPdf ? 'Building PDF...' : 'Master QR PDF'}</span>
                    </button>
                  </div>
                </div>

                {/* In-Page Segmented Switcher: Attendance Reports | QR Codes */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleSwitchSection('attendance')}
                    className="py-1.5 px-2.5 rounded-lg text-xs font-black text-slate-500 hover:text-slate-800 transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[34px]"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 text-[#58cc02]" />
                    <span>Attendance Reports</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchSection('qrcodes')}
                    className="py-1.5 px-2.5 rounded-lg text-xs font-black bg-white text-[#1899d6] shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[34px]"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>QR Codes ({totalSeats})</span>
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter by seat number (e.g. A-12 or 12)..."
                    value={qrSearch}
                    onChange={(e) => {
                      setQrSearch(e.target.value);
                      setQrPage(0);
                    }}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden text-xs font-bold bg-white"
                  />
                </div>
              </div>

              {/* Seat QR Cards Grid */}
              <div className="flex-1 min-h-0 bg-white p-2.5 sm:p-3.5 duo-card overflow-y-auto">
                {visibleQrSeats.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6">
                    <QrCode className="w-10 h-10 text-slate-300 mb-2" />
                    <p className="font-display text-sm font-black text-slate-600">
                      No matching seat QR found
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                    {visibleQrSeats.map((seatLabel) => {
                      const dataUrl = qrDataUrls[seatLabel];
                      const payload = encodeSeatQrPayload(libraryId, seatLabel);
                      const badgeNum = formatSeatBadgeNumber(seatLabel);
                      return (
                        <button
                          key={seatLabel}
                          type="button"
                          onClick={() => {
                            if (!dataUrl) return;
                            playSound('pop');
                            setPreviewSeatQr({
                              seatLabel,
                              dataUrl,
                              payload,
                            });
                          }}
                          className="p-2.5 rounded-2xl border-2 border-[#e5e5e5] hover:border-[#1cb0f6] bg-slate-50/60 hover:bg-sky-50/50 transition-all flex flex-col items-center text-center gap-1.5 cursor-pointer"
                        >
                          <div className="w-full flex items-center justify-between text-[11px] font-black text-[#3c3c3c]">
                            <span>SEAT {seatLabel}</span>
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[9px] font-black tabular-nums">
                              #{badgeNum}
                            </span>
                          </div>
                          <div className="w-24 h-24 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden p-1">
                            {dataUrl ? (
                              <img
                                src={dataUrl}
                                alt={`Seat ${seatLabel} QR`}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
                            )}
                          </div>
                          <div className="w-full flex flex-col items-center leading-tight">
                            <span className="text-[10px] font-extrabold text-slate-700 truncate max-w-full">
                              {library?.name || 'StudyLingo Library'}
                            </span>
                            <span className="text-[9px] font-bold text-[#1899d6]">
                              Scan to Check-In / Out
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* QR Pagination Bar */}
              {totalQrPages > 1 && (
                <div className="flex items-center justify-between px-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setQrPage((p) => Math.max(0, p - 1))}
                    disabled={safeQrPage === 0}
                    className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1 min-h-[36px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>
                  <span className="text-xs font-black text-slate-500 tabular-nums">
                    Page {safeQrPage + 1} / {totalQrPages} ({filteredQrSeats.length} seats)
                  </span>
                  <button
                    type="button"
                    onClick={() => setQrPage((p) => Math.min(totalQrPages - 1, p + 1))}
                    disabled={safeQrPage >= totalQrPages - 1}
                    className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1 min-h-[36px]"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 6: ATTENDANCE & REPORTS SECTION (Structured 7-Column Data Table) */}
        {ownerSection === 'attendance' && (() => {
          let startDate = attendanceDailyDate;
          let endDate = attendanceDailyDate;

          if (attendanceFilterType === 'monthly') {
            const [yStr, mStr] = attendanceMonth.split('-');
            const y = parseInt(yStr, 10) || new Date().getFullYear();
            const m = parseInt(mStr, 10) || new Date().getMonth() + 1;
            const lastDay = new Date(y, m, 0).getDate();
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
          } else if (attendanceFilterType === 'custom') {
            startDate =
              attendanceRangeStart <= attendanceRangeEnd
                ? attendanceRangeStart
                : attendanceRangeEnd;
            endDate =
              attendanceRangeEnd >= attendanceRangeStart
                ? attendanceRangeEnd
                : attendanceRangeStart;
          }

          const nowRef = new Date(attendanceTick);
          const allPeriodRows = buildAttendanceTableRows({
            students,
            records: attendanceLogs,
            startDate,
            endDate,
            activationDate: libraryActivationDate,
            now: nowRef,
            shifts,
          });

          const q = attendanceSearch.trim().toLowerCase();
          const searchMatchedRows = q
            ? allPeriodRows.filter(
                (row) =>
                  row.studentName.toLowerCase().includes(q) ||
                  row.seatCode.toLowerCase().includes(q) ||
                  row.shiftName.toLowerCase().includes(q) ||
                  row.formattedDate.includes(q) ||
                  row.statusRemarks.toLowerCase().includes(q)
              )
            : allPeriodRows;

          const filteredRows = searchMatchedRows.filter((row) => {
            if (attendanceStatusFilter === 'all') return true;
            if (attendanceStatusFilter === 'present') {
              return row.state === 'checked_in' || row.state === 'checked_out';
            }
            if (attendanceStatusFilter === 'checked_in') {
              return row.state === 'checked_in';
            }
            return row.state === 'absent';
          });

          const ATT_PER_PAGE = isDesktop ? 9 : 7;
          const totalAttPages = Math.max(1, Math.ceil(filteredRows.length / ATT_PER_PAGE));
          const safeAttPage = Math.min(attendancePage, totalAttPages - 1);
          const visibleRows = filteredRows.slice(
            safeAttPage * ATT_PER_PAGE,
            safeAttPage * ATT_PER_PAGE + ATT_PER_PAGE
          );

          const presentCount = searchMatchedRows.filter(
            (r) => r.state === 'checked_in' || r.state === 'checked_out'
          ).length;
          const activeSeatedCount = searchMatchedRows.filter(
            (r) => r.state === 'checked_in'
          ).length;
          const absentCount = searchMatchedRows.filter((r) => r.state === 'absent').length;

          const periodLabel =
            attendanceFilterType === 'daily'
              ? formatNumericDate(attendanceDailyDate)
              : attendanceFilterType === 'monthly'
              ? attendanceMonth
              : `${formatNumericDate(startDate)} to ${formatNumericDate(endDate)}`;

          const handleDownloadAttendancePdf = () => {
            if (!library) return;
            playSound('pop');
            downloadAttendanceReportPdf({
              library,
              rows: filteredRows,
              periodLabel,
              filterSummary: q
                ? `Filter: "${q}"`
                : `View: ${attendanceFilterType.toUpperCase()} (${attendanceStatusFilter.toUpperCase()})`,
            });
            playSound('success');
          };

          return (
            <div className="flex-1 min-h-0 flex flex-col justify-between gap-2">
              {/* Filter & Download Toolbar with In-Page QR Codes Switcher */}
              <div className="bg-white p-2.5 sm:p-3 duo-card flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleSwitchSection('overview')}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-black duo-btn-white flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Home</span>
                    </button>
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate flex items-center gap-1.5">
                        <ClipboardCheck className="w-4 h-4 text-[#58cc02] shrink-0" />
                        <span>Attendance & Reports</span>
                      </h2>
                      <p className="text-[10px] font-bold text-slate-400 truncate tabular-nums">
                        Tracking active since {formatNumericDate(libraryActivationDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setAttendanceTick(Date.now());
                        void syncAttendanceAndAbsentLogs(true);
                      }}
                      disabled={refreshingAttendance}
                      className="p-1.5 rounded-xl duo-btn-white text-slate-600 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-70"
                      title="Refresh Attendance"
                      aria-label="Refresh Attendance"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingAttendance ? 'animate-spin text-[#46a302]' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadAttendancePdf}
                      disabled={!library}
                      className="px-3 py-1.5 rounded-xl text-[11px] font-black duo-btn-green flex items-center gap-1.5 cursor-pointer min-h-[36px] shrink-0"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>Download PDF</span>
                    </button>
                  </div>
                </div>

                {/* In-Page Segmented Switcher: Attendance Reports | QR Codes */}
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => handleSwitchSection('attendance')}
                    className="py-1.5 px-2.5 rounded-lg text-xs font-black bg-white text-[#46a302] shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[34px]"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    <span>Attendance Reports</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchSection('qrcodes')}
                    className="py-1.5 px-2.5 rounded-lg text-xs font-black text-slate-500 hover:text-slate-800 transition-all cursor-pointer flex items-center justify-center gap-1.5 min-h-[34px]"
                  >
                    <QrCode className="w-3.5 h-3.5 text-[#1cb0f6]" />
                    <span>QR Codes ({totalSeats})</span>
                  </button>
                </div>

                {/* Period Mode Switcher + Date / Search Controls */}
                <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-100 rounded-xl">
                  {(
                    [
                      { id: 'daily', label: 'Daily' },
                      { id: 'monthly', label: 'Monthly' },
                      { id: 'custom', label: 'Previous / Range' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setAttendanceFilterType(mode.id);
                        setAttendancePage(0);
                      }}
                      className={`py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                        attendanceFilterType === mode.id
                          ? 'bg-white text-[#3c3c3c] shadow-xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {attendanceFilterType === 'daily' && (
                    <input
                      type="date"
                      value={attendanceDailyDate}
                      onChange={(e) => {
                        setAttendanceDailyDate(e.target.value);
                        setAttendancePage(0);
                      }}
                      className="px-2.5 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                    />
                  )}
                  {attendanceFilterType === 'monthly' && (
                    <input
                      type="month"
                      value={attendanceMonth}
                      onChange={(e) => {
                        setAttendanceMonth(e.target.value);
                        setAttendancePage(0);
                      }}
                      className="px-2.5 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                    />
                  )}
                  {attendanceFilterType === 'custom' && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={attendanceRangeStart}
                        onChange={(e) => {
                          setAttendanceRangeStart(e.target.value);
                          setAttendancePage(0);
                        }}
                        className="px-2 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                      />
                      <span className="text-[11px] font-black text-slate-400">to</span>
                      <input
                        type="date"
                        value={attendanceRangeEnd}
                        onChange={(e) => {
                          setAttendanceRangeEnd(e.target.value);
                          setAttendancePage(0);
                        }}
                        className="px-2 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                      />
                    </div>
                  )}

                  <div className="relative flex-1 min-w-[140px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search name, seat, shift, status..."
                      value={attendanceSearch}
                      onChange={(e) => {
                        setAttendanceSearch(e.target.value);
                        setAttendancePage(0);
                      }}
                      className="w-full pl-8 pr-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                    />
                  </div>
                </div>

                {/* Status Filter Bar */}
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-100 rounded-xl text-[10px] font-black">
                  {(
                    [
                      { id: 'all', label: `All (${searchMatchedRows.length})` },
                      { id: 'present', label: `Present (${presentCount})` },
                      { id: 'checked_in', label: `In Hall (${activeSeatedCount})` },
                      { id: 'absent', label: `Absent (${absentCount})` },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => {
                        setAttendanceStatusFilter(st.id);
                        setAttendancePage(0);
                      }}
                      className={`py-1 rounded-lg transition-all cursor-pointer truncate px-1 tabular-nums ${
                        attendanceStatusFilter === st.id
                          ? 'bg-white text-[#3c3c3c] shadow-xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Structured 7-Column Attendance Data Table */}
              <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                {visibleRows.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                    <ClipboardCheck className="w-9 h-9 text-slate-300 mb-2" />
                    <p className="font-display text-sm font-black text-slate-600">
                      {endDate < libraryActivationDate
                        ? `No records before onboarding (${formatNumericDate(libraryActivationDate)})`
                        : `No attendance records for ${periodLabel}`}
                    </p>
                    <p className="text-[11px] font-semibold text-slate-400 mt-0.5 max-w-xs">
                      {endDate < libraryActivationDate
                        ? 'Attendance tracking and absent calculations start strictly from your library activation date.'
                        : 'Active students who scan in or miss their shift will appear in this table automatically.'}
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <table className="w-full text-left border-collapse min-w-[680px]">
                      <thead className="sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Name</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Seat</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Shift</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Check-In</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Check-Out</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">Status / Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {visibleRows.map((row) => (
                          <tr
                            key={row.id}
                            className={`transition-colors ${
                              row.state === 'absent'
                                ? 'bg-red-50/35 hover:bg-red-50/70'
                                : row.state === 'checked_in'
                                ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                                : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-bold text-slate-600 whitespace-nowrap tabular-nums">
                              {row.formattedDate}
                            </td>
                            <td className="py-2.5 px-3 font-display font-black text-[#3c3c3c] whitespace-nowrap">
                              {row.studentName}
                            </td>
                            <td className="py-2.5 px-3 font-black text-[#1899d6] whitespace-nowrap tabular-nums">
                              {row.seatCode}
                            </td>
                            <td
                              className="py-2.5 px-3 font-semibold text-slate-600 whitespace-nowrap"
                              title={row.fullShift}
                            >
                              {row.shiftName}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap tabular-nums">
                              {row.checkInDisplay}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-800 whitespace-nowrap tabular-nums">
                              {row.checkOutDisplay}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`text-[11px] font-black ${
                                  row.state === 'absent'
                                    ? 'text-red-600'
                                    : row.state === 'checked_in'
                                    ? 'text-[#46a302]'
                                    : row.state === 'checked_out'
                                    ? 'text-[#1899d6]'
                                    : 'text-amber-600'
                                }`}
                              >
                                {row.statusRemarks}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {totalAttPages > 1 && (
                <div className="flex items-center justify-between px-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAttendancePage((p) => Math.max(0, p - 1))}
                    disabled={safeAttPage === 0}
                    className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1 min-h-[36px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>
                  <span className="text-xs font-black text-slate-500 tabular-nums">
                    Page {safeAttPage + 1} / {totalAttPages} ({filteredRows.length} entries)
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttendancePage((p) => Math.min(totalAttPages - 1, p + 1))}
                    disabled={safeAttPage >= totalAttPages - 1}
                    className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1 min-h-[36px]"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* TAB 7: WHATSAPP-STYLE BROADCAST CHAT INTERFACE */}
        {ownerSection === 'broadcasts' && (() => {
          const formatDateLabel = (iso: string) => {
            try {
              const d = new Date(iso);
              const today = new Date();
              const yesterday = new Date();
              yesterday.setDate(today.getDate() - 1);

              const sameDay = (a: Date, b: Date) =>
                a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate();

              if (sameDay(d, today)) return 'Today';
              if (sameDay(d, yesterday)) return 'Yesterday';
              return d.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
            } catch {
              return 'Notice';
            }
          };

          const formatTimeLabel = (iso: string) => {
            try {
              return new Date(iso).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
            } catch {
              return '';
            }
          };

          const allVisibleSelected =
            visibleBroadcastHistory.length > 0 &&
            visibleBroadcastHistory.every((item) => selectedBroadcastIds.includes(item.id));

          return (
            <div className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden border-2 border-[#d1d7db] shadow-xs bg-[#efeae2]">
              {/* WhatsApp-Style Chat Header / Multi-Select Contextual Header */}
              {isMultiSelectMode ? (
                <div className="bg-[#064e46] text-white px-3.5 py-2.5 flex items-center justify-between gap-2.5 shrink-0 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        exitMultiSelectMode();
                      }}
                      className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                      title="Cancel selection"
                      aria-label="Cancel multi-select mode"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <p className="font-display text-sm sm:text-base font-black text-white leading-tight truncate">
                        {selectedBroadcastIds.length > 0
                          ? `${selectedBroadcastIds.length} Selected`
                          : 'Select Messages'}
                      </p>
                      <p className="text-[10px] sm:text-[11px] font-semibold text-emerald-100/85 truncate leading-tight">
                        Tap messages to check or uncheck
                      </p>
                    </div>
                  </div>

                  {visibleBroadcastHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        if (allVisibleSelected) {
                          setSelectedBroadcastIds([]);
                        } else {
                          setSelectedBroadcastIds(visibleBroadcastHistory.map((b) => b.id));
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[11px] font-black cursor-pointer shrink-0 transition-colors"
                    >
                      {allVisibleSelected ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-[#075e54] text-white px-3.5 py-2.5 flex items-center justify-between gap-2.5 shrink-0 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#25d366] text-white flex items-center justify-center font-black shrink-0 shadow-2xs">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-black text-white truncate leading-tight">
                        {library?.name || 'Study Library'}
                      </h2>
                      <p className="text-[10px] sm:text-[11px] font-semibold text-emerald-100/90 truncate leading-tight mt-0.5">
                        Student Broadcast Channel ·{' '}
                        {pendingBroadcastsCount > 0
                          ? `${pendingBroadcastsCount} pending admin`
                          : `${visibleBroadcastHistory.length} notices (7d)`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {visibleBroadcastHistory.length > 0 && (
                      <button
                        type="button"
                        onClick={() => enterMultiSelectWith()}
                        className="h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-[11px] font-black inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Select multiple messages to delete"
                        aria-label="Enter multi-select mode"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>Select</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        void refreshBroadcastHistory(true);
                      }}
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                      title="Refresh delivery status"
                      aria-label="Refresh delivery status"
                    >
                      <RefreshCw className={`w-4 h-4 ${refreshingBroadcasts ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              )}

              {/* Scrollable Chat History Bubbles Area */}
              <div
                ref={chatScrollContainerRef}
                className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-4 space-y-2.5 scroll-smooth"
              >
                {/* System Retention / Info Banner */}
                <div className="flex justify-center">
                  <div className="bg-[#fff3c4] text-[#54461d] text-[10px] sm:text-[11px] font-semibold px-3 py-1.5 rounded-xl max-w-sm text-center shadow-2xs border border-amber-200/70">
                    Notices are queued for the Master Admin WhatsApp list. History auto-clears after 7 days; long-press or tap Select to bulk delete.
                  </div>
                </div>

                {visibleBroadcastHistory.length === 0 ? (
                  <div className="py-10 flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 rounded-full bg-white/90 text-[#075e54] flex items-center justify-center shadow-xs mb-2">
                      <Megaphone className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-black text-slate-700">No Broadcast Notices Yet</p>
                    <p className="text-[11px] font-semibold text-slate-500 max-w-xs mt-0.5">
                      Type a holiday, cleaning, or maintenance update below to send it directly to the broadcast queue.
                    </p>
                  </div>
                ) : (
                  visibleBroadcastHistory.map((item, idx) => {
                    const currentDateLabel = formatDateLabel(item.created_at);
                    const prevDateLabel =
                      idx > 0
                        ? formatDateLabel(visibleBroadcastHistory[idx - 1].created_at)
                        : null;
                    const showDateDivider = idx === 0 || currentDateLabel !== prevDateLabel;
                    const isDispatched = item.status === 'sent' || item.status === 'archived';
                    const isChecked = selectedBroadcastIds.includes(item.id);

                    const clearLongPressTimer = () => {
                      if (bubbleLongPressTimerRef.current !== null) {
                        window.clearTimeout(bubbleLongPressTimerRef.current);
                        bubbleLongPressTimerRef.current = null;
                      }
                    };

                    return (
                      <React.Fragment key={item.id}>
                        {showDateDivider && (
                          <div className="flex justify-center pt-1 pb-0.5">
                            <span className="bg-white/95 text-slate-600 text-[10px] font-black px-2.5 py-0.5 rounded-lg shadow-2xs border border-slate-200/70 uppercase tracking-wide">
                              {currentDateLabel}
                            </span>
                          </div>
                        )}

                        <div
                          onClick={
                            isMultiSelectMode
                              ? () => toggleBroadcastSelection(item.id)
                              : undefined
                          }
                          className={`flex items-center gap-2.5 group rounded-xl transition-colors ${
                            isMultiSelectMode
                              ? `justify-between px-2 py-1 cursor-pointer ${
                                  isChecked ? 'bg-[#075e54]/10' : 'hover:bg-black/5'
                                }`
                              : 'justify-end'
                          }`}
                        >
                          {isMultiSelectMode ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBroadcastSelection(item.id);
                              }}
                              aria-label={isChecked ? 'Deselect message' : 'Select message'}
                              aria-pressed={isChecked}
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all ${
                                isChecked
                                  ? 'bg-[#075e54] border-[#075e54] text-white shadow-xs scale-105'
                                  : 'bg-white/95 border-slate-400 text-transparent hover:border-[#075e54]'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  enterMultiSelectWith(item.id);
                                }}
                                className="w-7 h-7 rounded-full bg-white/90 hover:bg-emerald-50 text-slate-500 hover:text-[#075e54] border border-slate-200/80 shadow-2xs flex items-center justify-center cursor-pointer transition-colors"
                                title="Select message"
                                aria-label="Select message"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteBroadcastMessage(item.id);
                                }}
                                className="w-7 h-7 rounded-full bg-white/90 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200/80 shadow-2xs flex items-center justify-center cursor-pointer transition-colors"
                                title="Delete message"
                                aria-label="Delete message"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          <div
                            onTouchStart={() => {
                              if (isMultiSelectMode) return;
                              clearLongPressTimer();
                              bubbleLongPressTriggeredRef.current = false;
                              bubbleLongPressTimerRef.current = window.setTimeout(() => {
                                bubbleLongPressTriggeredRef.current = true;
                                enterMultiSelectWith(item.id);
                                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                  navigator.vibrate(15);
                                }
                              }, 400);
                            }}
                            onTouchMove={clearLongPressTimer}
                            onTouchCancel={clearLongPressTimer}
                            onTouchEnd={clearLongPressTimer}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (isMultiSelectMode) {
                                toggleBroadcastSelection(item.id);
                              } else {
                                enterMultiSelectWith(item.id);
                              }
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (bubbleLongPressTriggeredRef.current) {
                                bubbleLongPressTriggeredRef.current = false;
                                return;
                              }
                              const hasTextSelection =
                                typeof window !== 'undefined' &&
                                Boolean(window.getSelection()?.toString().trim());
                              if (hasTextSelection) return;

                              if (isMultiSelectMode) {
                                toggleBroadcastSelection(item.id);
                              } else {
                                enterMultiSelectWith(item.id);
                              }
                            }}
                            className={`rounded-2xl rounded-tr-xs px-3 py-2 max-w-[84%] sm:max-w-[75%] shadow-xs border cursor-pointer select-text transition-all ${
                              isMultiSelectMode && isChecked
                                ? 'bg-[#c5f6bc] text-[#111b21] border-[#075e54] ring-2 ring-[#075e54]/30'
                                : 'bg-[#d9fdd3] text-[#111b21] border-[#c3eec0]'
                            }`}
                          >
                            <p className="text-xs sm:text-[13px] font-medium whitespace-pre-wrap break-words leading-relaxed">
                              {item.message.split(/(\*[^*\n]+\*)/g).map((part, pIdx) =>
                                part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
                                  <strong key={pIdx} className="font-black text-[#0b141a]">
                                    {part.slice(1, -1)}
                                  </strong>
                                ) : (
                                  <React.Fragment key={pIdx}>{part}</React.Fragment>
                                )
                              )}
                            </p>
                            <div className="flex items-center justify-end gap-1.5 mt-1">
                              <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                                {formatTimeLabel(item.created_at)}
                              </span>
                              {isDispatched ? (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] font-black text-[#0284c7]"
                                  title="Broadcasted by Master Admin"
                                >
                                  <CheckCheck className="w-4 h-4 text-[#0284c7] stroke-[2.4]" />
                                </span>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-500"
                                  title="Pending Admin Broadcast"
                                >
                                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Bottom Bar: Multi-Select Bulk Delete OR WhatsApp-Style Auto-Expanding Chat Composer */}
              {isMultiSelectMode ? (
                <div className="bg-white border-t border-slate-200 px-3.5 py-2.5 flex items-center justify-between gap-2.5 shrink-0 shadow-xs">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-black text-slate-800 truncate">
                      {selectedBroadcastIds.length === 0
                        ? 'No messages selected'
                        : `${selectedBroadcastIds.length} message${
                            selectedBroadcastIds.length === 1 ? '' : 's'
                          } selected`}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500 truncate">
                      Clears from chat &amp; Admin queue instantly
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={selectedBroadcastIds.length === 0 || bulkDeletingBroadcasts}
                    onClick={() => void handleBulkDeleteBroadcasts()}
                    className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-black px-4 py-2.5 rounded-xl shadow-sm cursor-pointer disabled:cursor-not-allowed shrink-0 transition-all active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>
                      {bulkDeletingBroadcasts
                        ? 'Deleting...'
                        : `Delete Selected (${selectedBroadcastIds.length})`}
                    </span>
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmitBroadcast}
                  className="bg-[#f0f2f5] border-t border-slate-200/80 px-2.5 py-2.5 flex items-end gap-2 shrink-0"
                >
                  <button
                    type="button"
                    onClick={handleOpenMagicWand}
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white flex items-center justify-center shadow-sm cursor-pointer shrink-0 transition-transform active:scale-95 relative"
                    title="Magic Wand Notice Generator"
                    aria-label="Open Magic Wand AI Notice Generator"
                  >
                    <Wand2 className="w-4 h-4 stroke-[2.3]" />
                    <Sparkles className="w-2.5 h-2.5 absolute top-1.5 right-1.5 text-yellow-100" />
                  </button>
                  <div className="flex-1 min-w-0 bg-white rounded-[22px] px-3.5 py-2 border border-slate-200 focus-within:border-[#25d366] shadow-2xs flex items-end">
                    <textarea
                      ref={broadcastTextareaRef}
                      rows={1}
                      value={broadcastMessage}
                      onChange={(e) => setBroadcastMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (broadcastMessage.trim()) {
                            handleSubmitBroadcast(e);
                          }
                        }
                      }}
                      placeholder="Type a broadcast notice..."
                      aria-label="Type broadcast notice message"
                      className="w-full bg-transparent focus:outline-hidden text-xs sm:text-sm font-medium text-slate-800 resize-none min-h-[24px] max-h-40 leading-[22px] py-0 overflow-hidden"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!broadcastMessage.trim()}
                    className="w-10 h-10 rounded-full bg-[#25d366] hover:bg-[#1ebe5d] disabled:bg-slate-300 text-white flex items-center justify-center shadow-sm cursor-pointer disabled:cursor-not-allowed shrink-0 transition-colors"
                    title="Send Notice"
                    aria-label="Send Notice"
                  >
                    <Send className="w-4 h-4 translate-x-[-1px]" />
                  </button>
                </form>
              )}
            </div>
          );
        })()}

      </div>

      {/* FIXED BOTTOM NAVIGATION TAB BAR */}
      <nav
        aria-label="Owner Navigation Tabs"
        className="shrink-0 bg-white/95 backdrop-blur-md border-t-2 border-[#e5e5e5] px-1.5 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] z-30"
      >
        <div className="max-w-xl mx-auto grid grid-cols-5 gap-1">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive =
              ownerSection === tab.id ||
              (tab.id === 'overview' &&
                (ownerSection === 'attendance' || ownerSection === 'qrcodes'));
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSwitchSection(tab.id)}
                className={`relative min-h-[44px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#1cb0f6]/12 text-[#1899d6]'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.6]' : 'stroke-[2]'}`} />
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#25d366] text-white text-[9px] font-black flex items-center justify-center leading-none border border-white tabular-nums">
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-black tracking-tight whitespace-nowrap">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* SINGLE SEAT QR PREVIEW & PNG DOWNLOAD MODAL */}
      {previewSeatQr && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-sm w-full p-6 duo-card shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-center space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                  Seat {previewSeatQr.seatLabel} QR · #{formatSeatBadgeNumber(previewSeatQr.seatLabel)}
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  {library?.name || 'StudyLingo Library'} · Scan to Check-In / Out
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSeatQr(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mx-auto w-56 h-56 rounded-2xl border-2 border-slate-200 p-3 bg-white flex items-center justify-center">
              <img
                src={previewSeatQr.dataUrl}
                alt={`QR for ${previewSeatQr.seatLabel}`}
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-600 break-all space-y-1 text-left">
              <span className="font-sans text-[9px] font-black uppercase tracking-wider text-slate-400 block">
                Public Camera Scan URL
              </span>
              <a
                href={previewSeatQr.payload}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1899d6] hover:underline font-bold block"
              >
                {previewSeatQr.payload}
              </a>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={previewSeatQr.dataUrl}
                download={`Seat-${previewSeatQr.seatLabel}-QR.png`}
                className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-blue flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
              >
                <Download className="w-4 h-4" />
                <span>Save PNG</span>
              </a>
              <button
                type="button"
                onClick={() => setPreviewSeatQr(null)}
                className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[42px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Update Total Seat Capacity */}
      {showSeatModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-6 sm:p-8 duo-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#1cb0f6] text-white flex items-center justify-center border-b-3 border-[#1899d6]">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                    Update Seat Capacity
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    Adjust the physical seat limit for your library
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSeatModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSeatCapacity} className="mt-5 space-y-4">
              {seatModalError && (
                <div className="p-3 bg-red-50 border-2 border-red-200 rounded-xl text-xs font-bold text-red-600 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{seatModalError}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Total Seat Count
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={seatCapacityInput}
                    onChange={(e) => setSeatCapacityInput(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden font-display text-2xl font-black text-[#3c3c3c] bg-white"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                    SEATS
                  </span>
                </div>
              </div>

              {/* Quick increment / decrement pills */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSeatCapacityInput((prev) => Math.max(1, prev - 5))}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  -5
                </button>
                <button
                  type="button"
                  onClick={() => setSeatCapacityInput((prev) => prev + 5)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  +5
                </button>
                <button
                  type="button"
                  onClick={() => setSeatCapacityInput((prev) => prev + 10)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  +10
                </button>
                <button
                  type="button"
                  onClick={() => setSeatCapacityInput((prev) => prev + 25)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  +25
                </button>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                <div className="flex justify-between font-medium">
                  <span>Currently Occupied Seats:</span>
                  <span className="font-bold text-slate-900 tabular-nums">{occupiedSeats} seats</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Available Seats After Save:</span>
                  <span className="font-bold text-[#1899d6] tabular-nums">
                    {Math.max(0, seatCapacityInput - occupiedSeats)} free seats
                  </span>
                </div>
                {seatCapacityInput < occupiedSeats && (
                  <p className="text-red-600 font-bold text-[11px] pt-1">
                    ⚠️ Notice: Capacity is set lower than current occupied students ({occupiedSeats}).
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowSeatModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSeatCapacity || seatCapacityInput < 1}
                  className="px-6 py-2.5 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase tracking-wider"
                >
                  {savingSeatCapacity ? 'Saving...' : 'Save Capacity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add / Edit Custom Shift */}
      {showShiftModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-6 sm:p-8 duo-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#ce82ff] text-white flex items-center justify-center border-b-3 border-[#a855f7]">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                    {editingShift ? 'Edit Shift & Pricing' : 'Add Custom Shift'}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    Define timings and monthly fee for this slot
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowShiftModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveShift} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Shift Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Morning Shift, Early Bird Batch, Night Owls"
                  value={shiftForm.name}
                  onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#ce82ff] focus:outline-hidden text-xs font-bold"
                />
              </div>

              {/* Semi-Automated Shift Timing Selection */}
              <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black uppercase text-slate-700">
                    Operating Hours / Timings *
                  </label>
                  <span className="text-[10px] font-extrabold text-purple-700">
                    Tap a preset or pick hours
                  </span>
                </div>

                {/* 1. Quick-Select Preset Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {[
                    { label: '07:00 AM - 01:00 PM', name: 'Morning Shift', badge: '🌅 Morning' },
                    { label: '01:00 PM - 07:00 PM', name: 'Evening Shift', badge: '☀️ Afternoon' },
                    { label: '05:00 PM - 11:00 PM', name: 'Late Evening Shift', badge: '🌆 Evening' },
                    { label: '11:00 PM - 07:00 AM', name: 'Night Shift', badge: '🌙 Night Owls' },
                    { label: '24 Hours Access', name: 'Full Day (24/7)', badge: '⚡ 24 Hours' },
                    { label: '06:00 AM - 12:00 PM', name: 'Early Bird Shift', badge: '🕐 Early Bird' },
                  ].map((preset) => {
                    const isSelected = shiftForm.timing === preset.label;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setShiftForm({
                            ...shiftForm,
                            timing: preset.label,
                            name: (!shiftForm.name || ['Morning Shift', 'Evening Shift', 'Late Evening Shift', 'Night Shift', 'Full Day (24/7)', 'Early Bird Shift'].includes(shiftForm.name))
                              ? preset.name
                              : shiftForm.name,
                          });
                          const parts = preset.label.split(' - ');
                          if (parts.length === 2) {
                            setCustomStartTime(parts[0].trim());
                            setCustomEndTime(parts[1].trim());
                          }
                        }}
                        className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-purple-100 border-purple-400 text-purple-900 ring-2 ring-purple-300 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-purple-300 hover:bg-purple-50/50'
                        }`}
                      >
                        <span className="text-[11px] font-black">{preset.badge}</span>
                        <span className="text-[10px] font-mono font-semibold text-slate-500 truncate mt-0.5">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 2. Standard Start & End Time Pickers */}
                <div className="pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1.5">
                    <span>Or Custom Time Pickers:</span>
                    <button
                      type="button"
                      onClick={() => {
                        const customRange = `${customStartTime} - ${customEndTime}`;
                        setShiftForm({ ...shiftForm, timing: customRange });
                        playSound('pop');
                      }}
                      className="text-purple-700 hover:underline font-black"
                    >
                      Apply ({customStartTime} - {customEndTime})
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-0.5">Start Time</span>
                      <select
                        value={customStartTime}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          setCustomStartTime(newStart);
                          setShiftForm((prev) => ({
                            ...prev,
                            timing: `${newStart} - ${customEndTime}`,
                          }));
                          playSound('pop');
                        }}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold font-mono bg-white text-slate-800 focus:border-purple-400 focus:outline-hidden"
                      >
                        {[
                          '05:00 AM', '06:00 AM', '07:00 AM', '08:00 AM', '09:00 AM', '10:00 AM',
                          '11:00 AM', '12:00 PM', '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM',
                          '05:00 PM', '06:00 PM', '07:00 PM', '08:00 PM', '09:00 PM', '10:00 PM', '11:00 PM'
                        ].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-400 block mb-0.5">End Time</span>
                      <select
                        value={customEndTime}
                        onChange={(e) => {
                          const newEnd = e.target.value;
                          setCustomEndTime(newEnd);
                          setShiftForm((prev) => ({
                            ...prev,
                            timing: `${customStartTime} - ${newEnd}`,
                          }));
                          playSound('pop');
                        }}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold font-mono bg-white text-slate-800 focus:border-purple-400 focus:outline-hidden"
                      >
                        {[
                          '11:00 AM', '12:00 PM', '01:00 PM', '02:00 PM', '03:00 PM', '04:00 PM',
                          '05:00 PM', '06:00 PM', '07:00 PM', '08:00 PM', '09:00 PM', '10:00 PM',
                          '11:00 PM', '12:00 AM', '05:00 AM', '06:00 AM', '07:00 AM', '08:00 AM'
                        ].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 3. Output field preview */}
                <div className="pt-1">
                  <span className="text-[10px] font-bold text-slate-400 block mb-0.5">Selected Operating Hours:</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 07:00 AM - 01:00 PM"
                    value={shiftForm.timing}
                    onChange={(e) => setShiftForm({ ...shiftForm, timing: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-mono text-xs font-bold text-slate-900 focus:border-purple-400 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Monthly Fee / Charge (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    required
                    placeholder="800"
                    value={shiftForm.fee}
                    onChange={(e) => setShiftForm({ ...shiftForm, fee: Number(e.target.value) || 0 })}
                    className="w-full pl-8 pr-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#ce82ff] focus:outline-hidden text-sm font-black font-mono text-[#3c3c3c]"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    / month
                  </span>
                </div>

                {/* Quick fee adjuster buttons */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {[
                    { label: '₹600', setVal: 600 },
                    { label: '₹800', setVal: 800 },
                    { label: '₹1000', setVal: 1000 },
                    { label: '₹1200', setVal: 1200 },
                    { label: '₹1500', setVal: 1500 },
                    { label: '-50', delta: -50 },
                    { label: '+50', delta: 50 },
                    { label: '+100', delta: 100 },
                  ].map((btn, bidx) => (
                    <button
                      key={bidx}
                      type="button"
                      onClick={() => {
                        if (btn.setVal !== undefined) {
                          setShiftForm({ ...shiftForm, fee: btn.setVal });
                        } else if (btn.delta !== undefined) {
                          setShiftForm({ ...shiftForm, fee: Math.max(0, shiftForm.fee + btn.delta) });
                        }
                        playSound('pop');
                      }}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {shiftFormError && (
                <div className="p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{shiftFormError}</span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setShiftFormError(null);
                    setShowShiftModal(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingShift}
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase tracking-wider"
                >
                  {savingShift ? 'Saving...' : editingShift ? 'Update Shift' : 'Create Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IN-APP MODAL: Confirm Delete Shift (Replaces unreliable window.confirm) */}
      {shiftToDelete && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-6 sm:p-7 duo-card shadow-2xl relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center border-b-3 border-red-300 font-black text-xl shrink-0">
                <Trash2 className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                  Delete Shift?
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  This action removes this shift from your library schedules
                </p>
              </div>
            </div>

            {/* Shift card snippet */}
            <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display font-black text-base text-[#3c3c3c]">
                  {shiftToDelete.name}
                </span>
                <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-purple-100 text-purple-900 border border-purple-200">
                  ₹{shiftToDelete.fee}/mo
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{shiftToDelete.timing}</span>
              </div>

              {/* Student enrollment warning */}
              {(() => {
                const enrolled = activeStudents.filter((s) =>
                  s.shift.toLowerCase().includes(shiftToDelete.name.toLowerCase())
                ).length;
                if (enrolled > 0) {
                  return (
                    <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        ⚠️ <strong>{enrolled} student(s)</strong> are currently assigned to this shift. You can still delete it, but remember to reassign them to another shift.
                      </span>
                    </div>
                  );
                }
                return (
                  <p className="text-[11px] text-emerald-700 font-bold flex items-center gap-1 mt-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    No students currently assigned to this shift.
                  </p>
                );
              })()}
            </div>

            {shiftDeleteError && (
              <div className="p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{shiftDeleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setShiftDeleteError(null);
                  setShiftToDelete(null);
                }}
                disabled={deletingShift}
                className="px-4 py-2.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteShift}
                disabled={deletingShift}
                className="px-5 py-2.5 rounded-xl text-xs font-black duo-btn-red flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
              >
                <Trash2 className="w-4 h-4 stroke-[2.5]" />
                <span>{deletingShift ? 'Deleting...' : 'Yes, Delete Shift'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: Exit Student & Vacate Seat */}
      {studentToExit && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white border-3 border-red-200 rounded-3xl max-w-md w-full p-6 duo-card shadow-2xl relative">
            <div className="flex items-center gap-3 pb-3 border-b-2 border-slate-100">
              <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center border-b-3 border-red-300 shrink-0">
                <LogOut className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="font-display text-lg font-black text-slate-800">
                  Exit Student &amp; Vacate Seat?
                </h3>
                <p className="text-xs font-bold text-slate-400">
                  Unassign Seat {studentToExit.seat_number} &amp; update status
                </p>
              </div>
            </div>

            <div className="py-4 space-y-2.5">
              {exitStudentError && (
                <div className="p-2.5 rounded-xl bg-red-100 border border-red-300 text-red-700 text-xs font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{exitStudentError}</span>
                </div>
              )}
              <p className="text-sm font-bold text-slate-700">
                Mark <strong className="text-slate-900 font-black">{studentToExit.name}</strong> as exited and vacate their seat?
              </p>
              <p className="text-xs font-bold text-slate-500">
                Seat <span className="font-mono text-[#1899d6]">{studentToExit.seat_number}</span> will immediately become free in the seat occupancy map, their status will be marked exited, and the Master Admin will receive an exit alert.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setExitStudentError(null);
                  setStudentToExit(null);
                }}
                disabled={exitingStudent}
                className="px-4 py-2.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmExitStudent}
                disabled={exitingStudent}
                className="px-5 py-2.5 rounded-xl text-xs font-black duo-btn-red flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
              >
                <LogOut className="w-4 h-4 stroke-[2.5]" />
                <span>{exitingStudent ? 'Vacating...' : 'Confirm Exit'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Add / Edit Student (Ultra-Compact Collapsible Pickers & Editable Fee) */}
      {showAddModal && (() => {
        const availableSeatsForCurrentShift = getAvailableSeatsForShift(studentForm.shift, editingStudent?.id);
        const occupiedSeatsForCurrentShift = allSeatLabels.filter(
          (seat) => !availableSeatsForCurrentShift.includes(seat)
        );
        const vacantCount = availableSeatsForCurrentShift.length;
        const currentSeatOccupancy = studentForm.seat_number
          ? getSeatOccupancyInShift(studentForm.seat_number, studentForm.shift, editingStudent?.id)
          : { isOccupied: false };
        const isCurrentSeatValid =
          Boolean(studentForm.seat_number) && !currentSeatOccupancy.isOccupied;

        const activeShiftLabel = studentForm.shift
          ? studentForm.shift.split('(')[0].trim()
          : 'Select Shift';

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
            <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full duo-card shadow-2xl relative overflow-hidden flex flex-col max-h-[92vh]">
              
              {/* Compact Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-[#58cc02] text-white flex items-center justify-center border-b-2 border-[#46a302] shrink-0">
                    <GraduationCap className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <h3 className="font-display text-base font-black text-[#3c3c3c] truncate">
                    {editingStudent ? 'Edit Student Details' : 'Assign Seat to Student'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer text-sm font-black shrink-0"
                >
                  ✕
                </button>
              </div>

              {/* Clean Compact Form */}
              <form onSubmit={handleSaveStudent} className="overflow-y-auto px-4 py-3 space-y-2.5 flex-1 text-slate-800">
                {studentFormError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2 text-xs font-bold text-red-700">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      <span className="truncate">{studentFormError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStudentFormError(null)}
                      className="text-red-500 font-black cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Row 1: Collapsible Shift Selector + Hidden-by-Default Seat Input */}
                <div className="grid grid-cols-2 gap-2.5 relative">
                  {/* Shift Selector Box */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-black uppercase text-slate-500">
                        Shift *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddModal(false);
                          setShowShiftSliderModal(true);
                        }}
                        className="text-[10px] font-black text-[#8957ff] hover:underline cursor-pointer"
                      >
                        + Shifts
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setIsShiftMenuOpen((o) => !o);
                        setIsSeatPickerOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl border-2 text-left text-xs font-black flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                        isShiftMenuOpen
                          ? 'border-[#58cc02] bg-emerald-50/40 text-[#3c3c3c]'
                          : 'border-[#e5e5e5] bg-white text-[#3c3c3c] hover:border-slate-300'
                      }`}
                    >
                      <span className="truncate">{activeShiftLabel}</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isShiftMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Seat Number Selector Box */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-black uppercase text-slate-500">
                        Seat Number *
                      </label>
                      <span className="text-[10px] font-bold text-[#46a302] tabular-nums">
                        {checkingSeatAvailability ? 'Checking...' : `${vacantCount} free`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setIsSeatPickerOpen((o) => !o);
                        setIsShiftMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl border-2 text-left text-xs font-black flex items-center justify-between gap-1.5 cursor-pointer transition-colors ${
                        isSeatPickerOpen
                          ? 'border-[#58cc02] bg-emerald-50/40 text-[#3c3c3c]'
                          : !isCurrentSeatValid
                          ? 'border-red-300 bg-red-50/50 text-red-700'
                          : 'border-[#e5e5e5] bg-white text-[#3c3c3c] hover:border-slate-300'
                      }`}
                    >
                      <span className="font-mono truncate">
                        {studentForm.seat_number || 'Tap to pick'}
                      </span>
                      <Grid3X3 className="w-3.5 h-3.5 text-[#58cc02] shrink-0" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Shift Dropdown (Only visible when Shift box is tapped) */}
                {isShiftMenuOpen && (
                  <div className="p-2 rounded-2xl bg-slate-50 border-2 border-[#e5e5e5] space-y-1 animate-in fade-in duration-100">
                    {shifts.length > 0 ? (
                      shifts.map((sh) => {
                        const shiftStr = `${sh.name} (${sh.timing})`;
                        const isSelected = studentForm.shift === shiftStr;
                        const freeCount = getAvailableSeatsForShift(shiftStr, editingStudent?.id).length;

                        return (
                          <button
                            key={sh.id}
                            type="button"
                            onClick={() => handleShiftChange(shiftStr)}
                            className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#58cc02] text-white font-black'
                                : 'bg-white text-slate-700 hover:bg-emerald-50 font-bold border border-slate-200/80'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate leading-tight">{sh.name}</div>
                              <div className={`text-[10px] font-mono truncate ${isSelected ? 'text-emerald-100' : 'text-slate-400'}`}>
                                {sh.timing}
                              </div>
                            </div>
                            <div className="text-right shrink-0 tabular-nums">
                              <div className="text-xs font-black">₹{sh.fee}</div>
                              <div className={`text-[10px] ${isSelected ? 'text-emerald-100' : 'text-[#46a302]'}`}>
                                {freeCount} free
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-2 text-xs font-bold text-amber-800">
                        General Shift (Full Day)
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsible Vacant Seat Grid (Hidden by default; opens only when Seat box/icon is tapped) */}
                {isSeatPickerOpen && (
                  <div className="p-2.5 rounded-2xl bg-slate-50 border-2 border-[#e5e5e5] space-y-2 animate-in fade-in duration-100">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-500">
                      <span>Vacant Seats · {activeShiftLabel} ({vacantCount})</span>
                      <button
                        type="button"
                        onClick={() => setIsSeatPickerOpen(false)}
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        Done
                      </button>
                    </div>

                    {occupiedSeatsForCurrentShift.length > 0 && (
                      <p className="text-[10px] font-bold text-red-600 truncate">
                        Occupied (excluded): {occupiedSeatsForCurrentShift.join(', ')}
                      </p>
                    )}

                    {vacantCount === 0 ? (
                      <p className="text-xs font-bold text-red-600 py-1">
                        No vacant seats available in this shift.
                      </p>
                    ) : (
                      <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                        {availableSeatsForCurrentShift.map((seat) => {
                          const isSelected = normalizeSeatLabel(studentForm.seat_number) === seat;
                          return (
                            <button
                              key={seat}
                              type="button"
                              onClick={() => {
                                setStudentForm({ ...studentForm, seat_number: seat });
                                setStudentFormError(null);
                                setIsSeatPickerOpen(false);
                                playSound('pop');
                              }}
                              className={`py-1.5 px-1 rounded-lg text-[11px] font-mono font-black border transition-all cursor-pointer tabular-nums ${
                                isSelected
                                  ? 'bg-[#58cc02] border-[#46a302] text-white shadow-xs'
                                  : 'bg-white border-slate-200 text-slate-700 hover:border-[#58cc02]'
                              }`}
                            >
                              {seat}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Row 2: Editable Monthly Fee + Student Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Monthly Fee (Editable) *
                    </label>
                    <div className="relative">
                      <IndianRupee className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        min="0"
                        required
                        value={studentForm.monthly_fee}
                        onChange={(e) =>
                          setStudentForm({ ...studentForm, monthly_fee: parseInt(e.target.value, 10) || 0 })
                        }
                        className="w-full pl-8 pr-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-black tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Student Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Arjun Mehta"
                      value={studentForm.name}
                      onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                    />
                  </div>
                </div>

                {/* Row 3: WhatsApp Number + Student Pin */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      WhatsApp Number *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. 919876543210"
                      value={studentForm.phone}
                      onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[10px] font-black uppercase text-slate-500">
                        Student Pin
                      </label>
                      <button
                        type="button"
                        onClick={generateRandomStudentPin}
                        className="text-[10px] font-black text-[#1899d6] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Auto</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      placeholder={editingStudent ? '4-digit PIN (e.g. 4821)' : '4-digit PIN (Auto if blank)'}
                      value={studentForm.student_pin}
                      onChange={(e) =>
                        setStudentForm({
                          ...studentForm,
                          student_pin: e.target.value.replace(/[^0-9]/g, '').slice(0, 4),
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono tracking-widest"
                    />
                  </div>
                </div>

                {/* Row 4: Start Date & Valid Till + Quick Duration Chips */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={studentForm.subscription_start}
                      onChange={(e) => setStudentForm({ ...studentForm, subscription_start: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                      Valid Till *
                    </label>
                    <input
                      type="date"
                      required
                      value={studentForm.subscription_end}
                      onChange={(e) => setStudentForm({ ...studentForm, subscription_end: e.target.value })}
                      className="w-full px-2.5 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-black uppercase text-slate-400 mr-0.5">
                    Duration:
                  </span>
                  {[
                    { label: '+1 Mo', months: 1 },
                    { label: '+2 Mo', months: 2 },
                    { label: '+3 Mo', months: 3 },
                    { label: '+6 Mo', months: 6 },
                    { label: '+1 Yr', months: 12 },
                  ].map((dur) => (
                    <button
                      key={dur.label}
                      type="button"
                      onClick={() => applyDurationMonths(dur.months)}
                      className="px-2 py-1 rounded-lg text-[10px] font-black bg-slate-100 hover:bg-sky-50 hover:text-[#1899d6] text-slate-600 transition-colors cursor-pointer"
                    >
                      {dur.label}
                    </button>
                  ))}
                </div>

                {/* Row 5: Optional Notes */}
                <div>
                  <input
                    type="text"
                    placeholder="Notes / Exam Prep (optional, e.g. UPSC, NEET)"
                    value={studentForm.notes}
                    onChange={(e) => setStudentForm({ ...studentForm, notes: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>

                {/* Compact Footer */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isCurrentSeatValid || !studentForm.name.trim()}
                    className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wide flex items-center gap-1.5 cursor-pointer ${
                      isCurrentSeatValid && studentForm.name.trim()
                        ? 'duo-btn-green'
                        : 'bg-slate-200 text-slate-400 border-2 border-slate-300 cursor-not-allowed opacity-60'
                    }`}
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>{editingStudent ? 'Save Changes' : 'Assign Seat'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* MODAL 4: Interactive Slide-Based Shifts Popup (Centered Responsive Square Cards & Swipe Navigation) */}
      {showShiftSliderModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-4 sm:p-5 duo-card shadow-2xl relative flex flex-col max-h-[92dvh] overflow-hidden">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b-2 border-slate-100 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#ce82ff] text-white flex items-center justify-center border-b-3 border-[#a855f7] font-black text-base shadow-xs shrink-0">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                      Active Shifts
                    </h3>
                    {shifts.length > 0 && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-[#ce82ff]/15 text-[#a855f7] border border-[#ce82ff]/30 tabular-nums shrink-0">
                        {Math.min(shifts.length, currentSlideIndex + 1)}/{shifts.length}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-semibold text-slate-500 truncate">
                    {shifts.length > 1
                      ? 'Swipe card or tap dots to navigate shifts'
                      : 'Active shift timings & pricing'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShiftSwipeDir(null);
                  setTouchStartX(null);
                  setTouchStartY(null);
                  setShowShiftSliderModal(false);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer text-lg font-black shrink-0"
                title="Close popup"
              >
                ✕
              </button>
            </div>

            {/* Slider Content Area */}
            {shifts.length === 0 ? (
              <div className="py-8 px-4 text-center my-auto">
                <MascotOwl mood="studying" size={76} className="mx-auto mb-3" />
                <h4 className="font-display text-lg font-black text-[#3c3c3c]">
                  No Custom Shifts Yet
                </h4>
                <p className="text-xs font-semibold text-slate-500 max-w-xs mx-auto mt-1 mb-4">
                  Configure your library&apos;s first shift (such as Morning 7 AM - 1 PM or Full Day) with custom fees.
                </p>
                <button
                  type="button"
                  onClick={() => handleOpenAddShiftModal()}
                  className="px-6 py-2.5 rounded-2xl text-xs font-black duo-btn-purple inline-flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Create First Shift</span>
                </button>
              </div>
            ) : (() => {
              const safeIndex = Math.min(Math.max(0, currentSlideIndex), shifts.length - 1);
              const currentShift = shifts[safeIndex];
              const theme = getShiftTheme(currentShift.name);
              const ShiftIcon = theme.icon;

              const enrolledStudents = activeStudents.filter((s) =>
                s.shift.toLowerCase().includes(currentShift.name.toLowerCase())
              );

              const shiftAnimationClass =
                shiftSwipeDir === 'left'
                  ? 'animate-in fade-in slide-in-from-right-6 duration-200'
                  : shiftSwipeDir === 'right'
                  ? 'animate-in fade-in slide-in-from-left-6 duration-200'
                  : '';

              return (
                <>
                  {/* Centered Shift Quick Switcher Tabs */}
                  <div className="flex items-center justify-center flex-wrap gap-1.5 py-2 shrink-0">
                    {shifts.map((sh, idx) => {
                      const isActive = idx === safeIndex;
                      return (
                        <button
                          key={sh.id}
                          type="button"
                          onClick={() => {
                            playSound('pop');
                            setShiftSwipeDir(idx > safeIndex ? 'left' : idx < safeIndex ? 'right' : null);
                            setCurrentSlideIndex(idx);
                          }}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                            isActive
                              ? 'bg-[#3c3c3c] text-white border-[#3c3c3c] shadow-xs'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span className="truncate max-w-[120px]">{sh.name}</span>
                          <span className={isActive ? 'text-purple-200' : 'text-slate-400'}>
                            ₹{sh.fee}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Centered Responsive Swipeable Card Stage (Dynamic Height, No Outer Clipping) */}
                  <div
                    className="w-full py-0.5 flex-1 min-h-0 flex items-center justify-center overflow-x-hidden"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={handleShiftMouseDown}
                    onMouseUp={handleShiftMouseUp}
                    onMouseLeave={() => {
                      setTouchStartX(null);
                      setTouchStartY(null);
                    }}
                  >
                    <div
                      key={currentShift.id}
                      className={`w-full max-h-full rounded-3xl p-4 sm:p-5 border-2 ${theme.border} bg-gradient-to-br ${theme.bg} flex flex-col justify-between gap-2.5 select-none overflow-hidden ${
                        shifts.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
                      } ${shiftAnimationClass}`}
                    >
                      {/* Slide Card Header */}
                      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-200/70 shrink-0 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl ${theme.iconBg} text-white flex items-center justify-center border-b-2 shadow-xs shrink-0`}>
                            <ShiftIcon className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg border ${theme.badgeBg}`}>
                              {theme.tag}
                            </span>
                            <h4 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] mt-0.5 leading-tight truncate">
                              {currentShift.name}
                            </h4>
                          </div>
                        </div>

                        {/* Price Badge */}
                        <div className="text-right shrink-0 bg-white/95 px-2.5 sm:px-3 py-1 rounded-2xl border border-slate-200 shadow-2xs">
                          <span className="text-[9px] font-black uppercase text-slate-400 block leading-tight">
                            Monthly Fee
                          </span>
                          <div className="font-display text-base sm:text-lg font-black text-[#3c3c3c] flex items-center justify-end gap-0.5 leading-tight">
                            <span className="text-xs font-bold text-slate-500">₹</span>
                            <span className="tabular-nums">{currentShift.fee}</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle Content: Timings + Scrollable Enrolled Members */}
                      <div className="flex-1 min-h-0 flex flex-col gap-2 min-w-0">
                        {/* Timing Row */}
                        <div className="px-3 py-2 bg-white/90 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-2 min-w-0 shrink-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <Clock className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                            <span className="text-xs font-black font-mono text-slate-800 truncate">
                              {currentShift.timing}
                            </span>
                          </div>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                            ● ACTIVE
                          </span>
                        </div>

                        {/* Enrolled Students Overview (Only List Section Scrolls Vertically When Long) */}
                        <div className="flex-1 min-h-0 flex flex-col p-2.5 sm:p-3 bg-white/85 rounded-2xl border border-slate-200/80 min-w-0">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-600 mb-1.5 shrink-0">
                            <span className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span>Enrolled Members</span>
                            </span>
                            <span className="font-black text-[#3c3c3c] tabular-nums">
                              {enrolledStudents.length} {enrolledStudents.length === 1 ? 'Student' : 'Students'}
                            </span>
                          </div>

                          {enrolledStudents.length > 0 ? (
                            <div className="flex-1 min-h-0 max-h-28 sm:max-h-36 overflow-y-auto overscroll-contain pr-0.5 flex flex-wrap content-start gap-1.5">
                              {enrolledStudents.map((st) => (
                                <span
                                  key={st.id}
                                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 shadow-2xs truncate max-w-[155px]"
                                  title={`Seat ${st.seat_number} · ${st.name}`}
                                >
                                  Seat {st.seat_number} · {st.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] font-semibold text-slate-400 italic py-0.5">
                              No students currently assigned to this shift.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Card Actions (Edit & Delete - Always Visible) */}
                      <div className="pt-2.5 border-t border-slate-200/60 flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenEditShiftModal(currentShift)}
                          className="flex-1 py-2 px-3 rounded-xl text-xs font-black duo-btn-white flex items-center justify-center gap-1.5 cursor-pointer text-slate-700 hover:text-[#1899d6] min-h-[38px]"
                          title="Edit shift timings or fee"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#1cb0f6] shrink-0" />
                          <span className="truncate">Edit Details &amp; Fee</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleInitiateDeleteShift(currentShift)}
                          className="py-2 px-3 rounded-xl text-xs font-black duo-btn-white flex items-center justify-center gap-1.5 cursor-pointer text-red-600 hover:text-red-700 min-h-[38px] shrink-0"
                          title="Delete this shift"
                          aria-label={`Delete ${currentShift.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Clean Bottom Dot Indicators */}
                  {shifts.length > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-2.5 shrink-0">
                      {shifts.map((sh, idx) => (
                        <button
                          key={sh.id}
                          type="button"
                          onClick={() => {
                            playSound('pop');
                            setShiftSwipeDir(idx > safeIndex ? 'left' : idx < safeIndex ? 'right' : null);
                            setCurrentSlideIndex(idx);
                          }}
                          className={`h-2.5 rounded-full transition-all cursor-pointer ${
                            idx === safeIndex
                              ? 'w-7 bg-[#ce82ff]'
                              : 'w-2.5 bg-slate-300 hover:bg-slate-400'
                          }`}
                          aria-label={`View ${sh.name}`}
                          title={`Go to slide ${idx + 1}: ${sh.name}`}
                        />
                      ))}
                    </div>
                  )}

                  {/* Clean Footer Action */}
                  <div className="pt-2.5 mt-2.5 border-t-2 border-slate-100 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenAddShiftModal()}
                      className="w-full py-2.5 px-4 rounded-2xl text-xs font-black duo-btn-purple flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider"
                    >
                      <Plus className="w-4 h-4 stroke-[3]" />
                      <span>Add New Shift</span>
                    </button>
                  </div>
                </>
              );
            })()}

          </div>
        </div>
      )}

      {/* MODAL 5: Multi-Shift Seat Card Modal (Centered Cards & Mutually Exclusive Shifts) */}
      {selectedSeatForDetails && (() => {
        const seatLabel = selectedSeatForDetails;
        const slides = getSeatSlides(seatLabel, students);
        const totalSlides = slides.length;
        const safeIdx = Math.min(Math.max(0, seatSlideIndex), Math.max(0, totalSlides - 1));
        const activeSlide = slides[safeIdx];
        if (!activeSlide) return null;

        const theme = getShiftTheme(activeSlide.shiftName);
        const ShiftIcon = theme.icon;

        const goPrevSeatSlide = () => {
          if (totalSlides <= 1) return;
          playSound('pop');
          setSeatSwipeDir('right');
          setSeatSlideIndex((prev) => (prev > 0 ? prev - 1 : totalSlides - 1));
        };

        const goNextSeatSlide = () => {
          if (totalSlides <= 1) return;
          playSound('pop');
          setSeatSwipeDir('left');
          setSeatSlideIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : 0));
        };

        const handleSeatTouchStart = (e: React.TouchEvent) => {
          setSeatTouchStartX(e.targetTouches[0].clientX);
        };

        const handleSeatTouchEnd = (e: React.TouchEvent) => {
          if (seatTouchStartX === null) return;
          const diff = seatTouchStartX - e.changedTouches[0].clientX;
          if (diff > 36) goNextSeatSlide();
          else if (diff < -36) goPrevSeatSlide();
          setSeatTouchStartX(null);
        };

        const handleSeatMouseDown = (e: React.MouseEvent) => {
          // Ignore mouse drag start when clicking interactive buttons or links
          const target = e.target as HTMLElement | null;
          if (target?.closest('button, a')) return;
          setSeatTouchStartX(e.clientX);
        };

        const handleSeatMouseUp = (e: React.MouseEvent) => {
          if (seatTouchStartX === null) return;
          const diff = seatTouchStartX - e.clientX;
          if (diff > 40) goNextSeatSlide();
          else if (diff < -40) goPrevSeatSlide();
          setSeatTouchStartX(null);
        };

        const occupiedSlotsCount = slides.filter((sl) => Boolean(sl.student)).length;
        const slideAnimationClass =
          seatSwipeDir === 'left'
            ? 'animate-in fade-in slide-in-from-right-6 duration-200'
            : seatSwipeDir === 'right'
            ? 'animate-in fade-in slide-in-from-left-6 duration-200'
            : '';

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150">
            <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-5 sm:p-6 duo-card shadow-2xl relative flex flex-col max-h-[92vh] overflow-x-hidden overflow-y-auto">
              
              {/* Modal Header */}
              <div className="flex items-center justify-between gap-2 pb-3 border-b-2 border-slate-100 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-[#1cb0f6] text-white flex items-center justify-center border-b-3 border-[#1899d6] font-display font-black text-sm shrink-0">
                    {seatLabel}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                        Seat {seatLabel}
                      </h3>
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 tabular-nums shrink-0">
                        {occupiedSlotsCount}/{totalSlides} booked
                      </span>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-500 truncate">
                      {totalSlides > 1 ? 'Swipe card or tap dots to switch shifts' : 'Active shift allocation'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSeatSwipeDir(null);
                    setSelectedSeatForDetails(null);
                  }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer text-lg font-black shrink-0"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              {/* Centered Shift Quick Switcher Tabs (No Horizontal Scrolling) */}
              <div className="flex items-center justify-center flex-wrap gap-1.5 py-2.5 shrink-0">
                {slides.map((sl, idx) => {
                  const isActive = idx === safeIdx;
                  const isTaken = Boolean(sl.student);
                  return (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setSeatSwipeDir(idx > safeIdx ? 'left' : idx < safeIdx ? 'right' : null);
                        setSeatSlideIndex(idx);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-[11px] font-black border transition-all cursor-pointer flex items-center gap-1.5 ${
                        isActive
                          ? 'bg-[#3c3c3c] text-white border-[#3c3c3c] shadow-xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isTaken ? 'bg-[#1cb0f6]' : 'bg-[#58cc02]'
                        }`}
                      />
                      <span className="truncate max-w-[140px]">{sl.shiftName}</span>
                    </button>
                  );
                })}
              </div>

              {/* Full-Width Square-Proportioned Swipeable Card Stage (No Side Arrows) */}
              <div
                className="w-full py-1 flex-1 min-h-0 flex items-center justify-center overflow-hidden"
                onTouchStart={handleSeatTouchStart}
                onTouchEnd={handleSeatTouchEnd}
                onMouseDown={handleSeatMouseDown}
                onMouseUp={handleSeatMouseUp}
                onMouseLeave={() => setSeatTouchStartX(null)}
              >
                <div
                  key={activeSlide.id}
                  className={`w-full rounded-3xl p-5 sm:p-6 border-2 ${theme.border} bg-gradient-to-br ${theme.bg} flex flex-col justify-between min-h-[295px] sm:min-h-[315px] select-none ${
                    totalSlides > 1 ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${slideAnimationClass}`}
                >
                  {/* Card Top: Shift Header + Status / Quick Edit */}
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl ${theme.iconBg} text-white flex items-center justify-center border-b-2 shrink-0`}>
                        <ShiftIcon className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-display text-base font-black text-[#3c3c3c] truncate leading-tight">
                          {activeSlide.shiftName}
                        </h4>
                        <p className="text-[11px] font-mono font-bold text-slate-500 truncate">
                          {activeSlide.shiftTiming}
                        </p>
                      </div>
                    </div>

                    {activeSlide.student ? (
                      <button
                        type="button"
                        onClick={() => {
                          const targetStudent = activeSlide.student!;
                          setSelectedSeatForDetails(null);
                          handleEditClick(targetStudent);
                        }}
                        className="w-9 h-9 rounded-xl duo-btn-white text-[#1899d6] hover:text-[#1cb0f6] flex items-center justify-center shrink-0 cursor-pointer"
                        title={`Edit ${activeSlide.student.name}`}
                        aria-label={`Edit ${activeSlide.student.name}`}
                      >
                        <Pencil className="w-4 h-4 stroke-[2.5]" />
                      </button>
                    ) : (
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase shrink-0">
                        Vacant
                      </span>
                    )}
                  </div>

                  {/* Card Body: Occupied Student Details OR Direct Assignment */}
                  {activeSlide.student ? (() => {
                    const st = activeSlide.student!;
                    const daysLeft = calculateDaysRemaining(st.subscription_end);
                    const isExp = daysLeft < 0;
                    const isExpiring = daysLeft >= 0 && daysLeft <= 2;

                    const rawNotes = st.notes || '';
                    const feeMatch = rawNotes.match(/Fee:\s*₹(\d+)/i);
                    const studentFee = feeMatch ? Number(feeMatch[1]) : activeSlide.shiftFee;
                    const cleanNotes = stripSystemNoteTags(rawNotes);

                    const waUrl = generateWhatsAppBlankChatUrl(st.phone);
                    const callUrl = generatePhoneCallUrl(st.phone);

                    return (
                      <div className="flex-1 flex flex-col justify-between gap-3 pt-3 min-w-0">
                        <div className="bg-white/90 rounded-2xl p-3.5 border border-slate-200/80 space-y-2.5 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[10px] font-black uppercase text-slate-400 block">
                                Assigned Student
                              </span>
                              <h5 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                                {st.name}
                              </h5>
                            </div>
                            <span
                              className={`text-[10px] font-black px-2 py-1 rounded-lg uppercase shrink-0 tabular-nums ${
                                isExp
                                  ? 'bg-red-100 text-red-700 border border-red-200'
                                  : isExpiring
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {isExp ? 'Expired' : daysLeft === 0 ? 'Today' : `${daysLeft}d left`}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-100">
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-slate-400 block">Phone</span>
                              <span className="font-mono font-bold text-slate-700 flex items-center gap-1 truncate">
                                <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="truncate">{st.phone}</span>
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-slate-400 block">Student Pin</span>
                              <div className="flex items-center gap-1">
                                <span className="font-mono font-black text-[#1899d6] tracking-wider">
                                  {studentPinMap[st.id] || '—'}
                                </span>
                                {studentPinMap[st.id] && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                                        void navigator.clipboard.writeText(studentPinMap[st.id]);
                                        playSound('pop');
                                        setCopiedSeatPin(st.id);
                                        setTimeout(() => setCopiedSeatPin(null), 1500);
                                      }
                                    }}
                                    className="text-[9px] font-black text-slate-400 hover:text-[#1899d6] cursor-pointer"
                                  >
                                    {copiedSeatPin === st.id ? 'Copied' : 'Copy'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-slate-400 block">Monthly Fee</span>
                              <span className="font-black text-[#3c3c3c] tabular-nums">
                                ₹{studentFee}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-100">
                            <span className="font-bold text-slate-500 flex items-center gap-1 shrink-0">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              Validity
                            </span>
                            <span className="font-bold text-slate-700 truncate text-right">
                              {formatFriendlyDate(st.subscription_start)} – {formatFriendlyDate(st.subscription_end)}
                            </span>
                          </div>

                          {cleanNotes && (
                            <p className="text-[11px] font-semibold text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-xl truncate">
                              Note: {cleanNotes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <a
                            href={callUrl}
                            className="py-2.5 px-2.5 rounded-xl text-xs font-black duo-btn-blue flex items-center justify-center gap-1 cursor-pointer"
                            title={`Call ${st.name}`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Call</span>
                          </a>
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 py-2.5 px-3 rounded-xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <MessageCircle className="w-4 h-4 fill-white" />
                            <span>WhatsApp</span>
                          </a>
                          {(isExp || isExpiring) && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSeatForDetails(null);
                                void handleOpenRenewModal(st);
                              }}
                              className="py-2.5 px-3 rounded-xl text-xs font-black duo-btn-green flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                              title={`Renew ${st.name}`}
                            >
                              <RefreshCw className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Renew</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSeatForDetails(null);
                              handleEditClick(st);
                            }}
                            className="py-2.5 px-2.5 rounded-xl text-xs font-black duo-btn-white text-[#1899d6] flex items-center justify-center gap-1 cursor-pointer"
                            title={`Edit ${st.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSeatForDetails(null);
                              handleExitStudentClick(st);
                            }}
                            className="py-2.5 px-2.5 rounded-xl text-xs font-black duo-btn-red flex items-center justify-center gap-1 cursor-pointer"
                            title={`Exit & Vacate Seat ${st.seat_number}`}
                          >
                            <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="flex-1 flex flex-col justify-between gap-3 pt-3 min-w-0">
                      <div className="bg-white/90 rounded-2xl p-4 border border-emerald-200 text-center space-y-1.5 my-auto">
                        <CheckCircle2 className="w-9 h-9 text-[#58cc02] mx-auto" />
                        <h5 className="font-display text-base font-black text-[#3c3c3c]">
                          Seat {seatLabel} is Free!
                        </h5>
                        <p className="text-xs font-semibold text-slate-500">
                          No student is currently assigned for{' '}
                          <span className="font-bold text-slate-700">{activeSlide.shiftName}</span>
                          {activeSlide.shiftFee > 0 ? ` (₹${activeSlide.shiftFee}/mo)` : ''}.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const targetShift = activeSlide.shiftFullString;
                          setSelectedSeatForDetails(null);
                          handleOpenAddModal(seatLabel, targetShift);
                        }}
                        className="w-full py-3 px-4 rounded-2xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wide"
                      >
                        <Plus className="w-4 h-4 stroke-[3]" />
                        <span>Assign for {activeSlide.shiftName}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Clean Bottom Dot Indicators */}
              {totalSlides > 1 && (
                <div className="flex items-center justify-center gap-2 pt-3 shrink-0">
                  {slides.map((sl, idx) => (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setSeatSwipeDir(idx > safeIdx ? 'left' : idx < safeIdx ? 'right' : null);
                        setSeatSlideIndex(idx);
                      }}
                      className={`h-2.5 rounded-full transition-all cursor-pointer ${
                        idx === safeIdx ? 'w-7 bg-[#1cb0f6]' : 'w-2.5 bg-slate-300 hover:bg-slate-400'
                      }`}
                      aria-label={`View ${sl.shiftName}`}
                    />
                  ))}
                </div>
              )}

            </div>
          </div>
        );
      })()}

      {/* MODAL 6: Instant Broadcast Submission Confirmation Popup */}
      {showBroadcastSuccessModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
          <div className="bg-white border-3 border-[#58cc02]/40 rounded-3xl max-w-sm w-full p-6 duo-card shadow-2xl text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-2xl bg-[#58cc02] text-white flex items-center justify-center border-b-4 border-[#46a302] mx-auto shadow-sm">
              <CheckCircle2 className="w-8 h-8 stroke-[2.5]" />
            </div>

            <div className="space-y-1.5">
              <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                Message Submitted!
              </h3>
              <p className="text-xs sm:text-sm font-semibold text-slate-600 leading-relaxed">
                Your message has been submitted and will be broadcasted to students by the admin within a few hours.
              </p>
            </div>

            {lastSubmittedBroadcast && (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-left">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Queued Notice
                </span>
                <p className="text-xs font-semibold text-slate-700 line-clamp-3 whitespace-pre-wrap">
                  {lastSubmittedBroadcast}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowBroadcastSuccessModal(false)}
              className="w-full py-2.5 px-4 rounded-2xl text-xs font-black duo-btn-green uppercase tracking-wider cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* MODAL 7: Filter by Shift Popup (Bottom-sheet on mobile, Centered Modal on desktop) */}
      {showShiftFilterModal && (
        <div
          className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setShowShiftFilterModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-filter-modal-title"
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-[#e5e5e5] shadow-2xl p-4 sm:p-6 space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto sm:hidden" />

            {/* Soft Header */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="min-w-0">
                <h3
                  id="shift-filter-modal-title"
                  className="font-display text-base sm:text-lg font-black text-[#3c3c3c] leading-tight"
                >
                  Filter by Shift
                </h3>
                <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                  Choose a batch to view matching students
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setShowShiftFilterModal(false);
                }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer transition-colors shrink-0"
                aria-label="Close shift filter"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Interactive Shift Option Cards */}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-0.5 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
              {/* Option: All Shifts */}
              <button
                type="button"
                onClick={() => {
                  playSound('pop');
                  setShiftFilter('all');
                  setStudentPage(0);
                  setShowShiftFilterModal(false);
                }}
                className={`w-full p-3.5 rounded-2xl border-2 flex items-center justify-between gap-3 text-left transition-all cursor-pointer min-h-[60px] ${
                  shiftFilter === 'all'
                    ? 'border-[#15803d] bg-emerald-50/75 shadow-xs'
                    : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                      shiftFilter === 'all'
                        ? 'bg-[#15803d] text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div
                      className={`font-display text-sm font-black truncate ${
                        shiftFilter === 'all' ? 'text-[#14532d]' : 'text-[#3c3c3c]'
                      }`}
                    >
                      All Shifts
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500 truncate mt-0.5 tabular-nums">
                      All active batches · {activeStudents.length} student{activeStudents.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                {shiftFilter === 'all' && (
                  <div className="w-6 h-6 rounded-full bg-[#15803d] text-white ring-4 ring-[#15803d]/15 flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </button>

              {/* Dynamic Shift Cards */}
              {shifts.map((sh) => {
                const isSelected = shiftFilter.toLowerCase() === sh.name.toLowerCase();
                const theme = getShiftTheme(sh.name);
                const ShiftIcon = theme.icon;
                const shiftCount = activeStudents.filter((s) =>
                  s.shift.toLowerCase().includes(sh.name.toLowerCase())
                ).length;

                return (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setShiftFilter(sh.name);
                      setStudentPage(0);
                      setShowShiftFilterModal(false);
                    }}
                    className={`w-full p-3.5 rounded-2xl border-2 flex items-center justify-between gap-3 text-left transition-all cursor-pointer min-h-[60px] ${
                      isSelected
                        ? 'border-[#15803d] bg-emerald-50/75 shadow-xs'
                        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#15803d] text-white'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <ShiftIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div
                          className={`font-display text-sm font-black truncate ${
                            isSelected ? 'text-[#14532d]' : 'text-[#3c3c3c]'
                          }`}
                        >
                          {sh.name}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-500 truncate mt-0.5 tabular-nums">
                          {sh.timing} · {shiftCount} student{shiftCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-[#15803d] text-white ring-4 ring-[#15803d]/15 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 8: Magic Wand AI Notice Generator */}
      {showMagicWandModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
          onClick={() => !generatingMagicNotice && setShowMagicWandModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="magic-wand-modal-title"
        >
          <form
            onSubmit={handleGenerateMagicNotice}
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-[#e5e5e5] shadow-2xl p-4 sm:p-6 space-y-4 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto sm:hidden" />

            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-xs shrink-0">
                  <Wand2 className="w-5 h-5 stroke-[2.3]" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="magic-wand-modal-title"
                    className="font-display text-base sm:text-lg font-black text-[#3c3c3c] leading-tight truncate"
                  >
                    Magic Notice Writer
                  </h3>
                  <p className="text-[11px] font-semibold text-slate-400 truncate mt-0.5">
                    Pick details below to draft a ready-to-send notice
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={generatingMagicNotice}
                onClick={() => setShowMagicWandModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer transition-colors shrink-0 disabled:opacity-50"
                aria-label="Close Magic Notice Writer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {magicWandError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{magicWandError}</span>
              </div>
            )}

            {/* 1. Category Dropdown */}
            <div className="space-y-1">
              <label
                htmlFor="magic-category"
                className="block text-[11px] font-black uppercase tracking-wider text-slate-500"
              >
                Category
              </label>
              <select
                id="magic-category"
                value={magicCategory}
                onChange={(e) => setMagicCategory(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs sm:text-sm font-bold text-[#3c3c3c] bg-white cursor-pointer"
              >
                <option value="Festival">Festival / Holiday</option>
                <option value="Maintenance">Maintenance / Repairs</option>
                <option value="Cleaning">Cleaning / Sanitization</option>
                <option value="Emergency">Emergency / Urgent Notice</option>
                <option value="General Notice">General Notice</option>
              </select>
            </div>

            {/* 2. Event / Reason Input */}
            <div className="space-y-1">
              <label
                htmlFor="magic-reason"
                className="block text-[11px] font-black uppercase tracking-wider text-slate-500"
              >
                Event / Reason *
              </label>
              <input
                id="magic-reason"
                type="text"
                required
                placeholder="e.g. Chhath Puja, Diwali, Water Tank Cleaning"
                value={magicReason}
                onChange={(e) => {
                  setMagicReason(e.target.value);
                  if (magicWandError) setMagicWandError(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs sm:text-sm font-bold text-[#3c3c3c] bg-white"
              />
            </div>

            {/* 3. Date & Time Mode + Inputs */}
            <div className="space-y-2">
              <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500">
                Date &amp; Time
              </span>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'single', label: 'Single Date' },
                    { id: 'range', label: 'Date Range' },
                    { id: 'hours', label: 'Specific Hours' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setMagicScheduleMode(mode.id);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] sm:text-[11px] font-black transition-all cursor-pointer truncate ${
                      magicScheduleMode === mode.id
                        ? 'bg-white text-[#3c3c3c] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {magicScheduleMode === 'single' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">
                    Select Date
                  </label>
                  <input
                    type="date"
                    value={magicSingleDate}
                    onChange={(e) => setMagicSingleDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                  />
                </div>
              )}

              {magicScheduleMode === 'range' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={magicFromDate}
                      onChange={(e) => setMagicFromDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={magicToDate}
                      onChange={(e) => setMagicToDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                    />
                  </div>
                </div>
              )}

              {magicScheduleMode === 'hours' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={magicHoursDate}
                      onChange={(e) => setMagicHoursDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">
                        From Time
                      </label>
                      <input
                        type="time"
                        value={magicStartTime}
                        onChange={(e) => setMagicStartTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">
                        To Time
                      </label>
                      <input
                        type="time"
                        value={magicEndTime}
                        onChange={(e) => setMagicEndTime(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold text-[#3c3c3c] bg-white tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                disabled={generatingMagicNotice}
                onClick={() => setShowMagicWandModal(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[42px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={generatingMagicNotice}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer uppercase min-h-[42px] disabled:opacity-70"
              >
                {generatingMagicNotice ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate Message</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 8: Dedicated Student Subscription Renewal (Pre-filled & Editable + Master Admin Sync) */}
      {renewStudentTarget && (() => {
        const currentDaysLeft = calculateDaysRemaining(renewStudentTarget.subscription_end);
        const currentShiftShort = renewStudentTarget.shift.split('(')[0].trim();
        const availableSeatsForRenewShift = getAvailableSeatsForShift(
          renewForm.shift,
          renewStudentTarget.id
        );
        const occupiedSeatsForRenewShift = allSeatLabels.filter(
          (seat) => !availableSeatsForRenewShift.includes(seat)
        );
        const renewVacantCount = availableSeatsForRenewShift.length;
        const currentRenewSeatOccupancy = renewForm.seat_number
          ? getSeatOccupancyInShift(renewForm.seat_number, renewForm.shift, renewStudentTarget.id)
          : { isOccupied: false };
        const isRenewSeatValid =
          Boolean(renewForm.seat_number) && !currentRenewSeatOccupancy.isOccupied;
        const activeRenewShiftLabel = renewForm.shift
          ? renewForm.shift.split('(')[0].trim()
          : 'Select Shift';

        return (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
            onClick={() => !renewingStudent && setRenewStudentTarget(null)}
          >
            <div
              className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full duo-card shadow-2xl relative overflow-hidden flex flex-col max-h-[92vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#58cc02] text-white flex items-center justify-center border-b-2 border-[#46a302] shrink-0">
                    <RefreshCw className="w-4 h-4 stroke-[2.5]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-black text-[#3c3c3c] truncate">
                      Renew Subscription
                    </h3>
                    <p className="text-[11px] font-bold text-slate-500 truncate">
                      {renewStudentTarget.name} · Seat {renewStudentTarget.seat_number}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={renewingStudent}
                  onClick={() => setRenewStudentTarget(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  aria-label="Close renewal popup"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                onSubmit={handleConfirmRenewal}
                className="overflow-y-auto px-4 py-3 space-y-3 flex-1 text-slate-800"
              >
                {/* Current Subscription Snapshot (Pre-filled Reference) */}
                <div className="px-3 py-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Current Plan
                    </span>
                    <span
                      className={`text-[11px] font-black tabular-nums ${
                        currentDaysLeft < 0
                          ? 'text-red-600'
                          : currentDaysLeft <= 2
                          ? 'text-amber-600'
                          : 'text-[#46a302]'
                      }`}
                    >
                      {currentDaysLeft < 0
                        ? `Expired ${Math.abs(currentDaysLeft)}d ago`
                        : currentDaysLeft === 0
                        ? 'Expires Today'
                        : `${currentDaysLeft} days left`}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-700 truncate tabular-nums">
                    <span>Seat {renewStudentTarget.seat_number}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{currentShiftShort}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Ends {formatFriendlyDate(renewStudentTarget.subscription_end)}</span>
                  </div>
                </div>

                {renewFormError && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2 text-xs font-bold text-red-700">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      <span>{renewFormError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRenewFormError(null)}
                      className="text-red-500 font-black cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* 1-Tap Renewal Duration Selector */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Renewal Plan Duration
                    </label>
                    <span className="text-[10px] font-bold text-[#46a302] tabular-nums">
                      New validity: {formatFriendlyDate(renewForm.subscription_end)}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: '1 Mo', months: 1 },
                      { label: '2 Mo', months: 2 },
                      { label: '3 Mo', months: 3 },
                      { label: '6 Mo', months: 6 },
                      { label: '1 Yr', months: 12 },
                    ].map((opt) => {
                      const active = renewForm.plan_months === opt.months;
                      return (
                        <button
                          key={opt.months}
                          type="button"
                          onClick={() => applyRenewDurationMonths(opt.months)}
                          className={`py-2 px-1 rounded-xl text-xs font-black transition-all cursor-pointer border-2 whitespace-nowrap ${
                            active
                              ? 'bg-[#58cc02] border-[#46a302] text-white shadow-xs'
                              : 'bg-white border-[#e5e5e5] text-slate-700 hover:border-[#58cc02]/60'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Editable Shift & Seat Details */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Shift (Editable)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setIsRenewShiftMenuOpen((o) => !o);
                        setIsRenewSeatPickerOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl border-2 text-left text-xs font-black flex items-center justify-between gap-1.5 cursor-pointer transition-colors min-h-[40px] ${
                        isRenewShiftMenuOpen
                          ? 'border-[#58cc02] bg-emerald-50/40 text-[#3c3c3c]'
                          : 'border-[#e5e5e5] bg-white text-[#3c3c3c] hover:border-slate-300'
                      }`}
                    >
                      <span className="truncate">{activeRenewShiftLabel}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
                          isRenewShiftMenuOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Seat (Editable)
                      </label>
                      <span className="text-[10px] font-bold text-[#46a302] tabular-nums">
                        {checkingSeatAvailability ? 'Checking...' : `${renewVacantCount} free`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setIsRenewSeatPickerOpen((o) => !o);
                        setIsRenewShiftMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2 rounded-xl border-2 text-left text-xs font-black flex items-center justify-between gap-1.5 cursor-pointer transition-colors min-h-[40px] ${
                        isRenewSeatPickerOpen
                          ? 'border-[#58cc02] bg-emerald-50/40 text-[#3c3c3c]'
                          : !isRenewSeatValid
                          ? 'border-red-300 bg-red-50/50 text-red-700'
                          : 'border-[#e5e5e5] bg-white text-[#3c3c3c] hover:border-slate-300'
                      }`}
                    >
                      <span className="font-mono truncate">
                        {renewForm.seat_number || 'Tap to pick'}
                      </span>
                      <Grid3X3 className="w-3.5 h-3.5 text-[#58cc02] shrink-0" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Shift Switcher */}
                {isRenewShiftMenuOpen && (
                  <div className="p-2 rounded-2xl bg-slate-50 border-2 border-[#e5e5e5] space-y-1 animate-in fade-in duration-100">
                    {shifts.length > 0 ? (
                      shifts.map((sh) => {
                        const shiftStr = `${sh.name} (${sh.timing})`;
                        const isSelected = renewForm.shift === shiftStr;
                        const freeCount = getAvailableSeatsForShift(
                          shiftStr,
                          renewStudentTarget.id
                        ).length;

                        return (
                          <button
                            key={sh.id}
                            type="button"
                            onClick={() => void handleRenewShiftChange(shiftStr)}
                            className={`w-full px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#58cc02] text-white font-black'
                                : 'bg-white text-slate-700 hover:bg-emerald-50 font-bold border border-slate-200/80'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate leading-tight">{sh.name}</div>
                              <div
                                className={`text-[10px] font-mono truncate ${
                                  isSelected ? 'text-emerald-100' : 'text-slate-400'
                                }`}
                              >
                                {sh.timing}
                              </div>
                            </div>
                            <div className="text-right shrink-0 tabular-nums">
                              <div className="text-xs font-black">₹{sh.fee}</div>
                              <div
                                className={`text-[10px] ${
                                  isSelected ? 'text-emerald-100' : 'text-[#46a302]'
                                }`}
                              >
                                {freeCount} free
                              </div>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-2 text-xs font-bold text-amber-800">
                        General Shift (Full Day)
                      </div>
                    )}
                  </div>
                )}

                {/* Collapsible Vacant Seat Grid */}
                {isRenewSeatPickerOpen && (
                  <div className="p-2.5 rounded-2xl bg-slate-50 border-2 border-[#e5e5e5] space-y-2 animate-in fade-in duration-100">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-500">
                      <span>
                        Available Seats · {activeRenewShiftLabel} ({renewVacantCount})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsRenewSeatPickerOpen(false)}
                        className="text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Done
                      </button>
                    </div>

                    {occupiedSeatsForRenewShift.length > 0 && (
                      <p className="text-[10px] font-bold text-red-600 truncate">
                        Occupied (excluded): {occupiedSeatsForRenewShift.join(', ')}
                      </p>
                    )}

                    {renewVacantCount === 0 ? (
                      <p className="text-xs font-bold text-red-600 py-1">
                        No vacant seats available in this shift.
                      </p>
                    ) : (
                      <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                        {availableSeatsForRenewShift.map((seat) => {
                          const isSelected = normalizeSeatLabel(renewForm.seat_number) === seat;
                          return (
                            <button
                              key={seat}
                              type="button"
                              onClick={() => {
                                setRenewForm((prev) => ({ ...prev, seat_number: seat }));
                                setRenewFormError(null);
                                setIsRenewSeatPickerOpen(false);
                                playSound('pop');
                              }}
                              className={`py-1.5 px-1 rounded-lg text-[11px] font-mono font-black border transition-all cursor-pointer tabular-nums ${
                                isSelected
                                  ? 'bg-[#58cc02] border-[#46a302] text-white shadow-xs'
                                  : 'bg-white border-slate-200 text-slate-700 hover:border-[#58cc02]'
                              }`}
                            >
                              {seat}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Editable Fee + Start/End Dates */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Fee (₹)
                    </label>
                    <div className="relative">
                      <IndianRupee className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="number"
                        min="0"
                        required
                        value={renewForm.monthly_fee}
                        onChange={(e) =>
                          setRenewForm((prev) => ({
                            ...prev,
                            monthly_fee: parseInt(e.target.value, 10) || 0,
                          }))
                        }
                        className="w-full pl-7 pr-2 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-black tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={renewForm.subscription_start}
                      onChange={(e) =>
                        setRenewForm((prev) => ({ ...prev, subscription_start: e.target.value }))
                      }
                      className="w-full px-2 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-[11px] font-bold tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                      Valid Till *
                    </label>
                    <input
                      type="date"
                      required
                      value={renewForm.subscription_end}
                      onChange={(e) =>
                        setRenewForm((prev) => ({ ...prev, subscription_end: e.target.value }))
                      }
                      className="w-full px-2 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-[11px] font-bold tabular-nums"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <input
                    type="text"
                    placeholder="Notes (optional, e.g. Paid via UPI, shifted to Full Day)"
                    value={renewForm.notes}
                    onChange={(e) => setRenewForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#e5e5e5] bg-white focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>

                {/* Master Admin Sync Info Line */}
                <p className="text-[11px] font-semibold text-slate-500 leading-snug">
                  Confirming automatically sends a renewal confirmation alert to the Master Admin&apos;s Students Alerts queue for WhatsApp dispatch.
                </p>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={renewingStudent}
                    onClick={() => setRenewStudentTarget(null)}
                    className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[40px] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={renewingStudent || !isRenewSeatValid}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide flex items-center gap-1.5 cursor-pointer min-h-[40px] ${
                      !renewingStudent && isRenewSeatValid
                        ? 'duo-btn-green'
                        : 'bg-slate-200 text-slate-400 border-2 border-slate-300 cursor-not-allowed opacity-60'
                    }`}
                  >
                    {renewingStudent ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Renewing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                        <span>Confirm Renewal</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Non-blocking Renewal Confirmation Toast */}
      {renewSuccessToast && (
        <div
          role="status"
          className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[80] max-w-sm w-[calc(100%-1.5rem)] bg-[#111b21] text-white px-4 py-3 rounded-2xl shadow-xl border border-white/10 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-[#58cc02] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-black truncate">
                {renewSuccessToast.studentName} renewed till {formatFriendlyDate(renewSuccessToast.validTill)}
              </p>
              <p className="text-[11px] font-semibold text-emerald-300 truncate">
                Renewal alert sent to Master Admin&apos;s Students queue
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRenewSuccessToast(null)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            aria-label="Dismiss confirmation"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Non-blocking Seat Vacated / Exit Confirmation Toast */}
      {exitSuccessToast && (
        <div
          role="status"
          className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[80] max-w-sm w-[calc(100%-1.5rem)] bg-[#111b21] text-white px-4 py-3 rounded-2xl shadow-xl border border-white/10 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <LogOut className="w-5 h-5 text-[#ff4b4b] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-black truncate">
                Seat {exitSuccessToast.seatNumber} vacated
              </p>
              <p className="text-[11px] font-semibold text-slate-300 truncate">
                {exitSuccessToast.studentName} marked as exited
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExitSuccessToast(null)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
            aria-label="Dismiss confirmation"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

    </div>
  );
};
