/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Building2,
  Plus,
  Search,
  KeyRound,
  Users,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Shield,
  Database,
  LayoutDashboard,
  Settings,
  LogOut,
  MessageCircle,
  Phone,
  Send,
  Bell,
  HeartHandshake,
  Check,
  X,
  Megaphone,
  Eye,
  QrCode,
  Download,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { BroadcastRequest, Library, LoginRecord, Student } from '../types/database';
import {
  dataService,
  getSupabaseClient,
  getSupabaseDiagnostics,
  hydrateSupabaseConfigFromServer,
  isSupabaseConfigured,
  isValidStudentPin,
} from '../lib/supabase';
import {
  downloadMasterQrPdf,
  formatSeatBadgeNumber,
  generateSeatQrDataUrl,
  getQrScanBaseOrigin,
} from '../lib/qrAndPdf';
import { buildCanonicalSeatLabels } from '../lib/masterQrPdfBuilder';
import {
  buildStudentJoiningMessage,
  buildStudentReminderMessage,
  buildStudentRenewalMessage,
  buildStudentThankYouMessage,
  calculateDaysRemaining,
  formatFriendlyDate,
  generatePhoneCallUrl,
  generateWhatsAppBroadcastUrl,
  generateWhatsAppLibraryLicenseUrl,
  generateWhatsAppReminderUrl,
  generateWhatsAppThankYouUrl,
  generateWhatsAppToPhoneUrl,
  generateWhatsAppWelcomeUrl,
  getStudentExitDate,
  getStudentJoinedDate,
  getStudentRenewedDate,
  isExitAlertDismissed,
  isExitAlertSent,
  isExpiringAlertDismissed,
  isExpiringAlertSent,
  isJoinAlertDismissed,
  isJoinAlertSent,
  isRenewAlertDismissed,
  isRenewAlertSent,
  isStudentExited,
  playSound,
  fireDuolingoConfetti,
} from '../lib/utils';
import { EkaSigmaIcon } from './EkaLogoMark';

export type AdminTab = 'overview' | 'libraries' | 'alerts' | 'codes' | 'settings';

interface AdminDashboardProps {
  adminCode: string;
  onRefresh: () => void;
  onOpenSupabaseModal?: () => void;
  onLogout?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminCode,
  onRefresh,
  onOpenSupabaseModal,
  onLogout,
}) => {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [broadcastRequests, setBroadcastRequests] = useState<BroadcastRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [alertView, setAlertView] = useState<'broadcasts' | 'exited' | 'licenses'>('broadcasts');

  // Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryFilterStatus, setLibraryFilterStatus] = useState<'all' | 'active' | 'attention'>('all');
  const [codeFilterRole, setCodeFilterRole] = useState<'all' | 'admin' | 'owner' | 'student'>('all');
  const [codeSearchQuery, setCodeSearchQuery] = useState('');

  // Pagination States (keeps lists strictly non-scrolling on single screen)
  const [libPage, setLibPage] = useState(0);
  const [codePage, setCodePage] = useState(0);
  const [alertPage, setAlertPage] = useState(0);
  const [exitedAlertPage, setExitedAlertPage] = useState(0);
  const [broadcastPage, setBroadcastPage] = useState(0);
  const [studentAlertFilter, setStudentAlertFilter] = useState<
    'joining' | 'renewed' | 'expiring' | 'exited'
  >('joining');
  const [studentAlertSearch, setStudentAlertSearch] = useState('');
  const hasManuallyPickedAlertGroupRef = useRef(false);
  const [sentLicenseIds, setSentLicenseIds] = useState<string[]>([]);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Feedback banner & Confirm modals (zero browser alert/confirm)
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteLib, setConfirmDeleteLib] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(null);
  const [selectedBroadcastModal, setSelectedBroadcastModal] = useState<BroadcastRequest | null>(null);
  const [selectedStudentAlertModal, setSelectedStudentAlertModal] = useState<{
    alert: StudentLifecycleAlert;
    badgeText: string;
    badgeClass: string;
    defaultMessage: string;
  } | null>(null);
  const [editStudentAlertText, setEditStudentAlertText] = useState('');
  const [selectedBroadcastLibraryId, setSelectedBroadcastLibraryId] = useState<string | null>(null);
  const [selectedBroadcastLibraryName, setSelectedBroadcastLibraryName] = useState<string>('');
  const adminChatBottomRef = useRef<HTMLDivElement | null>(null);
  const [editBroadcastText, setEditBroadcastText] = useState('');
  const [savingBroadcastEdit, setSavingBroadcastEdit] = useState(false);
  const [broadcastEditSaved, setBroadcastEditSaved] = useState(false);

  // Action Modals & Dedicated Library Page States
  const [showAddLibraryModal, setShowAddLibraryModal] = useState(false);
  const [creatingLibrary, setCreatingLibrary] = useState(false);
  const [addLibraryError, setAddLibraryError] = useState<string | null>(null);
  const [showAddCodeModal, setShowAddCodeModal] = useState(false);
  const [creatingCode, setCreatingCode] = useState(false);
  const [addCodeError, setAddCodeError] = useState<string | null>(null);
  const [deletingLibrary, setDeletingLibrary] = useState(false);
  const [deleteLibraryError, setDeleteLibraryError] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState<string | null>(null);
  const [updatingLibId, setUpdatingLibId] = useState<string | null>(null);
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null);
  const [selectedLibStudents, setSelectedLibStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [libStudentSearch, setLibStudentSearch] = useState('');
  const [libStudentFilter, setLibStudentFilter] = useState<'all' | 'expiring' | 'new'>('all');
  const [libStudentPage, setLibStudentPage] = useState(0);
  const [selectedLibStudentDetail, setSelectedLibStudentDetail] = useState<Student | null>(null);
  const [copiedStudentCode, setCopiedStudentCode] = useState(false);
  const [qrSheetLibrary, setQrSheetLibrary] = useState<Library | null>(null);
  const [qrSheetPreviewPage, setQrSheetPreviewPage] = useState(0);
  const [qrSheetPreviewUrls, setQrSheetPreviewUrls] = useState<Record<string, string>>({});
  const [downloadingMasterQrLibId, setDownloadingMasterQrLibId] = useState<string | null>(null);

  useEffect(() => {
    if (!qrSheetLibrary) return;
    let cancelled = false;
    const libStudents = allStudents.filter((s) => s.library_id === qrSheetLibrary.id);
    const allLabels = buildCanonicalSeatLabels(
      qrSheetLibrary.total_seats || 50,
      libStudents.map((s) => s.seat_number)
    );
    const perPage = 6;
    const maxPage = Math.max(0, Math.ceil(allLabels.length / perPage) - 1);
    const safePage = Math.min(qrSheetPreviewPage, maxPage);
    const start = safePage * perPage;
    const labels = allLabels.slice(start, start + perPage);

    void Promise.all(
      labels.map(async (label) => {
        const url = await generateSeatQrDataUrl(qrSheetLibrary.id, label, 260);
        return [`${qrSheetLibrary.id}:${label}`, url] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setQrSheetPreviewUrls((prev) => {
        const next = { ...prev };
        for (const [k, v] of entries) next[k] = v;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [qrSheetLibrary, qrSheetPreviewPage, allStudents]);

  const handleDownloadLibraryMasterQrPdf = async (lib: Library) => {
    if (downloadingMasterQrLibId) return;
    setDownloadingMasterQrLibId(lib.id);
    playSound('pop');
    try {
      const libStudents = allStudents.filter((s) => s.library_id === lib.id);
      const seatLabels = buildCanonicalSeatLabels(
        lib.total_seats || 50,
        libStudents.map((s) => s.seat_number)
      );
      await downloadMasterQrPdf(lib, { seatLabels });
      playSound('success');
    } catch (err: any) {
      setActionError(`Failed to generate Master QR PDF: ${err?.message || 'Unknown error'}`);
    } finally {
      setDownloadingMasterQrLibId(null);
    }
  };

  const [libForm, setLibForm] = useState({
    id: '',
    name: '',
    location: '',
    total_seats: 50,
    owner_name: '',
    contact_phone: '',
    subscription_expiry: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    owner_code: '',
  });

  const [codeForm, setCodeForm] = useState({
    code: '',
    role: 'owner' as 'admin' | 'owner' | 'student',
    reference_id: '',
  });

  const loadData = async () => {
    setLoading(true);
    setActionError(null);
    try {
      if (!isSupabaseConfigured()) {
        await hydrateSupabaseConfigFromServer();
      }

      const diag = getSupabaseDiagnostics();
      const client = getSupabaseClient();
      console.info('[AdminDashboard] Loading metrics with Supabase config:', diag);

      if (!diag.configured || !client) {
        const missingMsg =
          'Supabase is not configured in this deployment. Set VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel Environment Variables, or enter them in Database Settings.';
        console.error('[AdminDashboard] Supabase client initialization failed:', diag);
        setActionError(missingMsg);
        setLibraries([]);
        setLogins([]);
        setAllStudents([]);
        setBroadcastRequests([]);
        return;
      }

      const [libsRes, logsRes, studsRes, bcastsRes] = await Promise.allSettled([
        dataService.getAllLibraries(),
        dataService.getAllLogins(),
        dataService.getAllStudents(),
        dataService.getBroadcastRequests(),
      ]);

      if (libsRes.status === 'fulfilled') setLibraries(libsRes.value);
      if (logsRes.status === 'fulfilled') setLogins(logsRes.value);
      if (studsRes.status === 'fulfilled') setAllStudents(studsRes.value);
      if (bcastsRes.status === 'fulfilled') setBroadcastRequests(bcastsRes.value);

      const loadErrors: string[] = [];
      if (libsRes.status === 'rejected') {
        console.error('[AdminDashboard] Failed to fetch libraries:', libsRes.reason);
        loadErrors.push(`Libraries: ${libsRes.reason?.message || 'Failed to load'}`);
      }
      if (logsRes.status === 'rejected') {
        console.error('[AdminDashboard] Failed to fetch all_logins:', logsRes.reason);
        loadErrors.push(`Pins/Logins: ${logsRes.reason?.message || 'Failed to load'}`);
      }
      if (studsRes.status === 'rejected') {
        console.error('[AdminDashboard] Failed to fetch students:', studsRes.reason);
        loadErrors.push(`Students: ${studsRes.reason?.message || 'Failed to load'}`);
      }
      if (bcastsRes.status === 'rejected') {
        console.error('[AdminDashboard] Failed to fetch broadcast_requests:', bcastsRes.reason);
        loadErrors.push(`Broadcasts: ${bcastsRes.reason?.message || 'Failed to load'}`);
      }

      if (loadErrors.length > 0) {
        setActionError(`Supabase query error: ${loadErrors.join(' · ')}`);
      } else {
        console.info('[AdminDashboard] Loaded live Supabase metrics:', {
          libraries: libsRes.status === 'fulfilled' ? libsRes.value.length : 0,
          logins: logsRes.status === 'fulfilled' ? logsRes.value.length : 0,
          students: studsRes.status === 'fulfilled' ? studsRes.value.length : 0,
          broadcasts: bcastsRes.status === 'fulfilled' ? bcastsRes.value.length : 0,
        });
      }

      onRefresh();
    } catch (err: any) {
      console.error('[AdminDashboard] Failed to load admin data:', err);
      setActionError(err?.message || 'Failed to load database records.');
    } finally {
      setLoading(false);
    }
  };

  const syncBroadcastQueueSilently = async () => {
    if (!isSupabaseConfigured() || !getSupabaseClient()) return;
    try {
      const [libsRes, bcastsRes, studsRes, logsRes] = await Promise.allSettled([
        dataService.getAllLibraries(),
        dataService.getBroadcastRequests(),
        dataService.getAllStudents(),
        dataService.getAllLogins(),
      ]);
      if (libsRes.status === 'fulfilled') setLibraries(libsRes.value);
      if (bcastsRes.status === 'fulfilled') {
        const bcasts = bcastsRes.value;
        setBroadcastRequests(bcasts);
        setSelectedBroadcastModal((prev) =>
          prev && !bcasts.some((item) => item.id === prev.id) ? null : prev
        );
      }
      if (studsRes.status === 'fulfilled') setAllStudents(studsRes.value);
      if (logsRes.status === 'fulfilled') setLogins(logsRes.value);
    } catch (err) {
      console.warn('[AdminDashboard] Background sync failed:', err);
    }
  };

  useEffect(() => {
    let active = true;
    let unsubscribeLibraries = () => {};
    let unsubscribeStudents = () => {};

    const initAdminDashboard = async () => {
      await loadData();
      if (!active) return;
      unsubscribeLibraries = dataService.subscribeToLibraryUpdates({
        onUpdate: () => {
          void syncBroadcastQueueSilently();
        },
      });
      unsubscribeStudents = dataService.subscribeToStudentUpdates({
        onUpdate: () => {
          void syncBroadcastQueueSilently();
        },
      });
    };

    void initAdminDashboard();

    return () => {
      active = false;
      unsubscribeLibraries();
      unsubscribeStudents();
    };
  }, []);

  // Keep Master Admin broadcast queue synced live so owner-deleted or expired requests vanish immediately
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void syncBroadcastQueueSilently();
    }, 5000);

    const onSyncEvent = () => {
      void syncBroadcastQueueSilently();
    };

    window.addEventListener('storage', onSyncEvent);
    window.addEventListener('focus', onSyncEvent);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onSyncEvent);
      window.removeEventListener('focus', onSyncEvent);
    };
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setLibPage(0);
  }, [searchQuery, libraryFilterStatus]);

  useEffect(() => {
    setCodePage(0);
  }, [codeSearchQuery, codeFilterRole]);

  useEffect(() => {
    setLibStudentPage(0);
  }, [libStudentSearch, libStudentFilter]);

  useEffect(() => {
    setExitedAlertPage(0);
  }, [studentAlertFilter, studentAlertSearch]);

  const handleSwitchTab = (tab: AdminTab) => {
    if (selectedLibrary) {
      playSound('pop');
      setSelectedLibrary(null);
      setSelectedLibStudentDetail(null);
    }
    if (selectedBroadcastLibraryId) {
      setSelectedBroadcastLibraryId(null);
    }
    if (tab !== activeTab) {
      playSound('pop');
      setActiveTab(tab);
    }
  };

  const openAddLibraryModal = () => {
    setAddLibraryError(null);
    setActionError(null);
    setShowAddLibraryModal(true);
  };

  const openAddCodeModal = () => {
    setAddCodeError(null);
    setActionError(null);
    setShowAddCodeModal(true);
  };

  const handleOpenLibraryDetails = async (lib: Library) => {
    playSound('pop');
    setActiveTab('libraries');
    setSelectedLibrary(lib);
    setSelectedLibStudentDetail(null);
    setLibStudentSearch('');
    setLibStudentFilter('all');
    setLibStudentPage(0);
    setLoadingStudents(true);
    try {
      const [studs, freshLogs] = await Promise.all([
        dataService.getStudentsByLibrary(lib.id),
        dataService.getAllLogins(),
      ]);
      setSelectedLibStudents(studs.filter((s) => !isStudentExited(s)));
      setLogins(freshLogs);
    } catch (e: any) {
      console.error(e);
      setActionError(`Error loading library details: ${e?.message || 'Unknown error'}`);
      setSelectedLibStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingLibrary) return;
    if (!libForm.name.trim() || !libForm.location.trim()) {
      setAddLibraryError('Please enter both Library Name and Location.');
      return;
    }
    setAddLibraryError(null);
    setActionError(null);
    setCreatingLibrary(true);

    const slugId =
      'lib_' +
      (libForm.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 20) || 'library') +
      '_' +
      Math.floor(Math.random() * 1000);
    const codePrefix =
      libForm.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'LIB';
    const generatedOwnerCode =
      libForm.owner_code.trim().toUpperCase() ||
      `OWNER-${codePrefix}${Math.floor(Math.random() * 900 + 100)}`;

    const newLib: Library = {
      id: slugId,
      name: libForm.name.trim(),
      location: libForm.location.trim(),
      total_seats: Math.max(1, Number(libForm.total_seats) || 50),
      owner_name: libForm.owner_name.trim() || 'Library Manager',
      contact_phone: libForm.contact_phone.trim() || '+919876543210',
      subscription_status: 'active',
      subscription_expiry: libForm.subscription_expiry,
    };

    try {
      await dataService.createLibrary(newLib, generatedOwnerCode);
      playSound('success');
      fireDuolingoConfetti();
      setShowAddLibraryModal(false);
      setLibForm({
        id: '',
        name: '',
        location: '',
        total_seats: 50,
        owner_name: '',
        contact_phone: '',
        subscription_expiry: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        owner_code: '',
      });
      await loadData();
    } catch (err: any) {
      setAddLibraryError(err?.message || 'Error creating library.');
    } finally {
      setCreatingLibrary(false);
    }
  };

  const handleConfirmDeleteLibrary = async () => {
    if (!confirmDeleteLib || deletingLibrary) return;
    setDeletingLibrary(true);
    setDeleteLibraryError(null);
    try {
      await dataService.deleteLibrary(confirmDeleteLib.id);
      playSound('pop');
      if (selectedLibrary?.id === confirmDeleteLib.id) {
        setSelectedLibrary(null);
      }
      setConfirmDeleteLib(null);
      await loadData();
    } catch (err: any) {
      setDeleteLibraryError(err?.message || 'Error deleting library.');
    } finally {
      setDeletingLibrary(false);
    }
  };

  const handleExtendSubscription = async (libId: string, daysToAdd: number) => {
    if (updatingLibId) return;
    const lib = libraries.find((l) => l.id === libId);
    if (!lib) return;

    const currentExpiry = new Date(lib.subscription_expiry || Date.now());
    const baseDate = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    baseDate.setDate(baseDate.getDate() + daysToAdd);
    const newExpiry = baseDate.toISOString().split('T')[0];

    setUpdatingLibId(libId);
    setActionError(null);
    try {
      await dataService.updateLibrary({
        id: libId,
        subscription_expiry: newExpiry,
        subscription_status: 'active',
      });
      playSound('success');
      if (selectedLibrary?.id === libId) {
        setSelectedLibrary({ ...selectedLibrary, subscription_expiry: newExpiry, subscription_status: 'active' });
      }
      await loadData();
    } catch (err: any) {
      setActionError(`Error extending subscription: ${err?.message || 'Unknown error'}`);
    } finally {
      setUpdatingLibId(null);
    }
  };

  const handleToggleSubscriptionStatus = async (libId: string, currentStatus?: string) => {
    if (updatingLibId) return;
    const isCurrentlyActive = (currentStatus || '').toLowerCase() === 'active';
    const newStatus = isCurrentlyActive ? 'inactive' : 'active';

    setUpdatingLibId(libId);
    setActionError(null);
    try {
      await dataService.updateLibrary({
        id: libId,
        subscription_status: newStatus,
      });
      playSound('pop');
      if (selectedLibrary?.id === libId) {
        setSelectedLibrary({ ...selectedLibrary, subscription_status: newStatus });
      }
      await loadData();
    } catch (err: any) {
      setActionError(`Error updating subscription status: ${err?.message || 'Unknown error'}`);
    } finally {
      setUpdatingLibId(null);
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingCode) return;
    const cleanCode = codeForm.code.trim().toUpperCase();
    if (!cleanCode) {
      setAddCodeError('Please enter a code or PIN.');
      return;
    }
    setAddCodeError(null);
    setActionError(null);

    if (codeForm.role === 'student' && !isValidStudentPin(cleanCode)) {
      setAddCodeError('Student Pin must be a 4-digit numeric PIN between 1000 and 9999 (e.g. 4821).');
      return;
    }

    setCreatingCode(true);
    try {
      await dataService.createLoginCode({
        code: cleanCode,
        student_pin: codeForm.role === 'student' ? cleanCode : undefined,
        role: codeForm.role,
        reference_id: codeForm.reference_id.trim() || null,
        is_active: true,
      });
      playSound('success');
      setShowAddCodeModal(false);
      setCodeForm({ code: '', role: 'owner', reference_id: '' });
      await loadData();
    } catch (err: any) {
      setAddCodeError(err?.message || 'Error creating code.');
    } finally {
      setCreatingCode(false);
    }
  };

  const handleToggleCode = async (code: string, currentActive: boolean) => {
    setActionError(null);
    try {
      await dataService.toggleLoginCodeStatus(code, !currentActive);
      playSound('pop');
      await loadData();
    } catch (err: any) {
      setActionError(`Error updating code: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleConfirmDeleteCode = async () => {
    if (!confirmDeleteCode || deletingCode) return;
    setDeletingCode(true);
    setDeleteCodeError(null);
    try {
      await dataService.deleteLoginCode(confirmDeleteCode);
      playSound('pop');
      setConfirmDeleteCode(null);
      await loadData();
    } catch (err: any) {
      setDeleteCodeError(err?.message || 'Error deleting code.');
    } finally {
      setDeletingCode(false);
    }
  };

  const handleClearExitedStudentAlert = async (student: Student, isThankYou = false) => {
    try {
      // Optimistically remove the notification card from active alerts & library view immediately
      setAllStudents((prev) => prev.filter((s) => s.id !== student.id));
      setSelectedLibStudents((prev) => prev.filter((s) => s.id !== student.id));
      playSound(isThankYou ? 'success' : 'pop');
      // Permanently clean up archived exited student record and login code from DB
      await dataService.deleteStudent(student.id);
      setLogins((prev) => prev.filter((l) => l.reference_id !== student.id));
    } catch (err: any) {
      setActionError(`Error clearing exited student alert: ${err.message}`);
    }
  };

  const openBroadcastModal = (req: BroadcastRequest) => {
    playSound('pop');
    setEditBroadcastText(req.message);
    setBroadcastEditSaved(false);
    setSelectedBroadcastModal(req);
  };

  const handleSaveBroadcastEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedBroadcastModal) return;
    const trimmed = editBroadcastText.trim();
    if (!trimmed) return;
    setSavingBroadcastEdit(true);
    try {
      setBroadcastRequests((prev) =>
        prev.map((item) =>
          item.id === selectedBroadcastModal.id ? { ...item, message: trimmed } : item
        )
      );
      setSelectedBroadcastModal((prev) => (prev ? { ...prev, message: trimmed } : null));
      await dataService.updateBroadcastMessage(selectedBroadcastModal.id, trimmed);
      playSound('success');
      setBroadcastEditSaved(true);
    } catch (err: any) {
      setActionError(`Error updating broadcast message: ${err.message}`);
    } finally {
      setSavingBroadcastEdit(false);
    }
  };

  const handleMarkBroadcastSent = async (req: BroadcastRequest, overrideMessage?: string) => {
    try {
      const finalMessage = overrideMessage?.trim();
      if (finalMessage && finalMessage !== req.message) {
        await dataService.updateBroadcastMessage(req.id, finalMessage);
      }
      // Keep the message visible in the queue with 'sent' status so admin can Send Again or manually Clear
      setBroadcastRequests((prev) =>
        prev.map((item) =>
          item.id === req.id
            ? { ...item, status: 'sent', message: finalMessage || item.message }
            : item
        )
      );
      playSound('success');
      await dataService.updateBroadcastStatus(req.id, 'sent');
    } catch (err: any) {
      setActionError(`Error updating broadcast status: ${err.message}`);
    }
  };

  const handleDeleteBroadcastRequest = async (id: string) => {
    try {
      setBroadcastRequests((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'archived' } : item))
      );
      playSound('pop');
      await dataService.updateBroadcastStatus(id, 'archived');
    } catch (err: any) {
      setActionError(`Error removing broadcast request: ${err.message}`);
    }
  };

  // Computed Data — License Expiry Alerts (prioritize Expiry Day & 2 Days Left triggers)
  const attentionLibraries = libraries
    .filter((l) => {
      const isInactive = (l.subscription_status || '').toLowerCase() !== 'active';
      const daysLeft = calculateDaysRemaining(l.subscription_expiry);
      return isInactive || daysLeft <= 7;
    })
    .sort((a, b) => {
      const priority = (lib: Library) => {
        const isInactive = (lib.subscription_status || '').toLowerCase() !== 'active';
        const d = calculateDaysRemaining(lib.subscription_expiry);
        if (d === 0 && !isInactive) return 0; // Expiry Day
        if ((d === 1 || d === 2) && !isInactive) return 1; // 2 Days / 1 Day before expiry
        if (d < 0 && !isInactive) return 2; // Expired
        if (isInactive) return 3; // Paused
        return 4 + d;
      };
      return priority(a) - priority(b);
    });

  const filteredLibraries = libraries.filter((l) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      (l.name || '').toLowerCase().includes(q) ||
      (l.location || '').toLowerCase().includes(q) ||
      (l.owner_name || '').toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (libraryFilterStatus === 'active') {
      const isInactive = (l.subscription_status || '').toLowerCase() !== 'active';
      const daysLeft = calculateDaysRemaining(l.subscription_expiry);
      return !isInactive && daysLeft >= 0;
    }
    if (libraryFilterStatus === 'attention') {
      const isInactive = (l.subscription_status || '').toLowerCase() !== 'active';
      const daysLeft = calculateDaysRemaining(l.subscription_expiry);
      return isInactive || daysLeft <= 7;
    }
    return true;
  });

  const filteredLogins = logins.filter((item) => {
    const matchesRole = codeFilterRole === 'all' || item.role === codeFilterRole;
    const cq = codeSearchQuery.toLowerCase();
    const matchesSearch =
      !codeSearchQuery ||
      (item.code || '').toLowerCase().includes(cq) ||
      Boolean(item.reference_id && item.reference_id.toLowerCase().includes(cq));
    return matchesRole && matchesSearch;
  });

  const totalSeats = libraries.reduce((acc, l) => acc + (l.total_seats || 0), 0);
  const activeSubs = libraries.filter(
    (l) => calculateDaysRemaining(l.subscription_expiry) > 0 && (l.subscription_status || '').toLowerCase() === 'active'
  ).length;
  const activeCodesCount = logins.filter((l) => l.is_active).length;

  // Strict Single-Screen Pagination Config
  const LIBS_PER_PAGE = isDesktop ? 7 : 6;
  const totalLibPages = Math.max(1, Math.ceil(filteredLibraries.length / LIBS_PER_PAGE));
  const safeLibPage = Math.min(libPage, totalLibPages - 1);
  const visibleLibraries = filteredLibraries.slice(
    safeLibPage * LIBS_PER_PAGE,
    safeLibPage * LIBS_PER_PAGE + LIBS_PER_PAGE
  );

  const CODES_PER_PAGE = isDesktop ? 4 : 3;
  const totalCodePages = Math.max(1, Math.ceil(filteredLogins.length / CODES_PER_PAGE));
  const safeCodePage = Math.min(codePage, totalCodePages - 1);
  const visibleLogins = filteredLogins.slice(
    safeCodePage * CODES_PER_PAGE,
    safeCodePage * CODES_PER_PAGE + CODES_PER_PAGE
  );

  const ALERTS_PER_PAGE = isDesktop ? 4 : 3;
  const totalAlertPages = Math.max(1, Math.ceil(attentionLibraries.length / ALERTS_PER_PAGE));
  const safeAlertPage = Math.min(alertPage, totalAlertPages - 1);
  const visibleAlerts = attentionLibraries.slice(
    safeAlertPage * ALERTS_PER_PAGE,
    safeAlertPage * ALERTS_PER_PAGE + ALERTS_PER_PAGE
  );

  // Unified Student Lifecycle Alerts: New Joining, Renewal, Upcoming Expiry (2 Days Left), and Exited
  type StudentLifecycleType = 'joining' | 'renewed' | 'expiring' | 'exited';
  interface StudentLifecycleAlert {
    key: string;
    type: StudentLifecycleType;
    student: Student;
    libraryName: string;
    daysLeft: number;
    triggerDate: string | null;
  }

  const getStudentCodeForAlert = (student: Pick<Student, 'id' | 'student_pin'>) => {
    const loginPin = logins.find((l) => l.role === 'student' && l.reference_id === student.id)?.code;
    if (loginPin && /^\d{4}$/.test(loginPin.trim())) return loginPin.trim();
    if (student.student_pin && /^\d{4}$/.test(student.student_pin.trim())) {
      return student.student_pin.trim();
    }
    return loginPin;
  };

  const isRecentStudentRecord = (st: Student) => {
    const refDate = getStudentJoinedDate(st) || st.created_at || st.subscription_start;
    if (!refDate) return false;
    const diffDays = (Date.now() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= -1 && diffDays <= 7;
  };

  const libraryNameById = new Map(libraries.map((l) => [l.id, l.name]));
  const studentLifecycleAlerts: StudentLifecycleAlert[] = [];
  for (const st of allStudents) {
    const libName = libraryNameById.get(st.library_id) || 'Study Library';

    if (isStudentExited(st)) {
      if (!isExitAlertDismissed(st)) {
        studentLifecycleAlerts.push({
          key: `exited_${st.id}`,
          type: 'exited',
          student: st,
          libraryName: libName,
          daysLeft: calculateDaysRemaining(st.subscription_end),
          triggerDate: getStudentExitDate(st),
        });
      }
      continue;
    }

    const daysLeft = calculateDaysRemaining(st.subscription_end);
    if (daysLeft >= 0 && daysLeft <= 2 && !isExpiringAlertDismissed(st)) {
      studentLifecycleAlerts.push({
        key: `expiring_${st.id}`,
        type: 'expiring',
        student: st,
        libraryName: libName,
        daysLeft,
        triggerDate: st.subscription_end,
      });
    }

    const renewedDate = getStudentRenewedDate(st);
    if (renewedDate && !isRenewAlertDismissed(st)) {
      studentLifecycleAlerts.push({
        key: `renewed_${st.id}`,
        type: 'renewed',
        student: st,
        libraryName: libName,
        daysLeft,
        triggerDate: renewedDate,
      });
    }

    // Always generate a New Joining welcome alert for newly entered students (even if migrating with past start date or immediate expiry/renewal)
    const joinedDate = getStudentJoinedDate(st);
    if ((joinedDate || (isRecentStudentRecord(st) && !renewedDate)) && !isJoinAlertDismissed(st)) {
      studentLifecycleAlerts.push({
        key: `joining_${st.id}`,
        type: 'joining',
        student: st,
        libraryName: libName,
        daysLeft,
        triggerDate: joinedDate || (st.created_at ? st.created_at.split('T')[0] : st.subscription_start),
      });
    }
  }

  const lifecycleOrder: Record<StudentLifecycleType, number> = {
    expiring: 0,
    exited: 1,
    renewed: 2,
    joining: 3,
  };
  studentLifecycleAlerts.sort((a, b) => {
    if (a.type !== b.type) return lifecycleOrder[a.type] - lifecycleOrder[b.type];
    if (a.type === 'expiring') return a.daysLeft - b.daysLeft;
    const dateDiff = (b.triggerDate || '').localeCompare(a.triggerDate || '');
    if (dateDiff !== 0) return dateDiff;
    return (a.student.name || '').localeCompare(b.student.name || '');
  });

  const studentAlertCounts = {
    joining: studentLifecycleAlerts.filter((a) => a.type === 'joining').length,
    renewed: studentLifecycleAlerts.filter((a) => a.type === 'renewed').length,
    expiring: studentLifecycleAlerts.filter((a) => a.type === 'expiring').length,
    exited: studentLifecycleAlerts.filter((a) => a.type === 'exited').length,
  };

  useEffect(() => {
    if (hasManuallyPickedAlertGroupRef.current) return;
    if (studentAlertCounts[studentAlertFilter] > 0) return;
    const firstNonEmpty = (['joining', 'renewed', 'expiring', 'exited'] as const).find(
      (group) => studentAlertCounts[group] > 0
    );
    if (firstNonEmpty && firstNonEmpty !== studentAlertFilter) {
      setStudentAlertFilter(firstNonEmpty);
    }
  }, [
    studentAlertCounts.joining,
    studentAlertCounts.renewed,
    studentAlertCounts.expiring,
    studentAlertCounts.exited,
    studentAlertFilter,
  ]);

  const studentAlertQuery = studentAlertSearch.trim().toLowerCase();
  const filteredStudentAlerts = studentLifecycleAlerts.filter((a) => {
    if (a.type !== studentAlertFilter) return false;
    if (!studentAlertQuery) return true;
    return (
      (a.student.name || '').toLowerCase().includes(studentAlertQuery) ||
      (a.libraryName || '').toLowerCase().includes(studentAlertQuery) ||
      (a.student.seat_number || '').toLowerCase().includes(studentAlertQuery) ||
      (a.student.shift || '').toLowerCase().includes(studentAlertQuery) ||
      (a.student.phone || '').includes(studentAlertQuery)
    );
  });

  const exitedAlertStudents = allStudents.filter(
    (s) => isStudentExited(s) && !isExitAlertDismissed(s)
  );

  const isStudentAlertSent = (alert: StudentLifecycleAlert): boolean => {
    if (alert.type === 'exited') return isExitAlertSent(alert.student);
    if (alert.type === 'joining') return isJoinAlertSent(alert.student);
    if (alert.type === 'renewed') return isRenewAlertSent(alert.student);
    return isExpiringAlertSent(alert.student);
  };

  // Mark a student alert as sent via WhatsApp WITHOUT removing it from the queue (persists *_SENT tag in Supabase)
  const handleMarkStudentAlertSent = async (alert: StudentLifecycleAlert) => {
    const tag =
      alert.type === 'exited'
        ? 'EXIT_SENT'
        : alert.type === 'joining'
        ? 'JOIN_SENT'
        : alert.type === 'renewed'
        ? 'RENEW_SENT'
        : `EXPIRING_SENT:${alert.student.subscription_end}`;

    const token = `[${tag}]`;
    let nextNotes = alert.student.notes || '';
    if (tag.startsWith('EXPIRING_SENT:')) {
      nextNotes = nextNotes.replace(/\s*\[EXPIRING_SENT(?::[^\]]*)?\]/gi, '').trim();
    }
    if (!nextNotes.includes(token)) {
      nextNotes = nextNotes ? `${nextNotes} ${token}` : token;
    }

    setAllStudents((prev) =>
      prev.map((s) => (s.id === alert.student.id ? { ...s, notes: nextNotes } : s))
    );
    playSound('success');

    try {
      await dataService.markStudentAlertTag(alert.student, tag);
    } catch (err: any) {
      setActionError(`Error updating alert status: ${err.message}`);
    }
  };

  // Explicitly clear / dismiss a student alert only when the manual Clear button is clicked
  const handleAcknowledgeStudentLifecycleAlert = async (
    alert: StudentLifecycleAlert,
    sentWhatsApp = false
  ) => {
    if (alert.type === 'exited') {
      await handleClearExitedStudentAlert(alert.student, sentWhatsApp);
      return;
    }

    const tag =
      alert.type === 'joining'
        ? 'JOIN_ACK'
        : alert.type === 'renewed'
        ? 'RENEW_ACK'
        : `EXPIRING_ACK:${alert.student.subscription_end}`;

    const token = `[${tag}]`;
    const optimisticNotes = (alert.student.notes || '').includes(token)
      ? alert.student.notes || ''
      : alert.student.notes
      ? `${alert.student.notes} ${token}`
      : token;

    setAllStudents((prev) =>
      prev.map((s) => (s.id === alert.student.id ? { ...s, notes: optimisticNotes } : s))
    );
    playSound(sentWhatsApp ? 'success' : 'pop');

    try {
      await dataService.markStudentAlertTag(alert.student, tag);
    } catch (err: any) {
      setActionError(`Error updating alert status: ${err.message}`);
    }
  };

  const EXITED_ALERTS_PER_PAGE = isDesktop ? 7 : 5;
  const totalExitedAlertPages = Math.max(1, Math.ceil(filteredStudentAlerts.length / EXITED_ALERTS_PER_PAGE));
  const safeExitedAlertPage = Math.min(exitedAlertPage, totalExitedAlertPages - 1);
  const visibleStudentAlerts = filteredStudentAlerts.slice(
    safeExitedAlertPage * EXITED_ALERTS_PER_PAGE,
    safeExitedAlertPage * EXITED_ALERTS_PER_PAGE + EXITED_ALERTS_PER_PAGE
  );

  // Active Owner Broadcast Requests grouped by Library (keeps both 'pending' and 'sent' until manually cleared)
  const activeQueueBroadcasts = broadcastRequests.filter(
    (b) => b.status === 'pending' || b.status === 'sent'
  );
  const pendingBroadcastsCount = activeQueueBroadcasts.length;

  interface BroadcastLibraryThread {
    library_id: string;
    library_name: string;
    messages: BroadcastRequest[];
    unreadCount: number;
    latestMessage: BroadcastRequest;
  }

  const broadcastThreadsMap = new Map<string, BroadcastRequest[]>();
  for (const req of activeQueueBroadcasts) {
    const list = broadcastThreadsMap.get(req.library_id) || [];
    list.push(req);
    broadcastThreadsMap.set(req.library_id, list);
  }

  const broadcastThreads: BroadcastLibraryThread[] = Array.from(broadcastThreadsMap.entries())
    .map(([libId, msgs]) => {
      const sortedChrono = [...msgs].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const latestMessage = sortedChrono[sortedChrono.length - 1];
      const matchedLibName =
        libraries.find((l) => l.id === libId)?.name || latestMessage.library_name || 'Study Library';
      return {
        library_id: libId,
        library_name: matchedLibName,
        messages: sortedChrono,
        unreadCount: sortedChrono.filter((m) => m.status === 'pending').length,
        latestMessage,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.latestMessage.created_at).getTime() -
        new Date(a.latestMessage.created_at).getTime()
    );

  const BROADCASTS_PER_PAGE = isDesktop ? 7 : 5;
  const totalBroadcastPages = Math.max(1, Math.ceil(broadcastThreads.length / BROADCASTS_PER_PAGE));
  const safeBroadcastPage = Math.min(broadcastPage, totalBroadcastPages - 1);
  const visibleBroadcastThreads = broadcastThreads.slice(
    safeBroadcastPage * BROADCASTS_PER_PAGE,
    safeBroadcastPage * BROADCASTS_PER_PAGE + BROADCASTS_PER_PAGE
  );

  const activeLibraryThread = selectedBroadcastLibraryId
    ? broadcastThreads.find((t) => t.library_id === selectedBroadcastLibraryId) || null
    : null;
  const activeThreadMessages = activeLibraryThread?.messages || [];
  const activeThreadLibraryName =
    activeLibraryThread?.library_name ||
    libraries.find((l) => l.id === selectedBroadcastLibraryId)?.name ||
    selectedBroadcastLibraryName ||
    'Study Library';

  useEffect(() => {
    if (activeTab === 'alerts' && alertView === 'broadcasts' && selectedBroadcastLibraryId) {
      adminChatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTab, alertView, selectedBroadcastLibraryId, activeThreadMessages.length]);

  const totalAlertsCount = pendingBroadcastsCount + studentLifecycleAlerts.length + attentionLibraries.length;

  // Helpers & Pagination for Dedicated Library Management Page
  const getStudentAccessCode = (studentId: string) => {
    const loginPin = logins.find((l) => l.role === 'student' && l.reference_id === studentId)?.code;
    if (loginPin) return loginPin;
    const stu =
      selectedLibStudents.find((s) => s.id === studentId) ||
      allStudents.find((s) => s.id === studentId);
    if (stu?.student_pin && /^\d{4}$/.test(stu.student_pin.trim())) {
      return stu.student_pin.trim();
    }
    return 'Not Issued';
  };

  const isNewlyAddedStudent = (st: Student) => {
    if (isStudentExited(st)) return false;
    const refDate = getStudentJoinedDate(st) || st.created_at || st.subscription_start;
    if (!refDate) return false;
    const diffDays = (Date.now() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= -1 && diffDays <= 7;
  };

  const expiringLibStudentsCount = selectedLibStudents.filter(
    (st) => !isStudentExited(st) && calculateDaysRemaining(st.subscription_end) <= 2
  ).length;
  const newLibStudentsCount = selectedLibStudents.filter((st) => isNewlyAddedStudent(st)).length;

  const filteredLibStudents = selectedLibStudents.filter((st) => {
    const code = getStudentAccessCode(st.id);
    const q = libStudentSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (st.name || '').toLowerCase().includes(q) ||
      (st.seat_number || '').toLowerCase().includes(q) ||
      (st.phone || '').toLowerCase().includes(q) ||
      (st.shift || '').toLowerCase().includes(q) ||
      code.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (libStudentFilter === 'expiring') {
      return !isStudentExited(st) && calculateDaysRemaining(st.subscription_end) <= 2;
    }
    if (libStudentFilter === 'new') {
      return isNewlyAddedStudent(st);
    }
    return true;
  });

  const LIB_STUDENTS_PER_PAGE = isDesktop ? 10 : 6;
  const totalLibStudentPages = Math.max(1, Math.ceil(filteredLibStudents.length / LIB_STUDENTS_PER_PAGE));
  const safeLibStudentPage = Math.min(libStudentPage, totalLibStudentPages - 1);
  const visibleLibStudents = filteredLibStudents.slice(
    safeLibStudentPage * LIB_STUDENTS_PER_PAGE,
    safeLibStudentPage * LIB_STUDENTS_PER_PAGE + LIB_STUDENTS_PER_PAGE
  );

  const portalUrl = getQrScanBaseOrigin();

  const isDbConnected = isSupabaseConfigured();

  const navTabs: { id: AdminTab; label: string; icon: React.ComponentType<any>; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'libraries', label: 'Libraries', icon: Building2 },
    { id: 'alerts', label: 'Alerts', icon: Bell, badge: totalAlertsCount },
    { id: 'codes', label: 'Pins', icon: KeyRound },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* SINGLE-SCREEN CONTENT STAGE */}
      <div className="flex-1 min-h-0 overflow-hidden max-w-6xl w-full mx-auto px-3 sm:px-6 py-2.5 sm:py-5 flex flex-col justify-between gap-2.5">
        
        {/* Optional Inline Error Banner */}
        {actionError && (
          <div className="p-2.5 sm:p-3 rounded-xl bg-red-100 border border-red-300 text-red-800 text-xs font-bold flex items-start justify-between gap-2 shrink-0">
            <span className="break-words leading-snug flex-1">{actionError}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {!isDbConnected && onOpenSupabaseModal && (
                <button
                  type="button"
                  onClick={onOpenSupabaseModal}
                  className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-black cursor-pointer whitespace-nowrap"
                >
                  DB Settings
                </button>
              )}
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="px-2 py-1 rounded-lg bg-red-200 text-red-900 font-black cursor-pointer"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5 sm:gap-4">
            {/* Compact Command Header */}
            <div className="bg-white p-3.5 sm:p-5 duo-card flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#ff9600] text-white flex items-center justify-center border-b-3 border-[#e08500] shrink-0">
                  <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display text-base sm:text-xl font-black text-[#3c3c3c] truncate">
                    Ekā Admin Dashboard
                  </h1>
                  <p className="text-[11px] sm:text-xs font-semibold text-slate-500 truncate">
                    Ekā Master Network · Code {adminCode}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    loadData();
                    playSound('pop');
                  }}
                  className="p-2.5 rounded-xl duo-btn-white text-slate-700 cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
                  title="Sync Database"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={openAddLibraryModal}
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1.5 cursor-pointer uppercase min-h-[40px] whitespace-nowrap"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Library</span>
                </button>
              </div>
            </div>

            {/* 2x2 Compact KPI Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4 shrink-0">
              <button
                type="button"
                onClick={() => handleSwitchTab('libraries')}
                className="bg-white p-3.5 sm:p-4 duo-card text-left cursor-pointer hover:border-[#58cc02] transition-colors flex flex-col justify-between"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Libraries
                  </span>
                  <Building2 className="w-4 h-4 text-[#58cc02]" />
                </div>
                <div className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c] tabular-nums mt-1">
                  {libraries.length}
                </div>
                <span className="text-[11px] font-bold text-[#46a302] truncate">
                  {activeSubs} active
                </span>
              </button>

              <div className="bg-white p-3.5 sm:p-4 duo-card flex flex-col justify-between">
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Total Seats
                  </span>
                  <Users className="w-4 h-4 text-[#1cb0f6]" />
                </div>
                <div className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c] tabular-nums mt-1">
                  {totalSeats}
                </div>
                <span className="text-[11px] font-bold text-slate-500 truncate">
                  Network capacity
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleSwitchTab('codes')}
                className="bg-white p-3.5 sm:p-4 duo-card text-left cursor-pointer hover:border-[#ff9600] transition-colors flex flex-col justify-between"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Active Pins
                  </span>
                  <KeyRound className="w-4 h-4 text-[#ff9600]" />
                </div>
                <div className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c] tabular-nums mt-1">
                  {activeCodesCount}
                </div>
                <span className="text-[11px] font-bold text-[#e08500] truncate">
                  {logins.length} issued total
                </span>
              </button>

                <button
                  type="button"
                  onClick={() => {
                    setAlertView(
                      pendingBroadcastsCount > 0
                        ? 'broadcasts'
                        : studentLifecycleAlerts.length > 0
                        ? 'exited'
                        : 'licenses'
                    );
                    handleSwitchTab('alerts');
                  }}
                  className={`p-3.5 sm:p-4 duo-card text-left cursor-pointer transition-colors flex flex-col justify-between ${
                    totalAlertsCount > 0 ? 'bg-amber-50 border-amber-300' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-700">
                      Alerts &amp; Queue
                    </span>
                    <Bell className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="font-display text-2xl sm:text-3xl font-black text-amber-900 tabular-nums mt-1">
                    {totalAlertsCount}
                  </div>
                  <span className="text-[11px] font-bold text-amber-700 truncate">
                    {pendingBroadcastsCount > 0
                      ? `${pendingBroadcastsCount} broadcast · ${studentLifecycleAlerts.length} student`
                      : studentLifecycleAlerts.length > 0
                      ? `${studentLifecycleAlerts.length} student · ${attentionLibraries.length} license`
                      : attentionLibraries.length > 0
                      ? `${attentionLibraries.length} license alerts`
                      : 'All clear'}
                  </span>
                </button>
              </div>

              {/* Bottom Sync / Quick Actions Panel (Fills remaining height cleanly) */}
              <div className="flex-1 min-h-0 bg-white p-4 sm:p-6 duo-card flex flex-col justify-between gap-2.5">
                {pendingBroadcastsCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAlertView('broadcasts');
                      handleSwitchTab('alerts');
                    }}
                    className="p-2.5 sm:p-3 rounded-2xl bg-emerald-50 border-2 border-emerald-200 hover:border-emerald-400 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors shrink-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-[#58cc02] text-white flex items-center justify-center shrink-0">
                        <Megaphone className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-emerald-950 truncate">
                          {pendingBroadcastsCount} Broadcast Request{pendingBroadcastsCount > 1 ? 's' : ''}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-800 truncate">
                          Tap to send via WhatsApp to library broadcast list
                        </div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl text-[10px] font-black duo-btn-green shrink-0 uppercase">
                      Send
                    </span>
                  </button>
                )}

                {studentLifecycleAlerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAlertView('exited');
                      handleSwitchTab('alerts');
                    }}
                    className="p-2.5 sm:p-3 rounded-2xl bg-amber-50 border-2 border-amber-200 hover:border-amber-400 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors shrink-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-[#ff9600] text-white flex items-center justify-center shrink-0">
                        <HeartHandshake className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-amber-950 truncate">
                          {studentLifecycleAlerts.length} Student Alert{studentLifecycleAlerts.length > 1 ? 's' : ''}
                        </div>
                        <div className="text-[10px] font-bold text-amber-800 truncate">
                          Joining, renewals, 2d expiry &amp; exit WhatsApp triggers ready
                        </div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl text-[10px] font-black duo-btn-orange shrink-0 uppercase">
                      View
                    </span>
                  </button>
                )}

              <div className="flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-2xl bg-[#FAFAFA] border-2 border-[#e5e5e5] flex items-center justify-center shrink-0">
                  <EkaSigmaIcon className="w-8 h-8" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate">
                    Quick Network Actions
                  </h2>
                  <p className="text-[11px] sm:text-xs font-medium text-slate-500 line-clamp-2">
                    Register study libraries, issue Student Pins &amp; owner codes, send exit thank-you notes, or monitor license renewals.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={openAddLibraryModal}
                  className="py-3 px-3 rounded-2xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer uppercase min-h-[44px]"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Add Library</span>
                </button>
                <button
                  type="button"
                  onClick={openAddCodeModal}
                  className="py-3 px-3 rounded-2xl text-xs font-black duo-btn-blue flex items-center justify-center gap-1.5 cursor-pointer uppercase min-h-[44px]"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Issue Code</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIBRARIES DIRECTORY OR DEDICATED LIBRARY MANAGEMENT PAGE */}
        {activeTab === 'libraries' && selectedLibrary && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2">
            {/* Dedicated Library Header + Quick License Controls */}
            <div className="bg-white p-2.5 sm:p-3.5 duo-card flex flex-col gap-2 shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setSelectedLibStudentDetail(null);
                      setSelectedLibrary(null);
                    }}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-black duo-btn-white flex items-center gap-1 cursor-pointer shrink-0 min-h-[36px]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                  <div className="min-w-0">
                    <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate leading-tight">
                      {selectedLibrary.name}
                    </h2>
                    <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 truncate leading-tight mt-0.5 tabular-nums">
                      {selectedLibrary.location} · {selectedLibStudents.length}/{selectedLibrary.total_seats} seats
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right flex flex-col items-end">
                  <span
                    className={`text-[10px] font-black uppercase leading-tight ${
                      (selectedLibrary.subscription_status || '').toLowerCase() === 'active'
                        ? 'text-[#46a302]'
                        : 'text-red-600'
                    }`}
                  >
                    {(selectedLibrary.subscription_status || '').toLowerCase() === 'active' ? 'Active' : 'Paused'}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap tabular-nums leading-tight mt-0.5">
                    Exp: {formatFriendlyDate(selectedLibrary.subscription_expiry)} ({calculateDaysRemaining(selectedLibrary.subscription_expiry)}d)
                  </span>
                </div>
              </div>

              {/* Clean Two-Row Responsive Action Controls Bar (zero horizontal overflow on mobile) */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 pt-1.5 border-t border-slate-100">
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setQrSheetPreviewPage(0);
                      setQrSheetLibrary(selectedLibrary);
                    }}
                    className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-white text-[#1899d6] flex items-center justify-center gap-1 cursor-pointer min-h-[32px] whitespace-nowrap"
                  >
                    <QrCode className="w-3 h-3 shrink-0" />
                    <span>View QRs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadLibraryMasterQrPdf(selectedLibrary)}
                    disabled={downloadingMasterQrLibId === selectedLibrary.id}
                    className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-blue flex items-center justify-center gap-1 cursor-pointer min-h-[32px] whitespace-nowrap disabled:opacity-60"
                  >
                    {downloadingMasterQrLibId === selectedLibrary.id ? (
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-3 h-3 shrink-0" />
                    )}
                    <span>Master QR PDF</span>
                  </button>
                </div>

                <div className="grid grid-cols-3 sm:flex sm:items-center gap-1.5">
                  <button
                    type="button"
                    disabled={updatingLibId === selectedLibrary.id}
                    onClick={() =>
                      handleToggleSubscriptionStatus(selectedLibrary.id, selectedLibrary.subscription_status)
                    }
                    className={`px-2.5 py-1.5 rounded-xl text-[10px] font-black flex items-center justify-center cursor-pointer min-h-[32px] whitespace-nowrap disabled:opacity-60 ${
                      (selectedLibrary.subscription_status || '').toLowerCase() === 'active'
                        ? 'duo-btn-red'
                        : 'duo-btn-green'
                    }`}
                  >
                    {(selectedLibrary.subscription_status || '').toLowerCase() === 'active'
                      ? 'Pause'
                      : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={updatingLibId === selectedLibrary.id}
                    onClick={() => handleExtendSubscription(selectedLibrary.id, 30)}
                    className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-green flex items-center justify-center cursor-pointer min-h-[32px] whitespace-nowrap disabled:opacity-60"
                  >
                    +30d
                  </button>
                  <button
                    type="button"
                    disabled={updatingLibId === selectedLibrary.id}
                    onClick={() => handleExtendSubscription(selectedLibrary.id, 90)}
                    className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-blue flex items-center justify-center cursor-pointer min-h-[32px] whitespace-nowrap disabled:opacity-60"
                  >
                    +90d
                  </button>
                </div>
              </div>
            </div>

            {/* Student Search & Filter Strip */}
            <div className="bg-white p-2.5 duo-card flex flex-col gap-1.5 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search student, seat, phone, pin..."
                  value={libStudentSearch}
                  onChange={(e) => setLibStudentSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden text-xs font-bold bg-white"
                />
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setLibStudentFilter('all')}
                  className={`flex-1 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                    libStudentFilter === 'all'
                      ? 'bg-white text-[#3c3c3c] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All ({selectedLibStudents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLibStudentFilter('expiring')}
                  className={`flex-1 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                    libStudentFilter === 'expiring'
                      ? 'bg-white text-amber-700 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Expiring ≤2d ({expiringLibStudentsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setLibStudentFilter('new')}
                  className={`flex-1 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                    libStudentFilter === 'new'
                      ? 'bg-white text-[#46a302] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  New ({newLibStudentsCount})
                </button>
              </div>
            </div>

            {/* Compact Single-Line Enrolled Students List Stage */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {loadingStudents ? (
                <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-xs font-bold text-slate-400">
                  Loading enrolled students...
                </div>
              ) : filteredLibStudents.length === 0 ? (
                <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                  <Users className="w-10 h-10 text-slate-300 mb-2" />
                  <h3 className="font-display text-sm font-black text-[#3c3c3c]">
                    {selectedLibStudents.length === 0 ? 'No Students Assigned Yet' : 'No Matching Students'}
                  </h3>
                  <p className="text-xs font-medium text-slate-500 mt-1 max-w-xs">
                    {selectedLibStudents.length === 0
                      ? 'Students enrolled in this library will appear here with 4-digit Student Pins and WhatsApp actions.'
                      : 'Try clearing your search or switching the filter tab.'}
                  </p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                  {/* Slim Table Column Header */}
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                    <span>Student · Seat · Shift ({filteredLibStudents.length})</span>
                    <span>Status</span>
                  </div>

                  {/* Compact Single-Line Interactive Student Rows */}
                  <div className="divide-y divide-slate-100 flex-1 min-h-0 overflow-y-auto">
                    {visibleLibStudents.map((st) => {
                      const exited = isStudentExited(st);
                      const daysLeft = calculateDaysRemaining(st.subscription_end);
                      const isExpired = !exited && daysLeft < 0;
                      const isExpiringUrgent = !exited && daysLeft >= 0 && daysLeft <= 2;
                      const isNew = isNewlyAddedStudent(st);
                      const shortShift = (st.shift || '').split('(')[0].trim();

                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            playSound('pop');
                            setCopiedStudentCode(false);
                            setSelectedLibStudentDetail(st);
                          }}
                          className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left cursor-pointer transition-colors min-h-[44px] group ${
                            isExpired
                              ? 'bg-red-50/40 hover:bg-red-50/80'
                              : isExpiringUrgent
                              ? 'bg-amber-50/40 hover:bg-amber-50/80'
                              : 'hover:bg-slate-50/90 active:bg-slate-100/80'
                          }`}
                        >
                          <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
                            <span className="font-display text-xs sm:text-sm font-black text-[#3c3c3c] group-hover:text-[#1899d6] truncate">
                              {st.name}
                            </span>
                            <span
                              className={`font-mono text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0 whitespace-nowrap ${
                                exited
                                  ? 'bg-slate-100 text-slate-500'
                                  : 'bg-sky-50 text-[#1899d6]'
                              }`}
                            >
                              #{st.seat_number}
                            </span>
                            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 truncate max-w-[74px] sm:max-w-[140px] shrink-0">
                              {shortShift}
                            </span>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {exited ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-black uppercase whitespace-nowrap">
                                Exited
                              </span>
                            ) : isExpired ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-red-600 uppercase whitespace-nowrap tabular-nums">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Exp {Math.abs(daysLeft)}d</span>
                              </span>
                            ) : isExpiringUrgent ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-amber-700 uppercase whitespace-nowrap tabular-nums">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>{daysLeft === 0 ? 'Due Today' : `${daysLeft}d left`}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-black text-[#46a302] whitespace-nowrap tabular-nums">
                                {isNew ? 'New · ' : ''}
                                {daysLeft}d
                              </span>
                            )}
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#1899d6] shrink-0" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Pagination Footer for Enrolled Students */}
            {filteredLibStudents.length > LIB_STUDENTS_PER_PAGE && (
              <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setLibStudentPage((p) => Math.max(0, p - 1));
                  }}
                  disabled={safeLibStudentPage === 0}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <span className="text-[11px] font-black text-slate-500 tabular-nums">
                  Page {safeLibStudentPage + 1} / {totalLibStudentPages}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setLibStudentPage((p) => Math.min(totalLibStudentPages - 1, p + 1));
                  }}
                  disabled={safeLibStudentPage >= totalLibStudentPages - 1}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: LIBRARIES DIRECTORY (Compact High-Density List/Table, Non-Scrolling) */}
        {activeTab === 'libraries' && !selectedLibrary && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2">
            {/* Compact Search & Filter Toolbar */}
            <div className="bg-white p-2.5 duo-card flex flex-col gap-1.5 shrink-0">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search library, city, owner..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={openAddLibraryModal}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1 cursor-pointer uppercase shrink-0 min-h-[36px]"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Add</span>
                </button>
              </div>

              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl">
                {(['all', 'active', 'attention'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setLibraryFilterStatus(status)}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-black capitalize transition-all cursor-pointer ${
                      libraryFilterStatus === status
                        ? 'bg-white text-[#3c3c3c] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {status === 'attention' ? `Alerts (${attentionLibraries.length})` : status}
                  </button>
                ))}
              </div>
            </div>

            {/* High-Density Library Table/List (5-6+ rows fit comfortably on 1 screen) */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {filteredLibraries.length === 0 ? (
                <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-[#FAFAFA] border-2 border-[#e5e5e5] flex items-center justify-center mb-2.5">
                    <EkaSigmaIcon className="w-9 h-9" />
                  </div>
                  <h3 className="font-display text-base font-black text-[#3c3c3c]">
                    {libraries.length === 0 ? 'No Libraries Registered' : 'No Matching Libraries'}
                  </h3>
                  <p className="text-xs font-medium text-slate-500 mt-1 mb-4 max-w-xs">
                    {libraries.length === 0
                      ? 'Add your first study library to generate an owner code.'
                      : 'Try clearing your search or status filter.'}
                  </p>
                  {libraries.length === 0 && (
                    <button
                      type="button"
                      onClick={openAddLibraryModal}
                      className="px-5 py-2.5 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase"
                    >
                      Add First Library
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                  {/* Slim Table Column Header */}
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                    <span>Library ({filteredLibraries.length})</span>
                    <span>Actions</span>
                  </div>

                  {/* Compact Streamlined Rows */}
                  <div className="divide-y divide-slate-100 flex-1 min-h-0 overflow-hidden">
                    {visibleLibraries.map((lib) => {
                      const isInactive = (lib.subscription_status || '').toLowerCase() !== 'active';
                      const daysLeft = calculateDaysRemaining(lib.subscription_expiry);
                      const isExpired = daysLeft < 0;
                      const isExpiringSoon = daysLeft >= 0 && daysLeft <= 5;

                      return (
                        <div
                          key={lib.id}
                          className="px-3.5 py-2 flex items-center justify-between gap-2.5 hover:bg-slate-50/70 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenLibraryDetails(lib)}
                            className="min-w-0 flex-1 text-left cursor-pointer group"
                          >
                            <div className="font-display text-xs sm:text-sm font-black text-[#3c3c3c] group-hover:text-[#1899d6] truncate leading-tight">
                              {lib.name}
                            </div>
                            <div className="text-[10px] font-semibold text-slate-400 truncate leading-tight mt-0.5 tabular-nums">
                              <span>{lib.location}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{lib.total_seats} seats</span>
                              <span aria-hidden="true"> · </span>
                              <span
                                className={`font-black ${
                                  isInactive || isExpired
                                    ? 'text-red-600'
                                    : isExpiringSoon
                                    ? 'text-amber-600'
                                    : 'text-[#46a302]'
                                }`}
                              >
                                {isInactive ? 'Inactive' : isExpired ? 'Expired' : `${daysLeft}d left`}
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                playSound('pop');
                                setQrSheetPreviewPage(0);
                                setQrSheetLibrary(lib);
                              }}
                              className="px-2 py-1.5 rounded-xl text-[11px] font-black duo-btn-white text-[#1899d6] flex items-center gap-1 cursor-pointer min-h-[34px]"
                              title={`View & Download Master QR PDF for ${lib.name}`}
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">QR</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenLibraryDetails(lib)}
                              className="px-2.5 py-1.5 rounded-xl text-[11px] font-black duo-btn-blue flex items-center gap-0.5 cursor-pointer min-h-[34px]"
                            >
                              <span>Manage</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteLibraryError(null);
                                setConfirmDeleteLib({ id: lib.id, name: lib.name });
                              }}
                              className="p-1.5 rounded-xl duo-btn-white text-red-500 hover:text-red-700 cursor-pointer min-h-[34px] min-w-[34px] flex items-center justify-center"
                              title={`Delete ${lib.name}`}
                              aria-label={`Delete ${lib.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Compact Pagination Footer (shown when more than 1 page) */}
            {filteredLibraries.length > LIBS_PER_PAGE && (
              <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setLibPage((p) => Math.max(0, p - 1));
                  }}
                  disabled={safeLibPage === 0}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setLibPage((p) => Math.min(totalLibPages - 1, p + 1));
                  }}
                  disabled={safeLibPage >= totalLibPages - 1}
                  className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACCESS CODES (Paginated, Non-Scrolling) */}
        {activeTab === 'codes' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
            {/* Search & Role Filter Toolbar */}
            <div className="bg-white p-3 duo-card flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search pin..."
                    value={codeSearchQuery}
                    onChange={(e) => setCodeSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={openAddCodeModal}
                  className="px-3 py-2 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1 cursor-pointer uppercase shrink-0 min-h-[40px]"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>New</span>
                </button>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                {(['all', 'admin', 'owner', 'student'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCodeFilterRole(r)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase transition-all cursor-pointer ${
                      codeFilterRole === r
                        ? 'bg-white text-[#3c3c3c] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {r === 'student' ? 'Student Pin' : r}
                  </button>
                ))}
              </div>
            </div>

            {/* Paginated Codes List (Fits 4 compact rows cleanly on 1 screen) */}
            <div className="flex-1 min-h-0 flex flex-col justify-start gap-2 overflow-hidden">
              {filteredLogins.length === 0 ? (
                <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                  <KeyRound className="w-10 h-10 text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-500">No matching Student Pins or codes found.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0 content-start">
                  {visibleLogins.map((item) => (
                    <div
                      key={item.code}
                      className="bg-white p-3 duo-card flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-black text-sm text-[#3c3c3c] tracking-wide truncate">
                            {item.role === 'student' ? (item.student_pin || item.code) : item.code}
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase ${
                              item.role === 'admin'
                                ? 'text-[#e08500]'
                                : item.role === 'owner'
                                ? 'text-[#1899d6]'
                                : 'text-[#46a302]'
                            }`}
                          >
                            · {item.role === 'student' ? 'Student Pin' : item.role}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                          Ref: {item.reference_id || 'None'}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleCode(item.code, item.is_active)}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black cursor-pointer min-h-[36px] ${
                            item.is_active
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {item.is_active ? 'Active' : 'Off'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteCodeError(null);
                            setConfirmDeleteCode(item.code);
                          }}
                          className="p-1.5 rounded-xl duo-btn-white text-red-500 hover:text-red-700 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                          title="Delete Code"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination Footer */}
            {filteredLogins.length > 0 && (
              <div className="bg-white px-3 py-2 duo-card flex items-center justify-between shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setCodePage((p) => Math.max(0, p - 1));
                  }}
                  disabled={safeCodePage === 0}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playSound('pop');
                    setCodePage((p) => Math.min(totalCodePages - 1, p + 1));
                  }}
                  disabled={safeCodePage >= totalCodePages - 1}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[36px]"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ALERTS, BROADCAST QUEUE & NOTIFICATIONS PANEL */}
        {activeTab === 'alerts' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
            {/* Hide top segment header when inside a dedicated Library WhatsApp Chat Window */}
            {!(alertView === 'broadcasts' && selectedBroadcastLibraryId) && (
              <div className="bg-white p-3 duo-card flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#ff9600]/15 text-[#e08500] flex items-center justify-center shrink-0">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="font-display text-sm sm:text-base font-black text-[#3c3c3c] truncate">
                        Broadcasts &amp; Alerts ({totalAlertsCount})
                      </h2>
                      <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 truncate">
                        Select a library chat to forward WhatsApp notices, or manage alerts
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadData();
                      playSound('pop');
                    }}
                    className="p-2 rounded-xl duo-btn-white text-slate-700 cursor-pointer shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    title="Refresh Alerts"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAlertView('broadcasts');
                      setSelectedBroadcastLibraryId(null);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] sm:text-[11px] font-black transition-all cursor-pointer truncate ${
                      alertView === 'broadcasts'
                        ? 'bg-white text-[#46a302] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Broadcasts ({pendingBroadcastsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAlertView('exited');
                      setSelectedBroadcastLibraryId(null);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] sm:text-[11px] font-black transition-all cursor-pointer truncate ${
                      alertView === 'exited'
                        ? 'bg-white text-[#e08500] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Students ({studentLifecycleAlerts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAlertView('licenses');
                      setSelectedBroadcastLibraryId(null);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] sm:text-[11px] font-black transition-all cursor-pointer truncate ${
                      alertView === 'licenses'
                        ? 'bg-white text-[#3c3c3c] shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Licenses ({attentionLibraries.length})
                  </button>
                </div>
              </div>
            )}

            {/* Dedicated Broadcasts Section: Library-Wise WhatsApp Inbox OR Isolated Library Chat Window */}
            {alertView === 'broadcasts' && (
              selectedBroadcastLibraryId ? (
                /* WHATSAPP-STYLE DEDICATED CHAT WINDOW FOR SELECTED LIBRARY */
                <div className="flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden border-2 border-[#d1d7db] shadow-xs bg-[#efeae2]">
                  {/* Dark Green WhatsApp Chat Header */}
                  <div className="bg-[#075e54] text-white px-3 py-2.5 flex items-center justify-between gap-2 shrink-0 shadow-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setSelectedBroadcastLibraryId(null);
                        }}
                        className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                        title="Back to Library Inbox"
                        aria-label="Back to Library Inbox"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>

                      <div className="w-9 h-9 rounded-full bg-[#25d366] text-white flex items-center justify-center font-black text-xs shrink-0 shadow-2xs uppercase">
                        {activeThreadLibraryName
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((w) => w[0])
                          .join('') || 'SL'}
                      </div>

                      <div className="min-w-0">
                        <h3 className="font-display text-sm sm:text-base font-black text-white truncate leading-tight">
                          {activeThreadLibraryName}
                        </h3>
                        <p className="text-[10px] sm:text-[11px] font-semibold text-emerald-100/90 truncate leading-tight mt-0.5">
                          {activeThreadMessages.length > 0
                            ? `${activeThreadMessages.length} active notice${
                                activeThreadMessages.length === 1 ? '' : 's'
                              } in queue`
                            : 'All broadcast notices cleared'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        void syncBroadcastQueueSilently();
                      }}
                      className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                      title="Refresh Library Chat"
                      aria-label="Refresh Library Chat"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Scrollable Chat-Bubble History for This Specific Library */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-4 space-y-3 scroll-smooth">
                    <div className="flex justify-center">
                      <div className="bg-[#fff3c4] text-[#54461d] text-[10px] sm:text-[11px] font-semibold px-3 py-1.5 rounded-xl max-w-sm text-center shadow-2xs border border-amber-200/70">
                        Sent messages stay in <strong>{activeThreadLibraryName}</strong> so you can <strong>Send Again</strong> anytime. Tap <strong>Clear (×)</strong> once delivered.
                      </div>
                    </div>

                    {activeThreadMessages.length === 0 ? (
                      <div className="py-10 flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 rounded-full bg-white/95 text-[#25d366] flex items-center justify-center shadow-xs mb-2.5">
                          <CheckCircle2 className="w-7 h-7" />
                        </div>
                        <p className="font-display text-sm font-black text-slate-800">
                          All Caught Up for {activeThreadLibraryName}!
                        </p>
                        <p className="text-[11px] font-semibold text-slate-500 max-w-xs mt-1 mb-4">
                          Every broadcast notice from this library has been manually cleared from its queue.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            playSound('pop');
                            setSelectedBroadcastLibraryId(null);
                          }}
                          className="px-4 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          <span>Back to Library Inbox</span>
                        </button>
                      </div>
                    ) : (
                      activeThreadMessages.map((req, idx) => {
                        const dateIso = req.created_at ? req.created_at.split('T')[0] : '';
                        const prevDateIso =
                          idx > 0 && activeThreadMessages[idx - 1].created_at
                            ? activeThreadMessages[idx - 1].created_at.split('T')[0]
                            : '';
                        const showDateDivider = idx === 0 || (dateIso && dateIso !== prevDateIso);
                        const timeLabel = req.created_at
                          ? new Date(req.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '';
                        const waBroadcastUrl = generateWhatsAppBroadcastUrl(req.message);
                        const isSent = req.status === 'sent';

                        return (
                          <React.Fragment key={req.id}>
                            {showDateDivider && dateIso && (
                              <div className="flex justify-center pt-1 pb-0.5">
                                <span className="bg-white/95 text-slate-600 text-[10px] font-black px-2.5 py-0.5 rounded-lg shadow-2xs border border-slate-200/70 uppercase tracking-wide">
                                  {formatFriendlyDate(dateIso)}
                                </span>
                              </div>
                            )}

                            <div className="flex justify-start items-end gap-2">
                              {/* Incoming Library Notice Bubble */}
                              <div className="bg-white text-[#111b21] rounded-2xl rounded-tl-xs px-3.5 py-2.5 max-w-[78%] sm:max-w-[72%] shadow-xs border border-slate-200/80">
                                <p className="text-xs sm:text-[13px] font-medium whitespace-pre-wrap break-words leading-relaxed">
                                  {req.message.split(/(\*[^*\n]+\*)/g).map((part, pIdx) =>
                                    part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
                                      <strong key={pIdx} className="font-black text-[#0b141a]">
                                        {part.slice(1, -1)}
                                      </strong>
                                    ) : (
                                      <React.Fragment key={pIdx}>{part}</React.Fragment>
                                    )
                                  )}
                                </p>
                                <div className="flex items-center justify-between gap-3 mt-1.5 pt-1 border-t border-slate-100">
                                  {isSent ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] font-black uppercase text-emerald-700">
                                      <Check className="w-3 h-3 stroke-[3]" />
                                      Sent
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-black uppercase text-amber-600">
                                      Pending
                                    </span>
                                  )}
                                  <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
                                    {timeLabel}
                                  </span>
                                </div>
                              </div>

                              {/* Direct Bubble Actions: Eye (Edit/Preview), Send / Send Again, Manual Clear */}
                              <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
                                <button
                                  type="button"
                                  onClick={() => openBroadcastModal(req)}
                                  className="w-8 h-8 rounded-full bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-200/80 shadow-xs flex items-center justify-center cursor-pointer transition-colors"
                                  title="Preview & edit message"
                                  aria-label="Preview & edit message"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>

                                <a
                                  href={waBroadcastUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => void handleMarkBroadcastSent(req)}
                                  className={
                                    isSent
                                      ? 'h-8 px-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] sm:text-[11px] font-black shadow-sm inline-flex items-center justify-center gap-1 cursor-pointer transition-transform active:scale-95 whitespace-nowrap'
                                      : 'w-9 h-9 rounded-full bg-black hover:bg-neutral-800 text-white shadow-sm flex items-center justify-center cursor-pointer transition-transform active:scale-95'
                                  }
                                  title={
                                    isSent
                                      ? `Send Again via WhatsApp for ${activeThreadLibraryName}`
                                      : `Send via WhatsApp for ${activeThreadLibraryName}`
                                  }
                                  aria-label={
                                    isSent
                                      ? `Send again broadcast for ${activeThreadLibraryName}`
                                      : `Send broadcast for ${activeThreadLibraryName}`
                                  }
                                >
                                  {isSent ? (
                                    <>
                                      <RotateCcw className="w-3 h-3 stroke-[2.5]" />
                                      <span>Send Again</span>
                                    </>
                                  ) : (
                                    <svg
                                      viewBox="0 0 24 24"
                                      className="w-4 h-4 fill-current translate-x-[0.5px]"
                                      aria-hidden="true"
                                    >
                                      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                                    </svg>
                                  )}
                                </a>

                                <button
                                  type="button"
                                  onClick={() => void handleDeleteBroadcastRequest(req.id)}
                                  className="w-8 h-8 rounded-full bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200/90 shadow-2xs flex items-center justify-center cursor-pointer transition-colors"
                                  title="Clear / Dismiss delivered message"
                                  aria-label="Clear and dismiss broadcast message"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      })
                    )}

                    <div ref={adminChatBottomRef} />
                  </div>
                </div>
              ) : (
                /* WHATSAPP-STYLE LIBRARY INBOX LIST VIEW */
                <>
                  <div className="flex-1 min-h-0 flex flex-col justify-start overflow-hidden">
                    {broadcastThreads.length === 0 ? (
                      <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                        <Megaphone className="w-10 h-10 text-[#58cc02]/70 mb-2" />
                        <h3 className="font-display text-base font-black text-[#3c3c3c]">
                          No Pending Broadcast Requests
                        </h3>
                        <p className="text-xs font-medium text-slate-500 mt-1 max-w-xs">
                          When library owners submit holiday, cleaning, or maintenance notices, each library appears here like a WhatsApp chat inbox.
                        </p>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                        {/* Slim Inbox Header */}
                        <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                          <span>Active Library Chats ({broadcastThreads.length})</span>
                          <span>Unread</span>
                        </div>

                        {/* Library Chat Threads */}
                        <div className="divide-y divide-slate-100 flex-1 min-h-0 overflow-y-auto">
                          {visibleBroadcastThreads.map((thread) => {
                            const latestPreview = thread.latestMessage.message
                              .replace(/\*/g, '')
                              .replace(/\s+/g, ' ')
                              .trim();
                            const latestTime = thread.latestMessage.created_at
                              ? new Date(thread.latestMessage.created_at).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '';
                            const initials =
                              thread.library_name
                                .split(/\s+/)
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((w) => w[0])
                                .join('') || 'SL';

                            return (
                              <button
                                key={thread.library_id}
                                type="button"
                                onClick={() => {
                                  playSound('pop');
                                  setSelectedBroadcastLibraryName(thread.library_name);
                                  setSelectedBroadcastLibraryId(thread.library_id);
                                }}
                                className="w-full px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-emerald-50/50 active:bg-emerald-50 transition-colors cursor-pointer text-left group"
                              >
                                <div className="w-10 h-10 rounded-full bg-[#075e54] text-white font-black text-xs flex items-center justify-center shrink-0 shadow-2xs uppercase">
                                  {initials}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-display text-xs sm:text-sm font-black text-[#3c3c3c] group-hover:text-[#075e54] truncate leading-tight">
                                      {thread.library_name}
                                    </span>
                                    {latestTime && (
                                      <span className="text-[10px] font-bold text-[#075e54] tabular-nums shrink-0">
                                        {latestTime}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                                    {latestPreview}
                                  </p>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {thread.unreadCount > 0 ? (
                                    <span
                                      className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#25d366] text-white text-[11px] font-black flex items-center justify-center tabular-nums shadow-2xs"
                                      title={`${thread.unreadCount} pending request${
                                        thread.unreadCount === 1 ? '' : 's'
                                      }`}
                                    >
                                      {thread.unreadCount}
                                    </span>
                                  ) : (
                                    <span
                                      className="px-2 h-[22px] rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-black flex items-center justify-center tabular-nums"
                                      title={`${thread.messages.length} sent — awaiting manual clear`}
                                    >
                                      Sent ({thread.messages.length})
                                    </span>
                                  )}
                                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#075e54] transition-colors" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {broadcastThreads.length > BROADCASTS_PER_PAGE && (
                    <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setBroadcastPage((p) => Math.max(0, p - 1));
                        }}
                        disabled={safeBroadcastPage === 0}
                        className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Prev</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setBroadcastPage((p) => Math.min(totalBroadcastPages - 1, p + 1));
                        }}
                        disabled={safeBroadcastPage >= totalBroadcastPages - 1}
                        className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )
            )}

            {/* Student Lifecycle Alerts: 4 Distinct Group Folders (New Joining, Renewals, 2d Exp, Exited) */}
            {alertView === 'exited' && (() => {
              const studentAlertGroups: {
                id: 'joining' | 'renewed' | 'expiring' | 'exited';
                label: string;
                subtitle: string;
                emptyTitle: string;
                emptyDesc: string;
                icon: React.ComponentType<any>;
                count: number;
                activeCardClass: string;
                activeIconClass: string;
                idleIconClass: string;
                activeCountClass: string;
              }[] = [
                {
                  id: 'joining',
                  label: 'New Joining',
                  subtitle: 'Welcome alerts',
                  emptyTitle: 'No Pending New Joinings',
                  emptyDesc: 'All newly registered student welcome broadcasts have been dispatched.',
                  icon: UserPlus,
                  count: studentAlertCounts.joining,
                  activeCardClass: 'border-[#58cc02] bg-emerald-50/80',
                  activeIconClass: 'bg-[#58cc02] text-white',
                  idleIconClass: 'bg-emerald-50 text-emerald-700',
                  activeCountClass: 'text-[#46a302]',
                },
                {
                  id: 'renewed',
                  label: 'Renewals',
                  subtitle: 'Renewed plans',
                  emptyTitle: 'No Pending Renewal Alerts',
                  emptyDesc: 'Owner-submitted subscription renewals ready for WhatsApp confirmation appear here.',
                  icon: RefreshCw,
                  count: studentAlertCounts.renewed,
                  activeCardClass: 'border-[#1cb0f6] bg-sky-50/80',
                  activeIconClass: 'bg-[#1cb0f6] text-white',
                  idleIconClass: 'bg-sky-50 text-sky-700',
                  activeCountClass: 'text-[#1899d6]',
                },
                {
                  id: 'expiring',
                  label: '2d Exp',
                  subtitle: 'Expiry alerts',
                  emptyTitle: 'No 2-Day Expiry Alerts',
                  emptyDesc: 'No active students are expiring today or within the next 2 days.',
                  icon: AlertTriangle,
                  count: studentAlertCounts.expiring,
                  activeCardClass: 'border-rose-500 bg-rose-50/80',
                  activeIconClass: 'bg-rose-500 text-white',
                  idleIconClass: 'bg-rose-50 text-rose-600',
                  activeCountClass: 'text-rose-600',
                },
                {
                  id: 'exited',
                  label: 'Exited',
                  subtitle: 'Left library',
                  emptyTitle: 'No Pending Exit Alerts',
                  emptyDesc: 'Thank-you alerts for students who left the library appear here.',
                  icon: LogOut,
                  count: studentAlertCounts.exited,
                  activeCardClass: 'border-[#ff9600] bg-amber-50/80',
                  activeIconClass: 'bg-[#ff9600] text-white',
                  idleIconClass: 'bg-amber-50 text-amber-700',
                  activeCountClass: 'text-[#e08500]',
                },
              ];

              const activeGroupMeta =
                studentAlertGroups.find((g) => g.id === studentAlertFilter) || studentAlertGroups[0];

              return (
                <>
                  {/* 4 Prominent Group Folder Tabs */}
                  <div
                    role="tablist"
                    aria-label="Student alert categories"
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0"
                  >
                    {studentAlertGroups.map((group) => {
                      const GroupIcon = group.icon;
                      const isActive = studentAlertFilter === group.id;

                      return (
                        <button
                          key={group.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => {
                            playSound('pop');
                            hasManuallyPickedAlertGroupRef.current = true;
                            setStudentAlertFilter(group.id);
                            setExitedAlertPage(0);
                          }}
                          className={`p-2.5 sm:p-3 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between gap-1 min-h-[64px] ${
                            isActive
                              ? `${group.activeCardClass} shadow-xs`
                              : 'bg-white border-[#e5e5e5] hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5 w-full">
                            <div
                              className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                isActive ? group.activeIconClass : group.idleIconClass
                              }`}
                            >
                              <GroupIcon className="w-3.5 h-3.5 stroke-[2.5]" />
                            </div>
                            <span
                              className={`font-display text-base sm:text-lg font-black tabular-nums leading-none ${
                                isActive
                                  ? group.activeCountClass
                                  : group.count > 0
                                  ? 'text-[#3c3c3c]'
                                  : 'text-slate-300'
                              }`}
                            >
                              {group.count}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <div className="font-display text-xs font-black text-[#3c3c3c] truncate leading-tight">
                              {group.label}
                            </div>
                            <div className="text-[10px] font-semibold text-slate-500 truncate leading-tight">
                              {group.subtitle}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Group Folder List Container */}
                  <div className="flex-1 min-h-0 flex flex-col justify-start overflow-hidden">
                    <div className="flex-1 min-h-0 bg-white duo-card flex flex-col overflow-hidden">
                      {/* Folder Header + Scalable In-Group Search */}
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
                        <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                          <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 truncate tabular-nums">
                            {activeGroupMeta.label} · {filteredStudentAlerts.length} pending
                          </span>
                          {!studentAlertQuery && filteredStudentAlerts.length > 0 && (
                            <span className="sm:hidden text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                              Actions
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {studentAlertCounts[studentAlertFilter] > 0 && (
                            <div className="relative flex-1 sm:w-56">
                              <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={studentAlertSearch}
                                onChange={(e) => setStudentAlertSearch(e.target.value)}
                                placeholder={`Search ${activeGroupMeta.label.toLowerCase()}...`}
                                aria-label={`Search ${activeGroupMeta.label} alerts`}
                                className="w-full pl-7 pr-7 py-1 rounded-lg border border-slate-200 bg-white focus:border-[#1cb0f6] focus:outline-hidden text-[11px] font-bold text-slate-700"
                              />
                              {studentAlertSearch && (
                                <button
                                  type="button"
                                  onClick={() => setStudentAlertSearch('')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                                  aria-label="Clear search"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                          <span className="hidden sm:inline text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">
                            Actions
                          </span>
                        </div>
                      </div>

                      {filteredStudentAlerts.length === 0 ? (
                        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
                          <CheckCircle2 className="w-10 h-10 text-[#58cc02] mb-2" />
                          <h3 className="font-display text-base font-black text-[#3c3c3c]">
                            {studentAlertQuery
                              ? `No Matches in ${activeGroupMeta.label}`
                              : activeGroupMeta.emptyTitle}
                          </h3>
                          <p className="text-xs font-medium text-slate-500 mt-1 max-w-xs">
                            {studentAlertQuery
                              ? 'Try another student name, library, seat number, or phone.'
                              : activeGroupMeta.emptyDesc}
                          </p>
                          {studentAlertQuery && (
                            <button
                              type="button"
                              onClick={() => setStudentAlertSearch('')}
                              className="mt-3 px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                            >
                              Clear Search
                            </button>
                          )}
                        </div>
                      ) : (
                        /* High-Density Compact List Rows for the Selected Category */
                        <div className="divide-y divide-slate-100 flex-1 min-h-0 overflow-y-auto">
                          {visibleStudentAlerts.map((alert) => {
                            const st = alert.student;
                            const studentPin = getStudentCodeForAlert(st);

                            let badgeText = 'EXITED';
                            let badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
                            let defaultMessage = buildStudentThankYouMessage(st.name, alert.libraryName);

                            if (alert.type === 'joining') {
                              badgeText = 'NEW JOINING';
                              badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                              defaultMessage = buildStudentJoiningMessage(
                                st.name,
                                alert.libraryName,
                                st.seat_number,
                                st.shift,
                                st.subscription_end,
                                studentPin
                              );
                            } else if (alert.type === 'renewed') {
                              badgeText = 'RENEWED';
                              badgeClass = 'bg-sky-100 text-sky-800 border-sky-200';
                              defaultMessage = buildStudentRenewalMessage(
                                st.name,
                                alert.libraryName,
                                st.seat_number,
                                st.subscription_end,
                                st.shift,
                                studentPin
                              );
                            } else if (alert.type === 'expiring') {
                              const urgent = alert.daysLeft <= 1;
                              badgeText =
                                alert.daysLeft === 0
                                  ? 'EXPIRES TODAY'
                                  : alert.daysLeft === 1
                                  ? '1 DAY LEFT'
                                  : '2 DAYS LEFT';
                              badgeClass = urgent
                                ? 'bg-rose-100 text-rose-700 border-rose-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200';
                              defaultMessage = buildStudentReminderMessage(
                                st.name,
                                alert.libraryName,
                                st.seat_number,
                                st.subscription_end,
                                alert.daysLeft,
                                studentPin
                              );
                            }

                            const waUrl = generateWhatsAppToPhoneUrl(st.phone, defaultMessage);
                            const shiftShort = (st.shift || '').split('(')[0].trim();
                            const alreadySent = isStudentAlertSent(alert);

                            return (
                              <div
                                key={alert.key}
                                className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 hover:bg-slate-50/80 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    <span className="font-display text-xs sm:text-sm font-black text-[#3c3c3c] truncate leading-tight">
                                      {st.name}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-tight shrink-0 ${badgeClass}`}
                                    >
                                      {badgeText}
                                    </span>
                                    {alreadySent && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200 text-[9px] font-black uppercase tracking-tight shrink-0">
                                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                                        SENT
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[10px] sm:text-[11px] font-semibold text-slate-500 truncate leading-tight mt-0.5 tabular-nums">
                                    <span className="font-bold text-slate-600">{alert.libraryName}</span>
                                    <span aria-hidden="true"> · </span>
                                    <span>
                                      Seat #{st.seat_number}
                                      {alert.type === 'exited' ? ' (Freed)' : ''}
                                    </span>
                                    <span aria-hidden="true"> · </span>
                                    <span>{shiftShort}</span>
                                    {alert.triggerDate && (
                                      <>
                                        <span aria-hidden="true"> · </span>
                                        <span>
                                          {alert.type === 'expiring' ? 'Ends ' : ''}
                                          {formatFriendlyDate(alert.triggerDate)}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      playSound('pop');
                                      setEditStudentAlertText(defaultMessage);
                                      setSelectedStudentAlertModal({
                                        alert,
                                        badgeText,
                                        badgeClass,
                                        defaultMessage,
                                      });
                                    }}
                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-950 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                                    title="Preview & edit WhatsApp message"
                                    aria-label={`Preview or edit message for ${st.name}`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>

                                  <a
                                    href={waUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => void handleMarkStudentAlertSent(alert)}
                                    className={
                                      alreadySent
                                        ? 'h-8 px-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] sm:text-[11px] font-black shadow-xs inline-flex items-center justify-center gap-1 cursor-pointer transition-transform active:scale-95 shrink-0 whitespace-nowrap'
                                        : 'w-8 h-8 rounded-full bg-black hover:bg-neutral-800 text-white shadow-xs flex items-center justify-center cursor-pointer transition-transform active:scale-95 shrink-0'
                                    }
                                    title={
                                      alreadySent
                                        ? `Send Again via WhatsApp to ${st.name}`
                                        : `Send WhatsApp to ${st.name}`
                                    }
                                    aria-label={
                                      alreadySent
                                        ? `Send again WhatsApp to ${st.name}`
                                        : `Send WhatsApp to ${st.name}`
                                    }
                                  >
                                    {alreadySent ? (
                                      <>
                                        <RotateCcw className="w-3 h-3 stroke-[2.5]" />
                                        <span>Send Again</span>
                                      </>
                                    ) : (
                                      <svg
                                        viewBox="0 0 24 24"
                                        className="w-3.5 h-3.5 fill-current translate-x-[0.5px]"
                                        aria-hidden="true"
                                      >
                                        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                                      </svg>
                                    )}
                                  </a>

                                  <button
                                    type="button"
                                    onClick={() => void handleAcknowledgeStudentLifecycleAlert(alert, false)}
                                    className="w-8 h-8 rounded-full bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                                    title="Clear / Dismiss alert"
                                    aria-label={`Clear and dismiss alert for ${st.name}`}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {filteredStudentAlerts.length > EXITED_ALERTS_PER_PAGE && (
                    <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setExitedAlertPage((p) => Math.max(0, p - 1));
                        }}
                        disabled={safeExitedAlertPage === 0}
                        className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        <span>Prev</span>
                      </button>
                      <span className="text-[11px] font-black text-slate-500 tabular-nums">
                        Page {safeExitedAlertPage + 1} of {totalExitedAlertPages} · {filteredStudentAlerts.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          playSound('pop');
                          setExitedAlertPage((p) => Math.min(totalExitedAlertPages - 1, p + 1));
                        }}
                        disabled={safeExitedAlertPage >= totalExitedAlertPages - 1}
                        className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                      >
                        <span>Next</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Library License Expiry Alerts (2 Days Before Expiry & Expiry Day WhatsApp Triggers) */}
            {alertView === 'licenses' && (
              <>
                <div className="flex-1 min-h-0 flex flex-col justify-start overflow-hidden">
                  {attentionLibraries.length === 0 ? (
                    <div className="flex-1 bg-white p-6 duo-card flex flex-col items-center justify-center text-center">
                      <CheckCircle2 className="w-10 h-10 text-[#58cc02] mb-2" />
                      <h3 className="font-display text-base font-black text-[#3c3c3c]">
                        All Libraries Active
                      </h3>
                      <p className="text-xs font-medium text-slate-500 mt-1 max-w-xs">
                        No library licenses expiring within 7 days, on expiry day, or paused.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0 content-start">
                      {visibleAlerts.map((lib) => {
                        const daysLeft = calculateDaysRemaining(lib.subscription_expiry);
                        const isInactive = (lib.subscription_status || '').toLowerCase() !== 'active';
                        const isExpiryDay = !isInactive && daysLeft === 0;
                        const isTwoDaysTrigger = !isInactive && (daysLeft === 2 || daysLeft === 1);
                        const isSent = sentLicenseIds.includes(lib.id);

                        let badgeText = `${daysLeft}d Left`;
                        let badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
                        let cardTheme = 'bg-amber-50/70 border-amber-200';
                        let waBtnLabel = 'Send Renewal WA';

                        if (isInactive) {
                          badgeText = 'Paused';
                          badgeClass = 'bg-slate-200 text-slate-700 border-slate-300';
                          cardTheme = 'bg-slate-50 border-slate-300';
                          waBtnLabel = 'Send Follow-Up WA';
                        } else if (isExpiryDay) {
                          badgeText = 'Expiry Day';
                          badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
                          cardTheme = 'bg-rose-50/80 border-rose-300';
                          waBtnLabel = 'Send Expiry Alert WA';
                        } else if (isTwoDaysTrigger) {
                          badgeText = daysLeft === 2 ? '2 Days Left' : '1 Day Left';
                          badgeClass = 'bg-amber-100 text-amber-900 border-amber-300';
                          cardTheme = 'bg-amber-50/80 border-amber-300';
                          waBtnLabel = daysLeft === 2 ? 'Send 2d Reminder WA' : 'Send Reminder WA';
                        } else if (daysLeft < 0) {
                          badgeText = `Expired ${Math.abs(daysLeft)}d ago`;
                          badgeClass = 'bg-rose-100 text-rose-800 border-rose-200';
                          cardTheme = 'bg-rose-50/60 border-rose-200';
                          waBtnLabel = 'Send Renewal WA';
                        }

                        const licenseWaUrl = generateWhatsAppLibraryLicenseUrl(
                          lib.contact_phone,
                          lib.owner_name,
                          lib.name,
                          lib.subscription_expiry,
                          daysLeft,
                          isInactive
                        );
                        const ownerCallUrl = generatePhoneCallUrl(lib.contact_phone);

                        return (
                          <div
                            key={lib.id}
                            className={`p-3.5 rounded-2xl border-2 flex flex-col justify-between gap-2.5 ${cardTheme}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h4 className="font-display font-black text-xs sm:text-sm text-[#3c3c3c] truncate">
                                    {lib.name}
                                  </h4>
                                  <span
                                    className={`px-1.5 py-0.5 rounded-md border text-[9px] font-black uppercase shrink-0 ${badgeClass}`}
                                  >
                                    {badgeText}
                                  </span>
                                </div>
                                <p className="text-[11px] font-bold text-slate-700 truncate mt-0.5">
                                  Owner: {lib.owner_name} · Exp {formatFriendlyDate(lib.subscription_expiry)}
                                </p>
                              </div>

                              <a
                                href={ownerCallUrl}
                                className="w-8 h-8 rounded-xl duo-btn-blue flex items-center justify-center cursor-pointer shrink-0"
                                title={`Call ${lib.owner_name}`}
                                aria-label={`Call ${lib.owner_name}`}
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <a
                                href={licenseWaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  playSound('success');
                                  setSentLicenseIds((prev) =>
                                    prev.includes(lib.id) ? prev : [...prev, lib.id]
                                  );
                                }}
                                className={`flex-1 py-1.5 px-3 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 cursor-pointer min-h-[34px] transition-colors ${
                                  isExpiryDay
                                    ? 'duo-btn-red'
                                    : isSent
                                    ? 'bg-emerald-600 text-white'
                                    : 'duo-btn-green'
                                }`}
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span className="truncate">
                                  {isSent ? 'WA Sent ✓ (Resend)' : waBtnLabel}
                                </span>
                              </a>
                              <button
                                type="button"
                                onClick={() => handleExtendSubscription(lib.id, 30)}
                                className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-white text-emerald-700 cursor-pointer min-h-[34px] shrink-0"
                                title="Extend license by 30 days"
                              >
                                +30d
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleSubscriptionStatus(lib.id, lib.subscription_status)}
                                className="px-2.5 py-1.5 rounded-xl text-[10px] font-black duo-btn-white text-slate-700 cursor-pointer min-h-[34px] shrink-0"
                              >
                                {isInactive ? 'Activate' : 'Pause'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {attentionLibraries.length > ALERTS_PER_PAGE && (
                  <div className="bg-white px-3 py-1.5 duo-card flex items-center justify-between shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setAlertPage((p) => Math.max(0, p - 1));
                      }}
                      disabled={safeAlertPage === 0}
                      className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playSound('pop');
                        setAlertPage((p) => Math.min(totalAlertPages - 1, p + 1));
                      }}
                      disabled={safeAlertPage >= totalAlertPages - 1}
                      className="px-3 py-1 rounded-xl text-xs font-black duo-btn-dark-green cursor-pointer flex items-center gap-1 min-h-[34px]"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 4: SETTINGS & LICENSE ALERTS */}
        {activeTab === 'settings' && (
          <div className="flex-1 min-h-0 flex flex-col justify-between gap-2.5">
            {/* Supabase Connection Card */}
            <div className="bg-white p-4 duo-card flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#58cc02]/15 text-[#46a302] flex items-center justify-center shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-black text-[#3c3c3c] truncate">
                    Supabase Database
                  </h2>
                  <p className="text-[11px] font-semibold text-slate-500 truncate">
                    {isDbConnected ? 'Connected & syncing live' : 'Not configured'}
                  </p>
                </div>
              </div>
              {onOpenSupabaseModal && (
                <button
                  type="button"
                  onClick={onOpenSupabaseModal}
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer shrink-0 min-h-[40px]"
                >
                  Configure
                </button>
              )}
            </div>

            {/* Alerts Summary Shortcut Panel */}
            <div className="flex-1 min-h-0 bg-white p-4 duo-card flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-600" />
                  <h3 className="font-display text-sm font-black text-[#3c3c3c]">
                    Network Alerts Summary
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => handleSwitchTab('alerts')}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-orange cursor-pointer"
                >
                  Open Alerts ({totalAlertsCount})
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setAlertView('broadcasts');
                    handleSwitchTab('alerts');
                  }}
                  className="p-3 rounded-2xl bg-emerald-50/70 border-2 border-emerald-200 text-left flex flex-col justify-between cursor-pointer hover:border-emerald-400"
                >
                  <span className="text-[10px] font-black uppercase text-emerald-800 truncate">Broadcasts</span>
                  <span className="font-display text-2xl font-black text-emerald-950 tabular-nums">
                    {pendingBroadcastsCount}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 truncate">
                    {pendingBroadcastsCount > 0 ? 'Ready to send' : 'All clear'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAlertView('exited');
                    handleSwitchTab('alerts');
                  }}
                  className="p-3 rounded-2xl bg-amber-50/70 border-2 border-amber-200 text-left flex flex-col justify-between cursor-pointer hover:border-amber-400"
                >
                  <span className="text-[10px] font-black uppercase text-amber-800 truncate">Students</span>
                  <span className="font-display text-2xl font-black text-amber-950 tabular-nums">
                    {studentLifecycleAlerts.length}
                  </span>
                  <span className="text-[10px] font-bold text-amber-700 truncate">
                    {studentLifecycleAlerts.length > 0 ? 'WA triggers ready' : 'All clear'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAlertView('licenses');
                    handleSwitchTab('alerts');
                  }}
                  className="p-3 rounded-2xl bg-slate-50 border-2 border-slate-200 text-left flex flex-col justify-between cursor-pointer hover:border-slate-400"
                >
                  <span className="text-[10px] font-black uppercase text-slate-600 truncate">Licenses</span>
                  <span className="font-display text-2xl font-black text-[#3c3c3c] tabular-nums">
                    {attentionLibraries.length}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 truncate">
                    Expiring/paused
                  </span>
                </button>
              </div>
            </div>

            {/* Session & Exit Strip */}
            <div className="bg-white p-3.5 duo-card flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Admin Session
                </span>
                <span className="text-xs font-mono font-bold text-slate-700 truncate block">
                  {adminCode}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    loadData();
                    playSound('pop');
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer flex items-center gap-1.5 min-h-[40px]"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Sync</span>
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-red cursor-pointer flex items-center gap-1.5 min-h-[40px]"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Exit</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* FIXED BOTTOM NAVIGATION TAB BAR */}
      <nav
        aria-label="Admin Navigation Tabs"
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
                    ? 'bg-[#ff9600]/12 text-[#e08500]'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.6]' : 'stroke-[2]'}`} />
                <span className="text-[10px] font-black tracking-tight whitespace-nowrap">
                  {tab.label}
                </span>
                {tab.badge !== undefined && tab.badge > 0 && !isActive && (
                  <span className="absolute top-1 right-1/5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center leading-none">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* MODAL 1: Add New Library */}
      {showAddLibraryModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-lg w-full p-6 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-100">
              <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                Register New Library
              </h3>
              <button
                type="button"
                disabled={creatingLibrary}
                onClick={() => {
                  setAddLibraryError(null);
                  setShowAddLibraryModal(false);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {addLibraryError && (
              <div className="mt-3 p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-xs font-bold text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{addLibraryError}</span>
              </div>
            )}

            <form onSubmit={handleCreateLibrary} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Library Name *
                </label>
                <input
                  type="text"
                  required
                  disabled={creatingLibrary}
                  placeholder="e.g. Vidya Study Hub"
                  value={libForm.name}
                  onChange={(e) => setLibForm({ ...libForm, name: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Location / Address *
                </label>
                <input
                  type="text"
                  required
                  disabled={creatingLibrary}
                  placeholder="e.g. Sector 14, Near Metro Station"
                  value={libForm.location}
                  onChange={(e) => setLibForm({ ...libForm, location: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Total Seats
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    disabled={creatingLibrary}
                    value={libForm.total_seats}
                    onChange={(e) => setLibForm({ ...libForm, total_seats: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    License Expiry
                  </label>
                  <input
                    type="date"
                    disabled={creatingLibrary}
                    value={libForm.subscription_expiry}
                    onChange={(e) => setLibForm({ ...libForm, subscription_expiry: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Owner Name
                  </label>
                  <input
                    type="text"
                    disabled={creatingLibrary}
                    placeholder="e.g. Rajesh Kumar"
                    value={libForm.owner_name}
                    onChange={(e) => setLibForm({ ...libForm, owner_name: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    WhatsApp Phone
                  </label>
                  <input
                    type="tel"
                    disabled={creatingLibrary}
                    placeholder="e.g. 919876543210"
                    value={libForm.contact_phone}
                    onChange={(e) => setLibForm({ ...libForm, contact_phone: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Owner Code (Auto-generated if blank)
                </label>
                <input
                  type="text"
                  disabled={creatingLibrary}
                  placeholder="e.g. OWNER-VIDYA"
                  value={libForm.owner_code}
                  onChange={(e) => setLibForm({ ...libForm, owner_code: e.target.value.toUpperCase() })}
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={creatingLibrary}
                  onClick={() => {
                    setAddLibraryError(null);
                    setShowAddLibraryModal(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingLibrary}
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase flex items-center gap-1.5 disabled:opacity-60"
                >
                  {creatingLibrary && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creatingLibrary ? 'Saving...' : 'Save & Issue Code'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Generate Custom Code */}
      {showAddCodeModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-6 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b-2 border-slate-100">
              <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                {codeForm.role === 'student' ? 'Generate Student Pin' : 'Generate Login Code'}
              </h3>
              <button
                type="button"
                disabled={creatingCode}
                onClick={() => {
                  setAddCodeError(null);
                  setShowAddCodeModal(false);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {addCodeError && (
              <div className="mt-3 p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-xs font-bold text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{addCodeError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCode} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  {codeForm.role === 'student' ? '4-Digit Student Pin (1000–9999) *' : 'Unique Code *'}
                </label>
                <input
                  type="text"
                  required
                  disabled={creatingCode}
                  inputMode={codeForm.role === 'student' ? 'numeric' : 'text'}
                  maxLength={codeForm.role === 'student' ? 4 : undefined}
                  placeholder={codeForm.role === 'student' ? 'e.g. 4821 (1000–9999)' : 'e.g. OWNER-VIDYA, ADMIN-02'}
                  value={codeForm.code}
                  onChange={(e) =>
                    setCodeForm({
                      ...codeForm,
                      code:
                        codeForm.role === 'student'
                          ? e.target.value.replace(/[^0-9]/g, '').slice(0, 4)
                          : e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Target Role *
                </label>
                <select
                  disabled={creatingCode}
                  value={codeForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value as 'owner' | 'admin' | 'student';
                    setCodeForm({
                      ...codeForm,
                      role: nextRole,
                      code:
                        nextRole === 'student'
                          ? codeForm.code.replace(/[^0-9]/g, '').slice(0, 4)
                          : codeForm.code,
                    });
                  }}
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                >
                  <option value="owner">Library Owner</option>
                  <option value="admin">Administrator</option>
                  <option value="student">Student</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Reference ID (Optional)
                </label>
                <input
                  type="text"
                  disabled={creatingCode}
                  placeholder="e.g. lib_vidya"
                  value={codeForm.reference_id}
                  onChange={(e) => setCodeForm({ ...codeForm, reference_id: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={creatingCode}
                  onClick={() => {
                    setAddCodeError(null);
                    setShowAddCodeModal(false);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingCode}
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase flex items-center gap-1.5 disabled:opacity-60"
                >
                  {creatingCode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creatingCode ? 'Saving...' : 'Save Code'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Confirm Delete Library */}
      {confirmDeleteLib && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-red-200 rounded-3xl max-w-sm w-full p-6 duo-card shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-black text-[#3c3c3c]">
              Remove Library?
            </h3>
            <p className="text-xs font-semibold text-slate-600">
              Are you sure you want to remove <strong>{confirmDeleteLib.name}</strong> and all of its students? This cannot be undone.
            </p>
            {deleteLibraryError && (
              <div className="p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-xs font-bold text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{deleteLibraryError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingLibrary}
                onClick={() => {
                  setDeleteLibraryError(null);
                  setConfirmDeleteLib(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingLibrary}
                onClick={handleConfirmDeleteLibrary}
                className="px-4 py-2 rounded-xl text-xs font-black duo-btn-red cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {deletingLibrary && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{deletingLibrary ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Confirm Delete Student Pin / Code */}
      {confirmDeleteCode && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-red-200 rounded-3xl max-w-sm w-full p-6 duo-card shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-black text-[#3c3c3c]">
              Delete PIN / Code?
            </h3>
            <p className="text-xs font-semibold text-slate-600">
              Delete credential <span className="font-mono font-bold">{confirmDeleteCode}</span>? Users holding this PIN or code will no longer be able to log in.
            </p>
            {deleteCodeError && (
              <div className="p-3 rounded-2xl bg-red-50 border-2 border-red-200 text-xs font-bold text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{deleteCodeError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={deletingCode}
                onClick={() => {
                  setDeleteCodeError(null);
                  setConfirmDeleteCode(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingCode}
                onClick={handleConfirmDeleteCode}
                className="px-4 py-2 rounded-xl text-xs font-black duo-btn-red cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {deletingCode && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{deletingCode ? 'Deleting...' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL 6: Broadcast Message Preview & Edit Popup */}
      {selectedBroadcastModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedBroadcastModal(null)}
        >
          <form
            onSubmit={handleSaveBroadcastEdit}
            className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-5 sm:p-6 duo-card shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b-2 border-slate-100">
              <div className="min-w-0">
                <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                  {selectedBroadcastModal.library_name}
                </h3>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 mt-0.5 tabular-nums">
                  <span className="font-black uppercase text-amber-600">
                    Pending
                  </span>
                  {selectedBroadcastModal.created_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatFriendlyDate(selectedBroadcastModal.created_at.split('T')[0])}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {new Date(selectedBroadcastModal.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBroadcastModal(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                aria-label="Close message preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="admin-broadcast-editor"
                className="block text-[10px] font-black uppercase tracking-wider text-slate-500"
              >
                Edit Notice Message Before Forwarding
              </label>
              <textarea
                id="admin-broadcast-editor"
                rows={5}
                value={editBroadcastText}
                onChange={(e) => {
                  setEditBroadcastText(e.target.value);
                  setBroadcastEditSaved(false);
                }}
                placeholder="Edit library broadcast notice..."
                className="w-full p-3.5 rounded-2xl bg-[#efeae2]/50 border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:bg-white focus:outline-hidden text-xs sm:text-sm font-semibold text-slate-800 leading-relaxed resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedBroadcastModal(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[40px]"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingBroadcastEdit || !editBroadcastText.trim()}
                  className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer min-h-[40px] flex items-center gap-1 disabled:opacity-50"
                >
                  {broadcastEditSaved ? (
                    <>
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Saved</span>
                    </>
                  ) : (
                    <span>{savingBroadcastEdit ? 'Saving...' : 'Save Update'}</span>
                  )}
                </button>

                <a
                  href={generateWhatsAppBroadcastUrl(
                    editBroadcastText.trim() || selectedBroadcastModal.message
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    const msgToSend = editBroadcastText.trim() || selectedBroadcastModal.message;
                    const reqToSend = selectedBroadcastModal;
                    setSelectedBroadcastModal(null);
                    void handleMarkBroadcastSent(reqToSend, msgToSend);
                  }}
                  className={`px-4 py-2 rounded-full text-xs font-black text-white flex items-center gap-1.5 cursor-pointer min-h-[40px] shadow-xs transition-transform active:scale-95 ${
                    selectedBroadcastModal.status === 'sent'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-black hover:bg-neutral-800'
                  }`}
                >
                  {selectedBroadcastModal.status === 'sent' ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                      <span>Send Again</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current shrink-0" aria-hidden="true">
                        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                      </svg>
                      <span>Send</span>
                    </>
                  )}
                </a>
              </div>
            </div>
          </form>
        </div>
      )}
      {/* MODAL 7: Student Lifecycle Alert Message Preview & Edit Popup */}
      {selectedStudentAlertModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedStudentAlertModal(null)}
        >
          <div
            className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-5 sm:p-6 duo-card shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b-2 border-slate-100">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                    {selectedStudentAlertModal.alert.student.name}
                  </h3>
                  <span
                    className={`px-1.5 py-0.5 rounded-md border text-[9px] font-black uppercase shrink-0 ${selectedStudentAlertModal.badgeClass}`}
                  >
                    {selectedStudentAlertModal.badgeText}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-500 truncate mt-0.5 tabular-nums">
                  {selectedStudentAlertModal.alert.libraryName} · Seat #
                  {selectedStudentAlertModal.alert.student.seat_number} ·{' '}
                  {(selectedStudentAlertModal.alert.student.shift || '').split('(')[0].trim()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudentAlertModal(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                aria-label="Close message preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="admin-student-alert-editor"
                  className="block text-[10px] font-black uppercase tracking-wider text-slate-500"
                >
                  Edit WhatsApp Message Before Sending
                </label>
                {editStudentAlertText !== selectedStudentAlertModal.defaultMessage && (
                  <button
                    type="button"
                    onClick={() => {
                      playSound('pop');
                      setEditStudentAlertText(selectedStudentAlertModal.defaultMessage);
                    }}
                    className="text-[10px] font-black text-[#1899d6] hover:underline cursor-pointer"
                  >
                    Reset template
                  </button>
                )}
              </div>
              <textarea
                id="admin-student-alert-editor"
                rows={6}
                value={editStudentAlertText}
                onChange={(e) => setEditStudentAlertText(e.target.value)}
                placeholder="Edit automated student WhatsApp message..."
                className="w-full p-3.5 rounded-2xl bg-[#efeae2]/50 border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:bg-white focus:outline-hidden text-xs sm:text-sm font-semibold text-slate-800 leading-relaxed resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectedStudentAlertModal(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[40px]"
              >
                Close
              </button>

              <a
                href={generateWhatsAppToPhoneUrl(
                  selectedStudentAlertModal.alert.student.phone,
                  editStudentAlertText.trim() || selectedStudentAlertModal.defaultMessage
                )}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  const alertToSend = selectedStudentAlertModal.alert;
                  setSelectedStudentAlertModal(null);
                  void handleMarkStudentAlertSent(alertToSend);
                }}
                className={`px-4 py-2 rounded-full text-xs font-black text-white flex items-center gap-1.5 cursor-pointer min-h-[40px] shadow-xs transition-transform active:scale-95 ${
                  isStudentAlertSent(selectedStudentAlertModal.alert)
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-black hover:bg-neutral-800'
                }`}
              >
                {isStudentAlertSent(selectedStudentAlertModal.alert) ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                    <span>Send Again</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current shrink-0" aria-hidden="true">
                      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                    </svg>
                    <span>Send WhatsApp</span>
                  </>
                )}
              </a>
            </div>
          </div>
        </div>
      )}
      {/* MODAL: Master QR Sheet Preview & PDF Download */}
      {qrSheetLibrary && (() => {
        const libStudents = allStudents.filter((s) => s.library_id === qrSheetLibrary.id);
        const allLabels = buildCanonicalSeatLabels(
          qrSheetLibrary.total_seats || 50,
          libStudents.map((s) => s.seat_number)
        );
        const total = allLabels.length;
        const perPage = 6;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        const safePage = Math.min(qrSheetPreviewPage, totalPages - 1);
        const start = safePage * perPage;
        const labels = allLabels.slice(start, start + perPage);
        const isBusy = downloadingMasterQrLibId === qrSheetLibrary.id;

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-lg w-full p-5 sm:p-6 duo-card shadow-2xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
              <div className="flex items-start justify-between gap-3 pb-3 border-b-2 border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-[#1cb0f6] text-white flex items-center justify-center border-b-3 border-[#1899d6] shrink-0">
                      <QrCode className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                        {qrSheetLibrary.name} · Master QR Sheet
                      </h3>
                      <p className="text-[11px] font-semibold text-slate-500 truncate tabular-nums">
                        {qrSheetLibrary.location} · {total} Desks (Level-H Center Badge QRs)
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQrSheetLibrary(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                  aria-label="Close QR sheet preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {labels.map((label) => {
                  const url = qrSheetPreviewUrls[`${qrSheetLibrary.id}:${label}`];
                  return (
                    <div
                      key={label}
                      className="p-2.5 rounded-2xl border-2 border-slate-200 bg-slate-50/70 flex flex-col items-center text-center gap-1"
                    >
                      <span className="font-display text-xs font-black text-[#3c3c3c]">
                        Seat {label} · #{formatSeatBadgeNumber(label)}
                      </span>
                      <div className="w-20 h-20 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-1">
                        {url ? (
                          <img src={url} alt={`${label} QR`} className="w-full h-full object-contain" />
                        ) : (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
                        )}
                      </div>
                      <span className="text-[9px] font-extrabold text-slate-600 truncate max-w-full">
                        {qrSheetLibrary.name}
                      </span>
                      <span className="text-[8px] font-bold text-[#1899d6]">
                        Scan to Check-In / Out
                      </span>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setQrSheetPreviewPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="px-3 py-1.5 rounded-xl font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev</span>
                  </button>
                  <span className="font-black text-slate-500 tabular-nums">
                    Preview {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQrSheetPreviewPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="px-3 py-1.5 rounded-xl font-black duo-btn-white disabled:opacity-40 cursor-pointer flex items-center gap-1"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2 border-t-2 border-slate-100">
                <button
                  type="button"
                  onClick={() => setQrSheetLibrary(null)}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[42px]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadLibraryMasterQrPdf(qrSheetLibrary)}
                  disabled={isBusy}
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-blue flex items-center gap-2 cursor-pointer min-h-[42px] disabled:opacity-60"
                >
                  {isBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {isBusy
                      ? `Generating ${total} QRs...`
                      : `Download Master QR PDF (${total} Seats)`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: Enrolled Student Detail & Management Actions */}
      {selectedLibrary && selectedLibStudentDetail && (() => {
        const st = selectedLibStudentDetail;
        const exited = isStudentExited(st);
        const daysLeft = calculateDaysRemaining(st.subscription_end);
        const isExpired = !exited && daysLeft < 0;
        const isExpiringUrgent = !exited && daysLeft >= 0 && daysLeft <= 2;
        const needsRenewalAlert = !exited && (isExpired || isExpiringUrgent);
        const isNew = isNewlyAddedStudent(st);
        const studentCode = getStudentAccessCode(st.id);

        const waWelcomeUrl = generateWhatsAppWelcomeUrl(
          st.phone,
          st.name,
          selectedLibrary.name,
          st.seat_number,
          st.shift,
          studentCode,
          portalUrl
        );

        const waReminderUrl = generateWhatsAppReminderUrl(
          st.phone,
          st.name,
          selectedLibrary.name,
          st.seat_number,
          st.subscription_end,
          daysLeft,
          studentCode !== 'Not Issued' ? studentCode : undefined
        );

        const waThankYouUrl = generateWhatsAppThankYouUrl(
          st.phone,
          st.name,
          selectedLibrary.name
        );

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-5 sm:p-6 duo-card shadow-2xl animate-in fade-in zoom-in-95 duration-150 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b-2 border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-base sm:text-lg font-black text-[#3c3c3c] truncate">
                      {st.name}
                    </h3>
                    <span
                      className={`font-mono text-[11px] font-black px-2 py-0.5 rounded-lg ${
                        exited
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-sky-50 text-[#1899d6] border border-sky-200'
                      }`}
                    >
                      Seat #{st.seat_number}{exited ? ' (Freed)' : ''}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-slate-500 truncate mt-0.5">
                    {selectedLibrary.name} · {st.shift}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLibStudentDetail(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                  aria-label="Close student details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status & Details Grid */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    Student Pin
                  </span>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="font-mono text-sm font-black text-[#3c3c3c] truncate">
                      {studentCode}
                    </span>
                    {studentCode !== 'Not Issued' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            void navigator.clipboard.writeText(studentCode);
                            playSound('pop');
                            setCopiedStudentCode(true);
                            setTimeout(() => setCopiedStudentCode(false), 1500);
                          }
                        }}
                        className="text-[10px] font-black text-[#1899d6] hover:underline cursor-pointer shrink-0"
                      >
                        {copiedStudentCode ? 'Copied' : 'Copy'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                    Phone Number
                  </span>
                  <a
                    href={`tel:${st.phone}`}
                    className="inline-flex items-center gap-1 mt-1 font-mono text-xs sm:text-sm font-black text-[#1899d6] hover:underline truncate"
                  >
                    <Phone className="w-3 h-3 shrink-0" />
                    <span className="truncate">{st.phone}</span>
                  </a>
                </div>

                <div
                  className={`col-span-2 p-3 rounded-2xl border flex items-center justify-between gap-2 ${
                    exited
                      ? 'bg-slate-50 border-slate-200'
                      : isExpired
                      ? 'bg-red-50/70 border-red-200'
                      : isExpiringUrgent
                      ? 'bg-amber-50/70 border-amber-200'
                      : 'bg-emerald-50/50 border-emerald-200'
                  }`}
                >
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      Subscription Validity
                    </span>
                    <span className="text-xs sm:text-sm font-black text-[#3c3c3c] tabular-nums mt-0.5 block">
                      {exited
                        ? `Exited ${formatFriendlyDate(getStudentExitDate(st) || st.subscription_end)}`
                        : `Valid till ${formatFriendlyDate(st.subscription_end)}`}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    {exited ? (
                      <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black uppercase">
                        Exited
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-100 text-red-700 border border-red-200 text-[10px] font-black uppercase tabular-nums">
                        <AlertTriangle className="w-3 h-3" />
                        Expired {Math.abs(daysLeft)}d
                      </span>
                    ) : isExpiringUrgent ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-black uppercase tabular-nums">
                        <AlertTriangle className="w-3 h-3" />
                        {daysLeft === 0 ? 'Due Today' : `${daysLeft}d left`}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-[#46a302] border border-emerald-200 text-[10px] font-black uppercase tabular-nums">
                        {isNew ? 'New · ' : 'Active · '}
                        {daysLeft}d left
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Management Actions */}
              <div className="space-y-2 pt-1">
                {exited ? (
                  <a
                    href={waThankYouUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      void dataService
                        .markStudentAlertTag(st, 'EXIT_SENT')
                        .then((updated) => {
                          setAllStudents((prev) =>
                            prev.map((item) => (item.id === st.id ? updated : item))
                          );
                        })
                        .catch(() => null);
                      setSelectedLibStudentDetail(null);
                    }}
                    className="w-full py-2.5 px-4 rounded-2xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px]"
                  >
                    <HeartHandshake className="w-4 h-4" />
                    <span>Send Thank You WA</span>
                  </a>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <a
                      href={waWelcomeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`py-2.5 px-3 rounded-2xl text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px] ${
                        !needsRenewalAlert ? 'duo-btn-green' : 'duo-btn-white text-[#46a302]'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Login WA</span>
                    </a>

                    <a
                      href={waReminderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`py-2.5 px-3 rounded-2xl text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer min-h-[42px] ${
                        isExpired
                          ? 'duo-btn-red'
                          : isExpiringUrgent
                          ? 'duo-btn-orange'
                          : 'duo-btn-white text-slate-700'
                      }`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>{needsRenewalAlert ? 'Renew Alert WA' : 'Remind WA'}</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-2 border-t-2 border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedLibStudentDetail(null)}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer min-h-[40px]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
