/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AttendanceRecord,
  BroadcastRequest,
  Library,
  LoginRecord,
  SeatQrReference,
  Shift,
  Student,
  UserRole,
} from '../types/database';
import { buildCanonicalSeatLabels } from './masterQrPdfBuilder';
import {
  encodeSeatQrPayload,
  formatSeatBadgeNumber,
  getQrScanBaseOrigin,
  normalizeSeatLabel,
} from './seatQrGenerator';

// Storage keys for dynamic Supabase settings
const STORAGE_KEY_URL = 'studylingo_supabase_url';
const STORAGE_KEY_ANON = 'studylingo_supabase_anon_key';
const STORAGE_KEY_LOCAL_DB = 'studylingo_local_db_v1';
export const BROADCAST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isWithinBroadcastRetention(createdAt: string): boolean {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts >= Date.now() - BROADCAST_RETENTION_MS;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

declare const __STUDYLINGO_BUILD_SUPABASE_URL__: string | undefined;
declare const __STUDYLINGO_BUILD_SUPABASE_ANON_KEY__: string | undefined;

interface RuntimePublicEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

function sanitizeEnvUrl(raw?: string | null): string {
  const val = (raw || '').trim();
  if (!val || val.includes('your-project') || !val.startsWith('http')) return '';
  return val;
}

function sanitizeEnvKey(raw?: string | null): string {
  const val = (raw || '').trim();
  if (!val || val === 'your-anon-public-key') return '';
  return val;
}

function readProcessEnv(key: string): string {
  try {
    if (typeof process !== 'undefined' && process && process.env) {
      return String(process.env[key] || '').trim();
    }
  } catch {
    // Ignore when process is unavailable in browser
  }
  return '';
}

function getEnvSupabaseConfig(): SupabaseConfig {
  const runtimeEnv: RuntimePublicEnv =
    (typeof window !== 'undefined' && (window as any).__STUDYLINGO_ENV__) || {};

  const buildUrl =
    typeof __STUDYLINGO_BUILD_SUPABASE_URL__ !== 'undefined'
      ? __STUDYLINGO_BUILD_SUPABASE_URL__
      : '';
  const buildKey =
    typeof __STUDYLINGO_BUILD_SUPABASE_ANON_KEY__ !== 'undefined'
      ? __STUDYLINGO_BUILD_SUPABASE_ANON_KEY__
      : '';

  const viteEnv: Record<string, string | undefined> =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : {};

  const url =
    sanitizeEnvUrl(runtimeEnv.VITE_SUPABASE_URL) ||
    sanitizeEnvUrl(runtimeEnv.NEXT_PUBLIC_SUPABASE_URL) ||
    sanitizeEnvUrl(buildUrl) ||
    sanitizeEnvUrl(import.meta.env.VITE_SUPABASE_URL) ||
    sanitizeEnvUrl(viteEnv.NEXT_PUBLIC_SUPABASE_URL) ||
    sanitizeEnvUrl(viteEnv.VITE_PUBLIC_SUPABASE_URL) ||
    sanitizeEnvUrl(viteEnv.SUPABASE_URL) ||
    sanitizeEnvUrl(readProcessEnv('VITE_SUPABASE_URL')) ||
    sanitizeEnvUrl(readProcessEnv('NEXT_PUBLIC_SUPABASE_URL')) ||
    sanitizeEnvUrl(readProcessEnv('SUPABASE_URL'));

  const anonKey =
    sanitizeEnvKey(runtimeEnv.VITE_SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(runtimeEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(buildKey) ||
    sanitizeEnvKey(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(viteEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(viteEnv.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY) ||
    sanitizeEnvKey(viteEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) ||
    sanitizeEnvKey(viteEnv.VITE_PUBLIC_SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(viteEnv.SUPABASE_ANON_KEY) ||
    sanitizeEnvKey(readProcessEnv('VITE_SUPABASE_ANON_KEY')) ||
    sanitizeEnvKey(readProcessEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')) ||
    sanitizeEnvKey(readProcessEnv('VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY')) ||
    sanitizeEnvKey(readProcessEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY')) ||
    sanitizeEnvKey(readProcessEnv('SUPABASE_ANON_KEY'));

  return { url, anonKey };
}

function readLocalStorageSafe(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function getSupabaseConfigSource(): 'env' | 'local' | 'none' {
  const envCfg = getEnvSupabaseConfig();
  if (envCfg.url && envCfg.anonKey) return 'env';
  const localUrl = sanitizeEnvUrl(readLocalStorageSafe(STORAGE_KEY_URL));
  const localKey = sanitizeEnvKey(readLocalStorageSafe(STORAGE_KEY_ANON));
  if (localUrl && localKey) return 'local';
  return 'none';
}

export function getStoredSupabaseConfig(): SupabaseConfig {
  const envCfg = getEnvSupabaseConfig();
  const localUrl = sanitizeEnvUrl(readLocalStorageSafe(STORAGE_KEY_URL));
  const localKey = sanitizeEnvKey(readLocalStorageSafe(STORAGE_KEY_ANON));

  return {
    url: envCfg.url || localUrl,
    anonKey: envCfg.anonKey || localKey,
  };
}

export function getSupabaseDiagnostics(): {
  configured: boolean;
  source: 'env' | 'local' | 'none';
  urlPresent: boolean;
  keyPresent: boolean;
  urlHost: string | null;
} {
  const { url, anonKey } = getStoredSupabaseConfig();
  let urlHost: string | null = null;
  if (url) {
    try {
      urlHost = new URL(url).host;
    } catch {
      urlHost = 'invalid-url';
    }
  }
  return {
    configured: Boolean(url && anonKey && url.startsWith('http')),
    source: getSupabaseConfigSource(),
    urlPresent: Boolean(url),
    keyPresent: Boolean(anonKey),
    urlHost,
  };
}

let pendingHydrationPromise: Promise<boolean> | null = null;

export async function hydrateSupabaseConfigFromServer(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  if (isSupabaseConfigured()) return true;
  if (pendingHydrationPromise) return pendingHydrationPromise;

  pendingHydrationPromise = (async () => {
    try {
      const res = await fetch('/api/config/public', { cache: 'no-store' });
      if (!res.ok) {
        console.warn(`[Supabase] /api/config/public returned HTTP ${res.status}`);
        return false;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn('[Supabase] /api/config/public did not return JSON');
        return false;
      }
      const data = (await res.json()) as { supabaseUrl?: string; supabaseAnonKey?: string };
      const url = sanitizeEnvUrl(data?.supabaseUrl);
      const anonKey = sanitizeEnvKey(data?.supabaseAnonKey);
      if (!url || !anonKey) {
        console.warn('[Supabase] /api/config/public returned empty Supabase credentials');
        return false;
      }
      (window as any).__STUDYLINGO_ENV__ = {
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_ANON_KEY: anonKey,
      };
      cachedClient = null;
      return true;
    } catch (err) {
      console.warn('[Supabase] Failed to hydrate public config from server:', err);
      return false;
    } finally {
      pendingHydrationPromise = null;
    }
  })();

  return pendingHydrationPromise;
}

export function saveStoredSupabaseConfig(config: SupabaseConfig): void {
  if (typeof window !== 'undefined') {
    try {
      if (config.url) {
        localStorage.setItem(STORAGE_KEY_URL, config.url.trim());
      } else {
        localStorage.removeItem(STORAGE_KEY_URL);
      }

      if (config.anonKey) {
        localStorage.setItem(STORAGE_KEY_ANON, config.anonKey.trim());
      } else {
        localStorage.removeItem(STORAGE_KEY_ANON);
      }
    } catch {
      // Ignore storage write restrictions in strict privacy browsers
    }
  }
  cachedClient = null; // reset client
  attendanceLogsTableMissing = false;
  seatQrCodesTableMissing = false;
}

let cachedClient: SupabaseClient | null = null;
let attendanceLogsTableMissing = false;
let seatQrCodesTableMissing = false;

function isMissingRelationError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getStoredSupabaseConfig();
  return Boolean(url && anonKey && url.startsWith('http'));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!cachedClient) {
    const { url, anonKey } = getStoredSupabaseConfig();
    try {
      cachedClient = createClient(url, anonKey);
    } catch (e) {
      console.error('[Supabase] Error creating Supabase client:', e);
      return null;
    }
  }
  return cachedClient;
}

export async function testSupabaseConnection(): Promise<{ success: boolean; message: string; tableStatus?: Record<string, boolean> }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      message: 'Supabase URL or Anon Public Key is missing or invalid.',
    };
  }

  attendanceLogsTableMissing = false;

  const tableStatus: Record<string, boolean> = {
    all_logins: false,
    libraries: false,
    students: false,
    shifts: false,
    attendance_logs: false,
  };

  try {
    const loginsRes = await client.from('all_logins').select('count', { count: 'exact', head: true });
    tableStatus.all_logins = !loginsRes.error;

    const libRes = await client.from('libraries').select('count', { count: 'exact', head: true });
    tableStatus.libraries = !libRes.error;

    const stuRes = await client.from('students').select('count', { count: 'exact', head: true });
    tableStatus.students = !stuRes.error;

    const shiftsRes = await client.from('shifts').select('count', { count: 'exact', head: true });
    let shiftsRlsBlocked = false;
    let shiftsRlsDetail = '';
    if (!shiftsRes.error) {
      // Probe shifts INSERT RLS policy without leaving a row (FK error 23503 proves RLS WITH CHECK passed)
      const probeRes = await client.from('shifts').insert({
        id: '__rls_probe__',
        library_id: '__nonexistent_rls_probe_lib__',
        name: 'probe',
        timing: 'probe',
        fee: 0,
        is_active: true,
      });
      if (!probeRes.error) {
        await client.from('shifts').delete().eq('id', '__rls_probe__');
      } else {
        const msg = (probeRes.error.message || '').toLowerCase();
        const code = (probeRes.error.code || '').toUpperCase();
        if (code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
          shiftsRlsBlocked = true;
          shiftsRlsDetail = probeRes.error.message;
        }
      }
    }
    tableStatus.shifts = !shiftsRes.error && !shiftsRlsBlocked;

    const attRes = await client.from('attendance_logs').select('count', { count: 'exact', head: true });
    tableStatus.attendance_logs = !attRes.error;
    attendanceLogsTableMissing = Boolean(attRes.error && isMissingRelationError(attRes.error));

    const allExist =
      tableStatus.all_logins &&
      tableStatus.libraries &&
      tableStatus.students &&
      tableStatus.shifts &&
      tableStatus.attendance_logs;
    if (allExist) {
      return {
        success: true,
        message: 'Successfully connected! All required tables (all_logins, libraries, students, shifts, attendance_logs) are detected and writable.',
        tableStatus,
      };
    } else if (shiftsRlsBlocked) {
      return {
        success: false,
        message: `Connected to Supabase, but Row Level Security (RLS) is blocking writes on the 'shifts' table (${shiftsRlsDetail}). Copy & run the updated SQL Setup Script to unlock shifts access.`,
        tableStatus,
      };
    } else {
      const missing = Object.entries(tableStatus)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
        .join(', ');
      return {
        success: false,
        message: `Connected to Supabase project, but the following tables were not found or lack permissions: ${missing}. Please run the updated SQL setup script in your Supabase SQL Editor.`,
        tableStatus,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Connection failed: ${err.message || 'Network error or invalid credentials'}`,
      tableStatus,
    };
  }
}

export const SQL_SETUP_SCRIPT = `-- ==========================================
-- StudyLingo Supabase Database Schema
-- Run this in your Supabase Project -> SQL Editor
-- ==========================================

-- 1. Create table for unified login codes
CREATE TABLE IF NOT EXISTS public.all_logins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'student')),
  reference_id TEXT,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create table for registered study libraries
CREATE TABLE IF NOT EXISTS public.libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  total_seats INTEGER NOT NULL DEFAULT 50,
  owner_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  subscription_status TEXT DEFAULT 'active' NOT NULL,
  subscription_expiry DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create table for students
CREATE TABLE IF NOT EXISTS public.students (
  id TEXT PRIMARY KEY,
  library_id TEXT REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  shift TEXT NOT NULL,
  subscription_start DATE NOT NULL,
  subscription_end DATE NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  student_pin TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS student_pin TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique_pin
  ON public.students (student_pin)
  WHERE student_pin IS NOT NULL;

-- 4. Create table for custom library shifts and pricing
CREATE TABLE IF NOT EXISTS public.shifts (
  id TEXT PRIMARY KEY,
  library_id TEXT REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  timing TEXT NOT NULL,
  fee NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Grant explicit schema & table access to anon & authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.all_logins TO anon, authenticated;
GRANT ALL ON TABLE public.libraries TO anon, authenticated;
GRANT ALL ON TABLE public.students TO anon, authenticated;
GRANT ALL ON TABLE public.shifts TO anon, authenticated;

-- Enable Row Level Security (RLS) with idempotent permissive public policies
-- for this unified code-based application:
ALTER TABLE public.all_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Allow anon read/write access (idempotent re-creation)
DROP POLICY IF EXISTS "Allow public all access on all_logins" ON public.all_logins;
CREATE POLICY "Allow public all access on all_logins" 
  ON public.all_logins FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on libraries" ON public.libraries;
CREATE POLICY "Allow public all access on libraries" 
  ON public.libraries FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on students" ON public.students;
CREATE POLICY "Allow public all access on students" 
  ON public.students FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on shifts" ON public.shifts;
CREATE POLICY "Allow public all access on shifts" 
  ON public.shifts FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Helpful initial index
CREATE INDEX IF NOT EXISTS idx_shifts_library ON public.shifts(library_id);

-- 5. Create table for owner-to-admin WhatsApp broadcast requests
CREATE TABLE IF NOT EXISTS public.broadcast_requests (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  library_name TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

GRANT ALL ON TABLE public.broadcast_requests TO anon, authenticated;
ALTER TABLE public.broadcast_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all access on broadcast_requests" ON public.broadcast_requests;
CREATE POLICY "Allow public all access on broadcast_requests"
  ON public.broadcast_requests FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Create table for QR desk check-in / check-out attendance logs
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  shift TEXT NOT NULL,
  date DATE NOT NULL,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  status TEXT DEFAULT 'checked_in' NOT NULL,
  qr_payload TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

GRANT ALL ON TABLE public.attendance_logs TO anon, authenticated;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all access on attendance_logs" ON public.attendance_logs;
CREATE POLICY "Allow public all access on attendance_logs"
  ON public.attendance_logs FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_attendance_library_date ON public.attendance_logs(library_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance_logs(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_student_date_shift
  ON public.attendance_logs (student_id, date, lower(trim(shift)))
  WHERE status <> 'absent';

-- 7. Create table for custom Level-H Center-Badge seat QR references
CREATE TABLE IF NOT EXISTS public.seat_qr_codes (
  id TEXT PRIMARY KEY,
  library_id TEXT REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  seat_label TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  qr_payload TEXT NOT NULL,
  error_correction TEXT DEFAULT 'H' NOT NULL,
  qr_image_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (library_id, seat_label)
);

GRANT ALL ON TABLE public.seat_qr_codes TO anon, authenticated;
ALTER TABLE public.seat_qr_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all access on seat_qr_codes" ON public.seat_qr_codes;
CREATE POLICY "Allow public all access on seat_qr_codes"
  ON public.seat_qr_codes FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_seat_qr_library ON public.seat_qr_codes(library_id);

-- Ensure Realtime broadcasts changes for shifts, students, libraries, and attendance
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.libraries;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcast_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- Initial master admin access code
INSERT INTO public.all_logins (code, role, is_active) 
VALUES ('ADMIN-MASTER', 'admin', true)
ON CONFLICT (code) DO NOTHING;

-- Refresh PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
`;

export const DUPLICATE_ATTENDANCE_MESSAGE =
  'Attendance for this shift has already been recorded or completed today.';

export const STRICT_STUDENT_PIN_REGEX = /^[1-9]\d{3}$/;

export function isValidStudentPin(pin: string | null | undefined): boolean {
  const clean = String(pin || '').trim();
  if (!STRICT_STUDENT_PIN_REGEX.test(clean)) return false;
  const num = Number(clean);
  return num >= 1000 && num <= 9999;
}

export function pickAvailableFourDigitPin(existingCodes: Iterable<string> = []): string {
  const used = new Set<string>();
  for (const code of existingCodes) {
    used.add(String(code || '').trim().toUpperCase());
  }
  for (let attempt = 0; attempt < 2500; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!used.has(candidate)) return candidate;
  }
  for (let n = 1000; n <= 9999; n++) {
    const candidate = String(n);
    if (!used.has(candidate)) return candidate;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Local Storage Fallback state management (used when no Supabase credentials provided)
interface LocalDatabase {
  logins: LoginRecord[];
  libraries: Library[];
  students: Student[];
  shifts: Shift[];
  broadcasts?: BroadcastRequest[];
  unsyncedBroadcastIds?: string[];
  deletedBroadcastIds?: string[];
  attendance?: AttendanceRecord[];
  unsyncedAttendanceIds?: string[];
  attendanceActivationDates?: Record<string, string>;
  shiftsInitialSeeded?: boolean;
}

function getLocalDateIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function migrateLegacyStudentLoginsInLocalDb(db: LocalDatabase): {
  changed: boolean;
  migratedOldCodes: string[];
} {
  let changed = false;
  const migratedOldCodes: string[] = [];
  const used = new Set<string>();

  for (const l of db.logins || []) {
    if (l.role !== 'student' || isValidStudentPin(l.code)) {
      if (l.code) used.add(String(l.code).trim().toUpperCase());
    }
  }

  for (const l of db.logins || []) {
    if (l.role === 'student') {
      const clean = String(l.code || '').trim();
      if (!isValidStudentPin(clean)) {
        if (clean) migratedOldCodes.push(clean);
        const newPin = pickAvailableFourDigitPin(used);
        used.add(newPin);
        l.code = newPin;
        l.student_pin = newPin;
        changed = true;
      } else {
        if (l.code !== clean) {
          l.code = clean;
          changed = true;
        }
        if (l.student_pin !== clean) {
          l.student_pin = clean;
          changed = true;
        }
      }
    }
  }

  const pinByStudentId = new Map<string, string>();
  for (const l of db.logins || []) {
    if (l.role === 'student' && l.reference_id && isValidStudentPin(l.code)) {
      pinByStudentId.set(l.reference_id, l.code);
    }
  }

  for (const st of db.students || []) {
    const linked = pinByStudentId.get(st.id);
    if (linked && st.student_pin !== linked) {
      st.student_pin = linked;
      changed = true;
    }
  }

  return { changed, migratedOldCodes };
}

function getLocalDatabase(): LocalDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_DB);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.logins || parsed.logins.length === 0) {
        parsed.logins = [{ code: 'ADMIN-MASTER', role: 'admin', reference_id: null, is_active: true }];
      }
      if (!parsed.shifts) {
        parsed.shifts = [];
      }
      if (!parsed.broadcasts) {
        parsed.broadcasts = [];
      }
      if (!parsed.unsyncedBroadcastIds) {
        parsed.unsyncedBroadcastIds = [];
      }
      if (!parsed.deletedBroadcastIds) {
        parsed.deletedBroadcastIds = [];
      }
      if (!parsed.attendance) {
        parsed.attendance = [];
      }
      if (!parsed.unsyncedAttendanceIds) {
        parsed.unsyncedAttendanceIds = [];
      }
      if (!parsed.attendanceActivationDates) {
        parsed.attendanceActivationDates = {};
      }
      const { changed } = migrateLegacyStudentLoginsInLocalDb(parsed);
      if (changed) {
        saveLocalDatabase(parsed);
      }
      return parsed;
    }
  } catch (e) {
    console.error('Failed to parse local database', e);
  }
  return {
    logins: [{ code: 'ADMIN-MASTER', role: 'admin', reference_id: null, is_active: true }],
    libraries: [],
    students: [],
    shifts: [],
    broadcasts: [],
    unsyncedBroadcastIds: [],
    deletedBroadcastIds: [],
    attendance: [],
    unsyncedAttendanceIds: [],
    attendanceActivationDates: {},
  };
}

function saveLocalDatabase(db: LocalDatabase): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEY_LOCAL_DB, JSON.stringify(db));
    }
  } catch {
    // Ignore localStorage quota/privacy errors
  }
}

async function apiGetJson<T>(url: string): Promise<T | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function apiPostJson<T>(url: string, body: unknown): Promise<T | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function mergeAttendanceRecordLists(
  primary: AttendanceRecord[],
  secondary: AttendanceRecord[]
): AttendanceRecord[] {
  const merged = new Map<string, AttendanceRecord>();
  const pickNewer = (a: AttendanceRecord, b: AttendanceRecord): AttendanceRecord => {
    if (a.status === 'checked_out' && b.status !== 'checked_out') return a;
    if (b.status === 'checked_out' && a.status !== 'checked_out') return b;
    if (a.check_out_time && !b.check_out_time) return a;
    if (b.check_out_time && !a.check_out_time) return b;
    const ta = new Date(a.check_out_time || a.check_in_time || a.created_at || a.date).getTime();
    const tb = new Date(b.check_out_time || b.check_in_time || b.created_at || b.date).getTime();
    return tb > ta ? b : a;
  };

  for (const item of [...secondary, ...primary]) {
    if (!item?.id) continue;
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? pickNewer(existing, item) : item);
  }

  return Array.from(merged.values()).sort((a, b) => {
    const ta = new Date(a.check_in_time || a.created_at || a.date).getTime();
    const tb = new Date(b.check_in_time || b.created_at || b.date).getTime();
    return tb - ta;
  });
}

let didInitialServerSync = false;

async function fetchAndMergeLocalBootstrap(): Promise<LocalDatabase> {
  const db = getLocalDatabase();
  const remote = await apiGetJson<{
    libraries?: Library[];
    students?: Student[];
    logins?: LoginRecord[];
    shifts?: Shift[];
    attendance?: AttendanceRecord[];
    attendanceActivationDates?: Record<string, string>;
  }>('/api/store/bootstrap');

  if (!remote) return db;

  const mergeByKey = <T extends Record<string, any>>(localArr: T[], remoteArr: T[] | undefined, key: string): T[] => {
    const map = new Map<string, T>();
    for (const item of localArr || []) {
      if (item?.[key] !== undefined) map.set(String(item[key]), item);
    }
    for (const item of remoteArr || []) {
      if (item?.[key] !== undefined) {
        const k = String(item[key]);
        map.set(k, { ...(map.get(k) || {}), ...item });
      }
    }
    return Array.from(map.values());
  };

  // Push any pre-existing browser-only local records up to central server once
  if (!didInitialServerSync && ((db.libraries?.length || 0) > 0 || (db.students?.length || 0) > 0)) {
    didInitialServerSync = true;
    void apiPostJson('/api/store/sync', {
      libraries: db.libraries,
      students: db.students,
      logins: db.logins,
      shifts: db.shifts,
      attendanceActivationDates: db.attendanceActivationDates,
    });
  } else {
    didInitialServerSync = true;
  }

  db.libraries = mergeByKey(db.libraries || [], remote.libraries, 'id');
  db.students = mergeByKey(db.students || [], remote.students, 'id');
  db.logins = mergeByKey(db.logins || [], remote.logins, 'code');
  db.shifts = mergeByKey(db.shifts || [], remote.shifts, 'id');
  if (Array.isArray(remote.attendance)) {
    db.attendance = mergeAttendanceRecordLists(remote.attendance, db.attendance || []);
  }
  if (remote.attendanceActivationDates) {
    db.attendanceActivationDates = {
      ...(db.attendanceActivationDates || {}),
      ...remote.attendanceActivationDates,
    };
  }
  const { changed, migratedOldCodes } = migrateLegacyStudentLoginsInLocalDb(db);
  saveLocalDatabase(db);
  if (changed) {
    for (const oldCode of migratedOldCodes) {
      void apiPostJson('/api/store/sync', { deleteLoginCode: oldCode });
    }
    void apiPostJson('/api/store/sync', {
      students: db.students,
      logins: db.logins,
    });
  }
  return db;
}

// Service Layer
export const dataService = {
  // Check login code (students MUST use strict 1000-9999 numeric PINs; Admin/Owner keep their codes)
  async verifyAccessCode(inputCode: string): Promise<LoginRecord | null> {
    const cleanCode = inputCode.trim();
    if (!cleanCode) return null;

    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('all_logins')
        .select('*')
        .ilike('code', cleanCode)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error verifying code via Supabase:', error);
        throw new Error(error.message);
      }
      const record = data as LoginRecord | null;
      if (!record) return null;
      if (record.role === 'student' && (!isValidStudentPin(cleanCode) || !isValidStudentPin(record.code))) {
        return null;
      }
      return record;
    }

    // Central server fallback + local storage cache
    const remoteRes = await apiGetJson<{ login: LoginRecord | null }>(
      `/api/store/verify-code/${encodeURIComponent(cleanCode.toUpperCase())}`
    );
    if (remoteRes?.login) {
      const remoteLogin = remoteRes.login;
      if (
        remoteLogin.role === 'student' &&
        (!isValidStudentPin(cleanCode) || !isValidStudentPin(remoteLogin.code))
      ) {
        return null;
      }
      return remoteLogin;
    }

    const db = getLocalDatabase();
    const found = db.logins.find((l) => {
      if (!l.is_active) return false;
      if (l.role === 'student') {
        return isValidStudentPin(cleanCode) && isValidStudentPin(l.code) && l.code.trim() === cleanCode;
      }
      return l.code.toUpperCase() === cleanCode.toUpperCase();
    });
    return found || null;
  },

  // Strict 4-digit Student PIN validation (range 1000-9999 only, zero alphanumeric fallback)
  async verifyStudentPin(inputPin: string): Promise<LoginRecord | null> {
    const cleanPin = inputPin.trim();
    if (!isValidStudentPin(cleanPin)) {
      return null;
    }
    const record = await this.verifyAccessCode(cleanPin);
    if (!record || record.role !== 'student' || !isValidStudentPin(record.code)) {
      return null;
    }
    return record;
  },

  // Libraries
  async getAllLibraries(): Promise<Library[]> {
    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('libraries')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('[Supabase] Error fetching libraries:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw new Error(error.message);
      }
      return (data || []) as Library[];
    }

    console.warn('[Supabase] getAllLibraries called without active Supabase client; falling back to local bootstrap.');
    const db = await fetchAndMergeLocalBootstrap();
    return db.libraries;
  },

  async getLibraryById(id: string): Promise<Library | null> {
    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('libraries')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching library by id:', error);
        throw new Error(error.message);
      }
      return data as Library | null;
    }

    const remoteRes = await apiGetJson<{ library: Library | null }>(
      `/api/store/library/${encodeURIComponent(id)}`
    );
    if (remoteRes?.library) {
      return remoteRes.library;
    }

    const db = getLocalDatabase();
    return db.libraries.find((l) => l.id === id) || null;
  },

  async createLibrary(library: Library, ownerCode?: string): Promise<void> {
    const todayStr = getLocalDateIso();
    const dbInit = getLocalDatabase();
    dbInit.attendanceActivationDates = {
      ...(dbInit.attendanceActivationDates || {}),
      [library.id]: todayStr,
    };

    const client = getSupabaseClient();
    if (client) {
      saveLocalDatabase(dbInit);
      void apiPostJson('/api/store/sync', {
        attendanceActivationDates: { [library.id]: todayStr },
      });
      const { error: libError } = await client.from('libraries').insert(library);
      if (libError) throw new Error(libError.message);

      if (ownerCode) {
        const cleanOwnerCode = ownerCode.trim().toUpperCase();
        const { error: codeError } = await client.from('all_logins').insert({
          code: cleanOwnerCode,
          role: 'owner',
          reference_id: library.id,
          is_active: true,
        });
        if (codeError) {
          await client.from('libraries').delete().eq('id', library.id);
          if (codeError.code === '23505') {
            throw new Error(`Owner code "${cleanOwnerCode}" is already in use. Please choose another code.`);
          }
          throw new Error(codeError.message);
        }
      }
      return;
    }

    dbInit.libraries.push(library);
    const loginEntry = ownerCode
      ? {
          code: ownerCode.trim().toUpperCase(),
          role: 'owner' as const,
          reference_id: library.id,
          is_active: true,
        }
      : null;
    if (loginEntry) {
      dbInit.logins.push(loginEntry);
    }
    saveLocalDatabase(dbInit);
    await apiPostJson('/api/store/sync', {
      libraries: [library],
      logins: loginEntry ? [loginEntry] : undefined,
      attendanceActivationDates: { [library.id]: todayStr },
    });
  },

  async updateLibrary(library: Partial<Library> & { id: string }): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('libraries')
        .update(library)
        .eq('id', library.id);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    const idx = db.libraries.findIndex((l) => l.id === library.id);
    if (idx !== -1) {
      db.libraries[idx] = { ...db.libraries[idx], ...library };
      saveLocalDatabase(db);
    }
    await apiPostJson('/api/store/sync', { libraries: [library] });
  },

  async deleteLibrary(id: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      // Collect student IDs so their PIN records in all_logins are also cleaned up cleanly
      const { data: libStudents } = await client
        .from('students')
        .select('id')
        .eq('library_id', id);
      const studentIds = Array.isArray(libStudents)
        ? libStudents.map((s: any) => s.id).filter(Boolean)
        : [];

      if (studentIds.length > 0) {
        await client.from('all_logins').delete().in('reference_id', studentIds);
      }
      await client.from('all_logins').delete().eq('reference_id', id);

      // Clean up dependent tables gracefully before deleting students and library
      await client.from('attendance_logs').delete().eq('library_id', id);
      await client.from('seat_qr_codes').delete().eq('library_id', id);
      await client.from('broadcast_requests').delete().eq('library_id', id);
      await client.from('shifts').delete().eq('library_id', id);

      const { error: stuDelErr } = await client.from('students').delete().eq('library_id', id);
      if (stuDelErr && !isMissingRelationError(stuDelErr)) {
        throw new Error(stuDelErr.message);
      }

      const { error } = await client.from('libraries').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    const removedStudentIds = new Set(
      db.students.filter((s) => s.library_id === id).map((s) => s.id)
    );
    db.libraries = db.libraries.filter((l) => l.id !== id);
    db.students = db.students.filter((s) => s.library_id !== id);
    db.shifts = (db.shifts || []).filter((sh) => sh.library_id !== id);
    db.logins = db.logins.filter(
      (l) => l.reference_id !== id && (!l.reference_id || !removedStudentIds.has(l.reference_id))
    );
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { deleteLibraryId: id });
  },

  // Students
  async getAllStudents(): Promise<Student[]> {
    const client = getSupabaseClient();
    if (client) {
      let { data, error } = await client
        .from('students')
        .select('*')
        .order('created_at', { ascending: false });

      if (error && (error.message || '').toLowerCase().includes('created_at')) {
        const retry = await client.from('students').select('*');
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error('[Supabase] Error fetching students:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw new Error(error.message);
      }
      return (data || []) as Student[];
    }

    console.warn('[Supabase] getAllStudents called without active Supabase client; falling back to local bootstrap.');
    const db = await fetchAndMergeLocalBootstrap();
    return db.students;
  },

  async getStudentsByLibrary(libraryId: string): Promise<Student[]> {
    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('students')
        .select('*')
        .eq('library_id', libraryId)
        .order('seat_number', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []) as Student[];
    }

    const db = await fetchAndMergeLocalBootstrap();
    return db.students.filter((s) => s.library_id === libraryId);
  },

  async getStudentById(id: string): Promise<Student | null> {
    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('students')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data as Student | null;
    }

    const remoteRes = await apiGetJson<{ student: Student | null }>(
      `/api/store/student/${encodeURIComponent(id)}`
    );
    if (remoteRes?.student) {
      return remoteRes.student;
    }

    const db = getLocalDatabase();
    return db.students.find((s) => s.id === id) || null;
  },

  async isLoginCodeAvailable(code: string, excludeReferenceId?: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    if (!clean) return false;

    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('all_logins')
        .select('code, reference_id')
        .ilike('code', clean)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return true;
      return Boolean(excludeReferenceId && data.reference_id === excludeReferenceId);
    }

    const remoteRes = await apiGetJson<{ login: LoginRecord | null }>(
      `/api/store/verify-code/${encodeURIComponent(clean)}`
    );
    if (remoteRes?.login) {
      return Boolean(excludeReferenceId && remoteRes.login.reference_id === excludeReferenceId);
    }

    const db = await fetchAndMergeLocalBootstrap();
    const existing = db.logins.find((l) => l.code.trim().toUpperCase() === clean);
    if (!existing) return true;
    return Boolean(excludeReferenceId && existing.reference_id === excludeReferenceId);
  },

  async generateUniqueStudentPin(): Promise<string> {
    try {
      const logins = await this.getAllLogins();
      return pickAvailableFourDigitPin(logins.map((l) => l.code));
    } catch {
      const db = getLocalDatabase();
      return pickAvailableFourDigitPin(db.logins.map((l) => l.code));
    }
  },

  async createStudent(student: Student, studentPin?: string): Promise<void> {
    const finalPin = (studentPin || '').trim() || (await this.generateUniqueStudentPin());
    if (!isValidStudentPin(finalPin)) {
      throw new Error('Student Pin must be a 4-digit numeric PIN between 1000 and 9999.');
    }

    const available = await this.isLoginCodeAvailable(finalPin);
    if (!available) {
      throw new Error('This 4-digit Student Pin is already assigned to another account. Please choose another PIN.');
    }

    const now = new Date();
    const todayLocalStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const rawNotes = (student.notes || '').trim();
    const hasJoinMarker = /\[(?:JOINED(?::[^\]]*)?|JOIN_ACK)\]/i.test(rawNotes);
    const guaranteedNotes = hasJoinMarker
      ? rawNotes
      : rawNotes
      ? `${rawNotes} [JOINED:${todayLocalStr}]`
      : `[JOINED:${todayLocalStr}]`;

    const studentWithPin: Student = {
      ...student,
      notes: guaranteedNotes,
      student_pin: finalPin,
    };

    const client = getSupabaseClient();
    if (client) {
      let { error: stuError } = await client.from('students').insert(studentWithPin);
      if (stuError && stuError.message?.toLowerCase().includes('student_pin')) {
        const { student_pin: _omitted, ...legacyStudentPayload } = studentWithPin;
        const retry = await client.from('students').insert(legacyStudentPayload);
        stuError = retry.error;
      }
      if (stuError) throw new Error(stuError.message);

      const { error: codeError } = await client.from('all_logins').insert({
        code: finalPin,
        role: 'student',
        reference_id: student.id,
        is_active: true,
      });
      if (codeError) {
        await client.from('students').delete().eq('id', student.id);
        if (codeError.code === '23505') {
          throw new Error('This 4-digit Student Pin is already assigned to another account. Please choose another PIN.');
        }
        throw new Error(codeError.message);
      }
      return;
    }

    const localStudentWithTimestamp: Student = {
      ...studentWithPin,
      created_at: studentWithPin.created_at || now.toISOString(),
    };
    const db = getLocalDatabase();
    db.students.push(localStudentWithTimestamp);
    const loginEntry: LoginRecord = {
      code: finalPin,
      student_pin: finalPin,
      role: 'student',
      reference_id: student.id,
      is_active: true,
    };
    db.logins.push(loginEntry);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', {
      students: [localStudentWithTimestamp],
      logins: [loginEntry],
    });
  },

  async updateStudentPin(studentId: string, newPin: string): Promise<string> {
    const cleanPin = newPin.trim();
    if (!isValidStudentPin(cleanPin)) {
      throw new Error('Student Pin must be a 4-digit numeric PIN between 1000 and 9999.');
    }

    const available = await this.isLoginCodeAvailable(cleanPin, studentId);
    if (!available) {
      throw new Error('This 4-digit Student Pin is already assigned to another account. Please choose another PIN.');
    }

    const client = getSupabaseClient();
    if (client) {
      const { data: existingRows } = await client
        .from('all_logins')
        .select('*')
        .eq('reference_id', studentId)
        .eq('role', 'student');

      const alreadySame = (existingRows || []).find((row: any) => row.code === cleanPin);
      if (alreadySame) {
        if (!alreadySame.is_active) {
          await client.from('all_logins').update({ is_active: true }).eq('code', cleanPin);
        }
        try {
          await client.from('students').update({ student_pin: cleanPin }).eq('id', studentId);
        } catch {
          // ignore if optional column not added yet
        }
        return cleanPin;
      }

      if (existingRows && existingRows.length > 0) {
        await client
          .from('all_logins')
          .delete()
          .eq('reference_id', studentId)
          .eq('role', 'student');
      }

      const { error: insertErr } = await client.from('all_logins').insert({
        code: cleanPin,
        role: 'student',
        reference_id: studentId,
        is_active: true,
      });
      if (insertErr) {
        if (insertErr.code === '23505') {
          throw new Error('This 4-digit Student Pin is already assigned to another account.');
        }
        throw new Error(insertErr.message);
      }

      try {
        await client.from('students').update({ student_pin: cleanPin }).eq('id', studentId);
      } catch {
        // ignore if optional column not added yet
      }
      return cleanPin;
    }

    const db = getLocalDatabase();
    const oldCodes = db.logins
      .filter((l) => l.role === 'student' && l.reference_id === studentId && l.code !== cleanPin)
      .map((l) => l.code);

    db.logins = db.logins.filter(
      (l) => !(l.role === 'student' && l.reference_id === studentId && l.code !== cleanPin)
    );

    const existingSame = db.logins.find(
      (l) => l.role === 'student' && l.reference_id === studentId && l.code === cleanPin
    );
    const updatedLogin: LoginRecord = {
      code: cleanPin,
      student_pin: cleanPin,
      role: 'student',
      reference_id: studentId,
      is_active: true,
    };
    if (existingSame) {
      existingSame.is_active = true;
      existingSame.student_pin = cleanPin;
    } else {
      db.logins.push(updatedLogin);
    }

    const stuIdx = db.students.findIndex((s) => s.id === studentId);
    if (stuIdx !== -1) {
      db.students[stuIdx] = { ...db.students[stuIdx], student_pin: cleanPin };
    }

    saveLocalDatabase(db);
    for (const oldCode of oldCodes) {
      await apiPostJson('/api/store/sync', { deleteLoginCode: oldCode });
    }
    await apiPostJson('/api/store/sync', {
      students: stuIdx !== -1 ? [db.students[stuIdx]] : undefined,
      logins: [updatedLogin],
    });
    return cleanPin;
  },

  async updateStudent(student: Partial<Student> & { id: string }): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('students')
        .update(student)
        .eq('id', student.id);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    const idx = db.students.findIndex((s) => s.id === student.id);
    if (idx !== -1) {
      db.students[idx] = { ...db.students[idx], ...student };
      saveLocalDatabase(db);
    }
    await apiPostJson('/api/store/sync', { students: [student] });
  },

  async exitStudent(student: Student): Promise<Student> {
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];
    const cleanNotes = (student.notes || '')
      .replace(/\s*\[EXITED(?::[^\]]*)?\]/gi, '')
      .replace(/\s*\[THANKED\]/gi, '')
      .replace(/\s*\[EXIT_ACK\]/gi, '')
      .replace(/\s*\[EXIT_SENT\]/gi, '')
      .trim();
    const updatedNotes = cleanNotes
      ? `${cleanNotes} [EXITED:${todayStr}]`
      : `[EXITED:${todayStr}]`;

    const client = getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('students')
        .update({
          is_active: false,
          notes: updatedNotes,
        })
        .eq('id', student.id);
      if (error) throw new Error(error.message);

      await client
        .from('all_logins')
        .update({ is_active: false })
        .eq('reference_id', student.id);

      // Safely close out any currently active checked-in attendance session for today
      if (!attendanceLogsTableMissing) {
        try {
          const { data: openLogs } = await client
            .from('attendance_logs')
            .select('*')
            .eq('student_id', student.id)
            .eq('status', 'checked_in');
          if (Array.isArray(openLogs) && openLogs.length > 0) {
            for (const openLog of openLogs) {
              const checkInMs = openLog.check_in_time ? new Date(openLog.check_in_time).getTime() : NaN;
              const durationMinutes = Number.isFinite(checkInMs)
                ? Math.max(0, Math.round((Date.now() - checkInMs) / 60000))
                : 0;
              await client
                .from('attendance_logs')
                .update({
                  status: 'checked_out',
                  check_out_time: nowIso,
                  duration_minutes: durationMinutes,
                })
                .eq('id', openLog.id);
            }
          }
        } catch {
          // Non-blocking cleanup
        }
      }

      return {
        ...student,
        is_active: false,
        notes: updatedNotes,
      };
    }

    const db = getLocalDatabase();
    const idx = db.students.findIndex((s) => s.id === student.id);
    if (idx !== -1) {
      db.students[idx] = {
        ...db.students[idx],
        is_active: false,
        notes: updatedNotes,
      };
    }
    const updatedLogins = db.logins
      .filter((l) => l.reference_id === student.id)
      .map((l) => ({ ...l, is_active: false }));
    db.logins = db.logins.map((l) =>
      l.reference_id === student.id ? { ...l, is_active: false } : l
    );

    const closedAttendance: AttendanceRecord[] = [];
    db.attendance = (db.attendance || []).map((att) => {
      if (att.student_id === student.id && att.status === 'checked_in') {
        const checkInMs = att.check_in_time ? new Date(att.check_in_time).getTime() : NaN;
        const durationMinutes = Number.isFinite(checkInMs)
          ? Math.max(0, Math.round((Date.now() - checkInMs) / 60000))
          : 0;
        const updated: AttendanceRecord = {
          ...att,
          status: 'checked_out',
          check_out_time: nowIso,
          duration_minutes: durationMinutes,
        };
        closedAttendance.push(updated);
        return updated;
      }
      return att;
    });

    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', {
      students: [{ id: student.id, is_active: false, notes: updatedNotes }],
      logins: updatedLogins,
    });
    for (const att of closedAttendance) {
      void apiPostJson('/api/attendance/record', att);
    }

    return {
      ...student,
      is_active: false,
      notes: updatedNotes,
    };
  },

  async markExitedStudentTag(student: Student, tag: 'THANKED' | 'EXIT_ACK'): Promise<Student> {
    const token = `[${tag}]`;
    const currentNotes = student.notes || '';
    if (currentNotes.includes(token)) return student;
    const updatedNotes = currentNotes ? `${currentNotes} ${token}` : token;

    await this.updateStudent({
      id: student.id,
      notes: updatedNotes,
    });

    return {
      ...student,
      notes: updatedNotes,
    };
  },

  async markStudentAlertTag(student: Student, tag: string): Promise<Student> {
    const token = `[${tag}]`;
    let updatedNotes = student.notes || '';

    if (tag.startsWith('EXPIRING_ACK:')) {
      updatedNotes = updatedNotes
        .replace(/\s*\[EXPIRING_ACK(?::[^\]]*)?\]/gi, '')
        .trim();
    }
    if (tag.startsWith('EXPIRING_SENT:')) {
      updatedNotes = updatedNotes
        .replace(/\s*\[EXPIRING_SENT(?::[^\]]*)?\]/gi, '')
        .trim();
    }

    if (!updatedNotes.includes(token)) {
      updatedNotes = updatedNotes ? `${updatedNotes} ${token}` : token;
    }

    await this.updateStudent({
      id: student.id,
      notes: updatedNotes,
    });

    return {
      ...student,
      notes: updatedNotes,
    };
  },

  async deleteStudent(id: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      await client.from('all_logins').delete().eq('reference_id', id);
      const { error } = await client.from('students').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    db.students = db.students.filter((s) => s.id !== id);
    db.logins = db.logins.filter((l) => l.reference_id !== id);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { deleteStudentId: id });
  },

  // All Logins Directory (automatically upgrades any legacy non-numeric student codes to strict 1000-9999 PINs)
  async getAllLogins(): Promise<LoginRecord[]> {
    const client = getSupabaseClient();
    if (client) {
      let { data, error } = await client
        .from('all_logins')
        .select('*')
        .order('created_at', { ascending: false });

      if (error && (error.message || '').toLowerCase().includes('created_at')) {
        const retry = await client.from('all_logins').select('*');
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error('[Supabase] Error fetching all_logins:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw new Error(error.message);
      }
      const rows = ((data || []) as LoginRecord[]).map((r) => ({ ...r }));

      const usedCodes = new Set(
        rows
          .filter((r) => r.role !== 'student' || isValidStudentPin(r.code))
          .map((r) => String(r.code || '').trim().toUpperCase())
      );

      for (const row of rows) {
        if (row.role === 'student') {
          const clean = String(row.code || '').trim();
          if (!isValidStudentPin(clean)) {
            const newPin = pickAvailableFourDigitPin(usedCodes);
            usedCodes.add(newPin);
            const { error: upErr } = await client
              .from('all_logins')
              .update({ code: newPin })
              .eq('code', row.code);
            if (!upErr) {
              row.code = newPin;
              row.student_pin = newPin;
              if (row.reference_id) {
                try {
                  await client
                    .from('students')
                    .update({ student_pin: newPin })
                    .eq('id', row.reference_id);
                } catch {
                  // ignore if optional column not added yet
                }
              }
            }
          } else {
            row.code = clean;
            row.student_pin = clean;
          }
        }
      }

      return rows;
    }

    const db = await fetchAndMergeLocalBootstrap();
    return db.logins;
  },

  async createLoginCode(record: LoginRecord): Promise<void> {
    const cleanCode = record.code.trim().toUpperCase();
    if (record.role === 'student' && !isValidStudentPin(cleanCode)) {
      throw new Error('Student Pin must be a 4-digit numeric PIN between 1000 and 9999.');
    }

    const normalized: LoginRecord = {
      code: cleanCode,
      role: record.role,
      reference_id: record.reference_id || null,
      is_active: record.is_active ?? true,
      ...(record.role === 'student' ? { student_pin: cleanCode } : {}),
    };

    const client = getSupabaseClient();
    if (client) {
      const { student_pin: _omitted, ...dbRecord } = normalized;
      const { error } = await client.from('all_logins').insert(dbRecord);
      if (error) throw new Error(error.message);
      if (normalized.role === 'student' && normalized.reference_id) {
        try {
          await client
            .from('students')
            .update({ student_pin: cleanCode })
            .eq('id', normalized.reference_id);
        } catch {
          // ignore if optional column not added yet
        }
      }
      return;
    }

    const db = getLocalDatabase();
    db.logins.push(normalized);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { logins: [normalized] });
  },

  async toggleLoginCodeStatus(code: string, isActive: boolean): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('all_logins')
        .update({ is_active: isActive })
        .eq('code', code);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    const found = db.logins.find((l) => l.code === code);
    if (found) {
      found.is_active = isActive;
      saveLocalDatabase(db);
      await apiPostJson('/api/store/sync', { logins: [found] });
    }
  },

  async deleteLoginCode(code: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from('all_logins').delete().eq('code', code);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    db.logins = db.logins.filter((l) => l.code !== code);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { deleteLoginCode: code });
  },

  // Custom Shifts & Pricing Management (Strictly persisted in Supabase when connected)
  async getShiftsByLibrary(libraryId: string): Promise<Shift[]> {
    const cleanLibraryId = (libraryId || '').trim();
    if (!cleanLibraryId) return [];

    const client = getSupabaseClient();
    if (client) {
      let { data, error } = await client
        .from('shifts')
        .select('*')
        .eq('library_id', cleanLibraryId)
        .order('created_at', { ascending: true });

      if (error && (error.message || '').toLowerCase().includes('created_at')) {
        const retry = await client
          .from('shifts')
          .select('*')
          .eq('library_id', cleanLibraryId);
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error('Supabase getShiftsByLibrary error:', error);
        throw new Error(error.message);
      }

      return ((data || []) as Shift[]).map((s) => ({
        ...s,
        fee: Number(s.fee) || 0,
        is_active: s.is_active !== false,
      }));
    }

    // Local/central fallback ONLY when Supabase is not configured
    const db = await fetchAndMergeLocalBootstrap();
    return (db.shifts || []).filter((s) => s.library_id === cleanLibraryId);
  },

  async createShift(shift: Shift): Promise<void> {
    const cleanShift: Shift = {
      id: shift.id,
      library_id: (shift.library_id || '').trim(),
      name: shift.name.trim(),
      timing: shift.timing.trim(),
      fee: Number(shift.fee) || 0,
      is_active: shift.is_active !== false,
    };

    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from('shifts').insert(cleanShift);
      if (error) {
        console.error('Supabase createShift error:', error);
        throw new Error(error.message);
      }
      return;
    }

    const db = getLocalDatabase();
    if (!db.shifts) db.shifts = [];
    db.shifts = db.shifts.filter((s) => s.id !== cleanShift.id);
    db.shifts.push(cleanShift);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { shifts: [cleanShift] });
  },

  async updateShift(shift: Partial<Shift> & { id: string }): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const updatePayload: Record<string, any> = {};
      if (shift.library_id !== undefined) updatePayload.library_id = shift.library_id.trim();
      if (shift.name !== undefined) updatePayload.name = shift.name.trim();
      if (shift.timing !== undefined) updatePayload.timing = shift.timing.trim();
      if (shift.fee !== undefined) updatePayload.fee = Number(shift.fee) || 0;
      if (shift.is_active !== undefined) updatePayload.is_active = Boolean(shift.is_active);

      const { error } = await client
        .from('shifts')
        .update(updatePayload)
        .eq('id', shift.id);
      if (error) {
        console.error('Supabase updateShift error:', error);
        throw new Error(error.message);
      }
      return;
    }

    const db = getLocalDatabase();
    if (!db.shifts) db.shifts = [];
    const idx = db.shifts.findIndex((s) => s.id === shift.id);
    if (idx !== -1) {
      db.shifts[idx] = { ...db.shifts[idx], ...shift };
      saveLocalDatabase(db);
      await apiPostJson('/api/store/sync', { shifts: [db.shifts[idx]] });
    }
  },

  async deleteShift(id: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from('shifts').delete().eq('id', id);
      if (error) {
        console.error('Supabase deleteShift error:', error);
        throw new Error(error.message);
      }
      return;
    }

    const db = getLocalDatabase();
    if (!db.shifts) db.shifts = [];
    db.shifts = db.shifts.filter((s) => s.id !== id);
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', { deleteShiftId: id });
  },

  // Seed sample starter data (useful for demonstration & testing)
  async seedStarterData(): Promise<{ success: boolean; message: string }> {
    const today = new Date();
    const inTwoDays = new Date(today);
    inTwoDays.setDate(today.getDate() + 2);
    const inToday = new Date(today);
    const inNextMonth = new Date(today);
    inNextMonth.setDate(today.getDate() + 30);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const sampleLibraries: Library[] = [
      {
        id: 'lib_vidya',
        name: 'Vidya Study Hub & Library',
        location: 'Sector 14, Main University Road',
        total_seats: 50,
        owner_name: 'Rajesh Sharma',
        contact_phone: '+919876543210',
        subscription_status: 'active',
        subscription_expiry: formatDate(inNextMonth),
      },
      {
        id: 'lib_apex',
        name: 'Apex Scholars Reading Hall',
        location: 'Opposite Civil Hospital, Near Metro Gate 2',
        total_seats: 40,
        owner_name: 'Ananya Deshmukh',
        contact_phone: '+919812345678',
        subscription_status: 'active',
        subscription_expiry: formatDate(inNextMonth),
      },
    ];

    const sampleStudents: Student[] = [
      {
        id: 'stu_arjun',
        library_id: 'lib_vidya',
        name: 'Arjun Mehta',
        phone: '919876543211',
        seat_number: 'A-12',
        shift: 'Morning (7:00 AM - 1:00 PM)',
        subscription_start: formatDate(new Date(today.getTime() - 28 * 86400000)),
        subscription_end: formatDate(inTwoDays), // Expiring in 2 days!
        is_active: true,
        notes: 'UPSC Aspirant',
      },
      {
        id: 'stu_priya',
        library_id: 'lib_vidya',
        name: 'Priya Verma',
        phone: '919876543212',
        seat_number: 'B-04',
        shift: 'Evening (1:00 PM - 7:00 PM)',
        subscription_start: formatDate(new Date(today.getTime() - 29 * 86400000)),
        subscription_end: formatDate(inToday), // Expiring today!
        is_active: true,
        notes: 'Chartered Accountant prep',
      },
      {
        id: 'stu_rohit',
        library_id: 'lib_vidya',
        name: 'Rohit Bansal',
        phone: '919876543213',
        seat_number: 'A-15',
        shift: 'Full Day (24 Hours)',
        subscription_start: formatDate(today),
        subscription_end: formatDate(inNextMonth),
        is_active: true,
        notes: 'Medical NEET PG',
      },
      {
        id: 'stu_sneha',
        library_id: 'lib_apex',
        name: 'Sneha Kulkarni',
        phone: '919876543214',
        seat_number: 'C-08',
        shift: 'Morning (7:00 AM - 1:00 PM)',
        subscription_start: formatDate(today),
        subscription_end: formatDate(inNextMonth),
        is_active: true,
      },
    ];

    const sampleLogins: LoginRecord[] = [
      {
        code: 'ADMIN-MASTER',
        role: 'admin',
        reference_id: null,
        is_active: true,
      },
      {
        code: 'OWNER-VIDYA',
        role: 'owner',
        reference_id: 'lib_vidya',
        is_active: true,
      },
      {
        code: 'OWNER-APEX',
        role: 'owner',
        reference_id: 'lib_apex',
        is_active: true,
      },
      {
        code: '4821',
        role: 'student',
        reference_id: 'stu_arjun',
        is_active: true,
      },
      {
        code: '7394',
        role: 'student',
        reference_id: 'stu_priya',
        is_active: true,
      },
      {
        code: '2658',
        role: 'student',
        reference_id: 'stu_rohit',
        is_active: true,
      },
      {
        code: '9143',
        role: 'student',
        reference_id: 'stu_sneha',
        is_active: true,
      },
    ];

    const sampleShifts: Shift[] = [
      {
        id: 'shift_vidya_1',
        library_id: 'lib_vidya',
        name: 'Morning Shift',
        timing: '07:00 AM - 01:00 PM',
        fee: 800,
        is_active: true,
      },
      {
        id: 'shift_vidya_2',
        library_id: 'lib_vidya',
        name: 'Evening Shift',
        timing: '01:00 PM - 07:00 PM',
        fee: 850,
        is_active: true,
      },
      {
        id: 'shift_vidya_3',
        library_id: 'lib_vidya',
        name: 'Full Day (24 Hours)',
        timing: '24 Hours Access',
        fee: 1500,
        is_active: true,
      },
      {
        id: 'shift_apex_1',
        library_id: 'lib_apex',
        name: 'Early Bird Batch',
        timing: '06:00 AM - 12:00 PM',
        fee: 750,
        is_active: true,
      },
      {
        id: 'shift_apex_2',
        library_id: 'lib_apex',
        name: 'Afternoon & Evening',
        timing: '12:00 PM - 08:00 PM',
        fee: 900,
        is_active: true,
      },
    ];

    const client = getSupabaseClient();
    if (client) {
      try {
        // Upsert logins
        for (const log of sampleLogins) {
          await client.from('all_logins').upsert(log, { onConflict: 'code' });
        }
        // Upsert libraries
        for (const lib of sampleLibraries) {
          await client.from('libraries').upsert(lib, { onConflict: 'id' });
        }
        // Upsert students
        for (const stu of sampleStudents) {
          await client.from('students').upsert(stu, { onConflict: 'id' });
        }
        // Upsert shifts
        for (const sh of sampleShifts) {
          await client.from('shifts').upsert(sh, { onConflict: 'id' });
        }
        return {
          success: true,
          message: 'Starter data successfully uploaded into your Supabase database!',
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Failed to insert starter data: ${err.message}`,
        };
      }
    }

    // Local storage fallback + central backend sync
    const db: LocalDatabase = {
      libraries: sampleLibraries,
      students: sampleStudents,
      logins: sampleLogins,
      shifts: sampleShifts,
    };
    saveLocalDatabase(db);
    await apiPostJson('/api/store/sync', {
      libraries: sampleLibraries,
      students: sampleStudents,
      logins: sampleLogins,
      shifts: sampleShifts,
      replaceAll: true,
    });
    return {
      success: true,
      message: 'Starter data loaded into persistent preview storage!',
    };
  },

  // Broadcast Notice Requests (Owner -> Master Admin queue)
  async getBroadcastRequests(): Promise<BroadcastRequest[]> {
    const db = getLocalDatabase();
    const deletedSet = new Set(Array.isArray(db.deletedBroadcastIds) ? db.deletedBroadcastIds : []);
    const unsyncedSet = new Set(Array.isArray(db.unsyncedBroadcastIds) ? db.unsyncedBroadcastIds : []);
    const rawLocalItems: BroadcastRequest[] = Array.isArray(db.broadcasts) ? db.broadcasts : [];
    const retainedLocalItems = rawLocalItems.filter(
      (item) => !deletedSet.has(item.id) && isWithinBroadcastRetention(item.created_at)
    );

    if (retainedLocalItems.length !== rawLocalItems.length) {
      db.broadcasts = retainedLocalItems;
      saveLocalDatabase(db);
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        const cutoffIso = new Date(Date.now() - BROADCAST_RETENTION_MS).toISOString();
        const { data, error } = await client
          .from('broadcast_requests')
          .select('*')
          .gte('created_at', cutoffIso)
          .order('created_at', { ascending: false });

        // Silently purge expired (>7 days) rows in Supabase without blocking reads
        void client.from('broadcast_requests').delete().lt('created_at', cutoffIso);

        if (error) {
          console.error('[Supabase] Error fetching broadcast_requests:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
        } else if (Array.isArray(data)) {
          const mergedMap = new Map<string, BroadcastRequest>();
          for (const item of data as BroadcastRequest[]) {
            if (!deletedSet.has(item.id) && isWithinBroadcastRetention(item.created_at)) {
              mergedMap.set(item.id, item);
            }
          }
          // Only preserve local items that were created offline/pending sync so deleted rows don't resurrect
          for (const localItem of retainedLocalItems) {
            if (unsyncedSet.has(localItem.id) && !mergedMap.has(localItem.id)) {
              mergedMap.set(localItem.id, localItem);
            }
          }
          const merged = Array.from(mergedMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          db.broadcasts = merged;
          saveLocalDatabase(db);
          return merged;
        }
      } catch (err) {
        console.error('[Supabase] Broadcast requests query threw exception:', err);
      }
    }

    return [...retainedLocalItems].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async getBroadcastRequestsByLibrary(libraryId: string): Promise<BroadcastRequest[]> {
    const all = await this.getBroadcastRequests();
    return all
      .filter((b) => b.library_id === libraryId && isWithinBroadcastRetention(b.created_at))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  },

  async createBroadcastRequest(request: BroadcastRequest): Promise<void> {
    // Immediately persist locally so UI updates with zero network-delay blocking
    const db = getLocalDatabase();
    const existing = Array.isArray(db.broadcasts) ? db.broadcasts : [];
    const unsynced = new Set(Array.isArray(db.unsyncedBroadcastIds) ? db.unsyncedBroadcastIds : []);
    unsynced.add(request.id);
    db.broadcasts = [
      request,
      ...existing.filter((b) => b.id !== request.id && isWithinBroadcastRetention(b.created_at)),
    ];
    db.unsyncedBroadcastIds = Array.from(unsynced);
    saveLocalDatabase(db);

    const client = getSupabaseClient();
    if (client) {
      try {
        const { error } = await client.from('broadcast_requests').insert(request);
        if (!error) {
          const freshDb = getLocalDatabase();
          freshDb.unsyncedBroadcastIds = (freshDb.unsyncedBroadcastIds || []).filter(
            (uid) => uid !== request.id
          );
          saveLocalDatabase(freshDb);
        }
      } catch {
        // Gracefully ignore if Supabase table is not created yet; local queue remains intact
      }
    }
  },

  async updateBroadcastStatus(id: string, status: 'pending' | 'sent' | 'archived'): Promise<void> {
    const db = getLocalDatabase();
    if (Array.isArray(db.broadcasts)) {
      db.broadcasts = db.broadcasts.map((b) => (b.id === id ? { ...b, status } : b));
      saveLocalDatabase(db);
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('broadcast_requests').update({ status }).eq('id', id);
      } catch {
        // Ignore if table not migrated yet
      }
    }
  },

  async updateBroadcastMessage(id: string, message: string): Promise<void> {
    const db = getLocalDatabase();
    if (Array.isArray(db.broadcasts)) {
      db.broadcasts = db.broadcasts.map((b) => (b.id === id ? { ...b, message } : b));
      saveLocalDatabase(db);
    }

    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('broadcast_requests').update({ message }).eq('id', id);
      } catch {
        // Ignore if table not migrated yet
      }
    }
  },

  async deleteBroadcastRequest(id: string): Promise<void> {
    await this.deleteBroadcastRequests([id]);
  },

  async deleteBroadcastRequests(ids: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const idSet = new Set(uniqueIds);
    const db = getLocalDatabase();
    if (Array.isArray(db.broadcasts)) {
      db.broadcasts = db.broadcasts.filter((b) => !idSet.has(b.id));
    }
    db.unsyncedBroadcastIds = (db.unsyncedBroadcastIds || []).filter((uid) => !idSet.has(uid));
    const existingDeleted = Array.isArray(db.deletedBroadcastIds) ? db.deletedBroadcastIds : [];
    const mergedDeleted = [...uniqueIds, ...existingDeleted.filter((d) => !idSet.has(d))];
    db.deletedBroadcastIds = mergedDeleted.slice(0, 200);
    saveLocalDatabase(db);

    const client = getSupabaseClient();
    if (client) {
      try {
        await client.from('broadcast_requests').delete().in('id', uniqueIds);
      } catch {
        // Ignore if table not migrated yet
      }
    }
  },

  // QR Desk Attendance Logs (Central Server + Supabase + Real-Time Sync)
  async getAttendanceByLibrary(libraryId: string): Promise<AttendanceRecord[]> {
    const db = getLocalDatabase();
    const localRecords = (Array.isArray(db.attendance) ? db.attendance : []).filter(
      (r) => r.library_id === libraryId
    );

    const [serverRes, supabaseRecords] = await Promise.all([
      apiGetJson<{ records: AttendanceRecord[]; activationDate?: string | null }>(
        `/api/attendance/library/${encodeURIComponent(libraryId)}`
      ),
      (async (): Promise<AttendanceRecord[] | null> => {
        const client = getSupabaseClient();
        if (!client || attendanceLogsTableMissing) return null;
        try {
          const { data, error } = await client
            .from('attendance_logs')
            .select('*')
            .eq('library_id', libraryId)
            .order('check_in_time', { ascending: false });
          if (error) {
            if (isMissingRelationError(error)) {
              attendanceLogsTableMissing = true;
              return null;
            }
            console.warn('Supabase attendance read error:', error.message);
            return null;
          }
          return Array.isArray(data) ? (data as AttendanceRecord[]) : null;
        } catch {
          return null;
        }
      })(),
    ]);

    if (serverRes?.activationDate) {
      const existingAct = db.attendanceActivationDates?.[libraryId];
      if (!existingAct || serverRes.activationDate < existingAct) {
        db.attendanceActivationDates = {
          ...(db.attendanceActivationDates || {}),
          [libraryId]: serverRes.activationDate,
        };
      }
    }

    const serverRecords = Array.isArray(serverRes?.records) ? serverRes.records : [];
    const merged = mergeAttendanceRecordLists(
      supabaseRecords || [],
      mergeAttendanceRecordLists(serverRecords, localRecords)
    );

    const otherRecords = (Array.isArray(db.attendance) ? db.attendance : []).filter(
      (r) => r.library_id !== libraryId
    );
    db.attendance = [...merged, ...otherRecords];
    saveLocalDatabase(db);
    return merged;
  },

  async getAttendanceByStudent(studentId: string): Promise<AttendanceRecord[]> {
    const db = getLocalDatabase();
    const localRecords = (Array.isArray(db.attendance) ? db.attendance : []).filter(
      (r) => r.student_id === studentId && r.status !== 'absent'
    );

    const [serverRes, supabaseRecords] = await Promise.all([
      apiGetJson<{ records: AttendanceRecord[] }>(
        `/api/attendance/student/${encodeURIComponent(studentId)}`
      ),
      (async (): Promise<AttendanceRecord[] | null> => {
        const client = getSupabaseClient();
        if (!client || attendanceLogsTableMissing) return null;
        try {
          const { data, error } = await client
            .from('attendance_logs')
            .select('*')
            .eq('student_id', studentId)
            .order('check_in_time', { ascending: false });
          if (error) {
            if (isMissingRelationError(error)) {
              attendanceLogsTableMissing = true;
              return null;
            }
            console.warn('Supabase student attendance read error:', error.message);
            return null;
          }
          return Array.isArray(data)
            ? (data as AttendanceRecord[]).filter((item) => item.status !== 'absent')
            : null;
        } catch {
          return null;
        }
      })(),
    ]);

    const serverRecords = (Array.isArray(serverRes?.records) ? serverRes.records : []).filter(
      (r) => r.status !== 'absent'
    );
    const merged = mergeAttendanceRecordLists(
      supabaseRecords || [],
      mergeAttendanceRecordLists(serverRecords, localRecords)
    );

    const otherRecords = (Array.isArray(db.attendance) ? db.attendance : []).filter(
      (r) => r.student_id !== studentId
    );
    db.attendance = [...merged, ...otherRecords];
    saveLocalDatabase(db);
    return merged;
  },

  // Library QR Attendance Activation Date Management
  getLibraryActivationDate(libraryId: string, logs: AttendanceRecord[] = []): string {
    const db = getLocalDatabase();
    const map = db.attendanceActivationDates || {};
    const existing = map[libraryId];
    if (existing) {
      return existing;
    }

    // Derive initial onboarding date: earliest real QR check-in date if present, otherwise today
    const realScanDates = logs
      .filter((r) => r.library_id === libraryId && r.status !== 'absent' && r.date)
      .map((r) => r.date)
      .sort();

    const todayStr = getLocalDateIso();
    const initialDate =
      realScanDates.length > 0 && realScanDates[0] <= todayStr ? realScanDates[0] : todayStr;

    db.attendanceActivationDates = {
      ...map,
      [libraryId]: initialDate,
    };
    saveLocalDatabase(db);
    void apiPostJson('/api/store/sync', {
      attendanceActivationDates: { [libraryId]: initialDate },
    });
    return initialDate;
  },

  ensureLibraryActivationDate(libraryId: string, candidateDate?: string): string {
    const db = getLocalDatabase();
    const map = db.attendanceActivationDates || {};
    const existing = map[libraryId];
    const todayStr = getLocalDateIso();
    const target = candidateDate || todayStr;
    if (existing && existing <= target) {
      return existing;
    }
    const resolved = existing ? (target < existing ? target : existing) : target;
    db.attendanceActivationDates = {
      ...map,
      [libraryId]: resolved,
    };
    saveLocalDatabase(db);
    void apiPostJson('/api/store/sync', {
      attendanceActivationDates: { [libraryId]: resolved },
    });
    return resolved;
  },

  async purgePreActivationAbsentLogs(libraryId: string, activationDate: string): Promise<void> {
    const db = getLocalDatabase();
    const current = Array.isArray(db.attendance) ? db.attendance : [];
    const filtered = current.filter(
      (r) =>
        !(
          r.library_id === libraryId &&
          r.status === 'absent' &&
          r.date < activationDate
        )
    );
    if (filtered.length !== current.length) {
      db.attendance = filtered;
      const validIds = new Set(filtered.map((r) => r.id));
      db.unsyncedAttendanceIds = (db.unsyncedAttendanceIds || []).filter((id) =>
        validIds.has(id)
      );
      saveLocalDatabase(db);
    }

    void apiPostJson('/api/attendance/purge-pre-activation', { libraryId, activationDate });

    const client = getSupabaseClient();
    if (client && !attendanceLogsTableMissing) {
      try {
        await client
          .from('attendance_logs')
          .delete()
          .eq('library_id', libraryId)
          .eq('status', 'absent')
          .lt('date', activationDate);
      } catch {
        // Ignore if table not migrated yet
      }
    }
  },

  async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    const normalizeShiftKey = (s: string | null | undefined) => (s || '').trim().toLowerCase();
    const targetShiftKey = normalizeShiftKey(record.shift);
    const client = getSupabaseClient();

    // 1. Strict pre-insert database query for new check-in attempts
    if (record.status === 'checked_in') {
      // Check Supabase directly if configured and table exists
      if (client && !attendanceLogsTableMissing) {
        try {
          const { data: existingRows, error: queryErr } = await client
            .from('attendance_logs')
            .select('id, status, shift, date')
            .eq('student_id', record.student_id)
            .eq('date', record.date)
            .neq('status', 'absent');

          if (queryErr) {
            if (isMissingRelationError(queryErr)) {
              attendanceLogsTableMissing = true;
            }
          } else if (Array.isArray(existingRows)) {
            const hasDuplicate = existingRows.some(
              (r: any) =>
                r.status === 'checked_in' || normalizeShiftKey(r.shift) === targetShiftKey
            );
            if (hasDuplicate) {
              throw new Error(DUPLICATE_ATTENDANCE_MESSAGE);
            }
          }
        } catch (err: any) {
          if (err?.message === DUPLICATE_ATTENDANCE_MESSAGE) {
            throw err;
          }
        }
      }

      // Check central server & local storage logs for that student on the same date
      const existingLogs = await this.getAttendanceByStudent(record.student_id);
      const duplicateLocalOrServer = existingLogs.some(
        (r) =>
          r.date === record.date &&
          r.status !== 'absent' &&
          (r.status === 'checked_in' || normalizeShiftKey(r.shift) === targetShiftKey)
      );
      if (duplicateLocalOrServer) {
        throw new Error(DUPLICATE_ATTENDANCE_MESSAGE);
      }
    }

    // 2. Write to central Express backend persistence + SSE broadcast (enforces atomic 409 check)
    let serverSaved = false;
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const res = await fetch('/api/attendance/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
        if (res.status === 409) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error || DUPLICATE_ATTENDANCE_MESSAGE);
        }
        if (res.ok) {
          serverSaved = true;
        }
      } catch (err: any) {
        if (err?.message === DUPLICATE_ATTENDANCE_MESSAGE || err?.message?.includes('already been recorded')) {
          throw err;
        }
      }
    }

    // 3. Write directly to Supabase attendance_logs if configured & table exists
    let supabaseSaved = false;
    if (client && !attendanceLogsTableMissing) {
      try {
        const op =
          record.status === 'checked_in'
            ? await client.from('attendance_logs').insert(record)
            : await client.from('attendance_logs').upsert(record, { onConflict: 'id' });

        if (!op.error) {
          supabaseSaved = true;
          if (record.status === 'checked_in') {
            try {
              await client
                .from('attendance_logs')
                .delete()
                .eq('student_id', record.student_id)
                .eq('date', record.date)
                .eq('status', 'absent');
            } catch {
              // Ignore non-blocking cleanup
            }
          }
        } else if (op.error.code === '23505' || op.error.message?.toLowerCase().includes('duplicate')) {
          throw new Error(DUPLICATE_ATTENDANCE_MESSAGE);
        } else if (isMissingRelationError(op.error)) {
          attendanceLogsTableMissing = true;
        } else {
          console.warn('Supabase attendance_logs write fallback to central store:', op.error.message);
        }
      } catch (err: any) {
        if (err?.message === DUPLICATE_ATTENDANCE_MESSAGE) {
          throw err;
        }
        console.warn('Supabase attendance_logs write skipped, using central store:', err);
      }
    }

    if (!serverSaved && client && !supabaseSaved && !attendanceLogsTableMissing) {
      throw new Error('Could not persist attendance record to central database.');
    }

    // 4. Persist into local cache after passing validation
    const db = getLocalDatabase();
    const existing = Array.isArray(db.attendance) ? db.attendance : [];
    const unsynced = new Set(Array.isArray(db.unsyncedAttendanceIds) ? db.unsyncedAttendanceIds : []);
    if (supabaseSaved) {
      unsynced.delete(record.id);
    } else {
      unsynced.add(record.id);
    }
    const filteredExisting = existing.filter((r) => {
      if (r.id === record.id) return false;
      if (
        record.status === 'checked_in' &&
        r.student_id === record.student_id &&
        r.date === record.date &&
        r.status === 'absent'
      ) {
        unsynced.delete(r.id);
        return false;
      }
      return true;
    });
    db.attendance = [record, ...filteredExisting];
    db.unsyncedAttendanceIds = Array.from(unsynced);
    saveLocalDatabase(db);

    return record;
  },

  // Subscribe to live attendance check-in/check-out events (SSE + Supabase Realtime)
  subscribeToAttendanceUpdates({
    libraryId,
    studentId,
    onUpdate,
  }: {
    libraryId?: string;
    studentId?: string;
    onUpdate: () => void;
  }): () => void {
    const cleanups: (() => void)[] = [];

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      try {
        const source = new EventSource('/api/attendance/stream');
        const handleAttendanceEvent = (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}') as {
              libraryId?: string;
              studentId?: string;
            };
            if (libraryId && payload.libraryId && payload.libraryId !== libraryId) return;
            if (studentId && payload.studentId && payload.studentId !== studentId) return;
            onUpdate();
          } catch {
            onUpdate();
          }
        };
        source.addEventListener('attendance', handleAttendanceEvent);
        cleanups.push(() => {
          source.removeEventListener('attendance', handleAttendanceEvent);
          source.close();
        });
      } catch {
        // Ignore EventSource initialization failure
      }
    }

    const client = getSupabaseClient();
    if (client && !attendanceLogsTableMissing) {
      try {
        const filter = libraryId
          ? `library_id=eq.${libraryId}`
          : studentId
          ? `student_id=eq.${studentId}`
          : undefined;
        const channelName = `attendance_live_${libraryId || studentId || 'all'}_${Math.random()
          .toString(36)
          .slice(2, 7)}`;
        const channel = client
          .channel(channelName)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'attendance_logs',
              ...(filter ? { filter } : {}),
            },
            () => {
              onUpdate();
            }
          )
          .subscribe();
        cleanups.push(() => {
          void client.removeChannel(channel);
        });
      } catch {
        // Ignore if realtime is disabled
      }
    }

    return () => {
      for (const fn of cleanups) {
        fn();
      }
    };
  },

  // Subscribe to live student & seat allocation changes via Supabase Realtime
  subscribeToStudentUpdates({
    libraryId,
    onUpdate,
  }: {
    libraryId?: string;
    onUpdate: () => void;
  }): () => void {
    const client = getSupabaseClient();
    if (!client) return () => {};
    try {
      const filter = libraryId ? `library_id=eq.${libraryId}` : undefined;
      const channelName = `students_live_${libraryId || 'all'}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'students',
            ...(filter ? { filter } : {}),
          },
          () => {
            onUpdate();
          }
        )
        .subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    } catch {
      return () => {};
    }
  },

  // Subscribe to live library metadata/seat capacity changes via Supabase Realtime
  subscribeToLibraryUpdates({
    libraryId,
    onUpdate,
  }: {
    libraryId?: string;
    onUpdate: () => void;
  }): () => void {
    const client = getSupabaseClient();
    if (!client) return () => {};
    try {
      const filter = libraryId ? `id=eq.${libraryId}` : undefined;
      const channelName = `libraries_live_${libraryId || 'all'}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'libraries',
            ...(filter ? { filter } : {}),
          },
          () => {
            onUpdate();
          }
        )
        .subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    } catch {
      return () => {};
    }
  },

  // Subscribe to live shift schedule changes via Supabase Realtime
  subscribeToShiftUpdates({
    libraryId,
    onUpdate,
  }: {
    libraryId?: string;
    onUpdate: () => void;
  }): () => void {
    const client = getSupabaseClient();
    if (!client) return () => {};
    try {
      const filter = libraryId ? `library_id=eq.${libraryId}` : undefined;
      const channelName = `shifts_live_${libraryId || 'all'}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const channel = client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shifts',
            ...(filter ? { filter } : {}),
          },
          () => {
            onUpdate();
          }
        )
        .subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    } catch {
      return () => {};
    }
  },

  // Library Seat Roster & Custom Level-H Center-Badge QR References (Supabase + Server Sync)
  async getLibrarySeatRoster(
    libraryId: string,
    libraryHint?: Library | null,
    baseOrigin?: string
  ): Promise<{
    library: Library | null;
    students: Student[];
    seatLabels: string[];
    qrReferences: SeatQrReference[];
  }> {
    const [fetchedLib, students] = await Promise.all([
      libraryHint ? Promise.resolve(libraryHint) : this.getLibraryById(libraryId),
      this.getStudentsByLibrary(libraryId),
    ]);
    const library = fetchedLib || libraryHint || null;

    const customSeats = students
      .map((s) => normalizeSeatLabel(s.seat_number))
      .filter(Boolean);
    const seatLabels = buildCanonicalSeatLabels(library?.total_seats || 50, customSeats);

    const client = getSupabaseClient();
    const existingMap = new Map<string, SeatQrReference>();

    if (client && !seatQrCodesTableMissing) {
      try {
        const { data, error } = await client
          .from('seat_qr_codes')
          .select('*')
          .eq('library_id', libraryId);
        if (error) {
          if (isMissingRelationError(error)) {
            seatQrCodesTableMissing = true;
          }
        } else if (Array.isArray(data)) {
          for (const row of data as SeatQrReference[]) {
            existingMap.set(normalizeSeatLabel(row.seat_label), row);
          }
        }
      } catch {
        // Safe fallback when optional table is absent
      }
    }

    const origin = baseOrigin || getQrScanBaseOrigin();
    const nowIso = new Date().toISOString();
    const toSync: SeatQrReference[] = [];

    const qrReferences: SeatQrReference[] = seatLabels.map((seatLabel) => {
      const badgeNumber = formatSeatBadgeNumber(seatLabel);
      const qrPayload = encodeSeatQrPayload(libraryId, seatLabel, origin);
      const qrImageUrl = `/api/qr/seat/${encodeURIComponent(libraryId)}/${encodeURIComponent(seatLabel)}?format=svg`;
      const id = `qr_${libraryId}_${seatLabel}`;
      const existing = existingMap.get(seatLabel);
      const ref: SeatQrReference = {
        id,
        library_id: libraryId,
        seat_label: seatLabel,
        badge_number: badgeNumber,
        qr_payload: qrPayload,
        error_correction: 'H',
        qr_image_url: qrImageUrl,
        updated_at: nowIso,
      };
      if (
        !existing ||
        existing.badge_number !== badgeNumber ||
        existing.qr_payload !== qrPayload ||
        existing.error_correction !== 'H' ||
        existing.qr_image_url !== qrImageUrl
      ) {
        toSync.push(ref);
      }
      return ref;
    });

    if (toSync.length > 0) {
      void this.syncSeatQrReferences(libraryId, toSync);
    }

    return { library, students, seatLabels, qrReferences };
  },

  async syncSeatQrReferences(libraryId: string, refs: SeatQrReference[]): Promise<void> {
    if (!refs || refs.length === 0) return;

    void apiPostJson('/api/qr/sync', { libraryId, qrReferences: refs });

    const client = getSupabaseClient();
    if (client && !seatQrCodesTableMissing) {
      try {
        // Chunk upserts cleanly to avoid payload limits on large libraries
        for (let i = 0; i < refs.length; i += 100) {
          const chunk = refs.slice(i, i + 100);
          const { error } = await client
            .from('seat_qr_codes')
            .upsert(chunk, { onConflict: 'library_id,seat_label' });
          if (error) {
            if (isMissingRelationError(error)) {
              seatQrCodesTableMissing = true;
            }
            break;
          }
        }
      } catch {
        // Graceful fallback
      }
    }
  },

  // Clear all data
  async clearAllData(): Promise<void> {
    await apiPostJson('/api/store/clear', {});
    const client = getSupabaseClient();
    if (client) {
      await client.from('all_logins').delete().neq('role', 'none');
      await client.from('students').delete().neq('id', 'none');
      await client.from('shifts').delete().neq('id', 'none');
      await client.from('libraries').delete().neq('id', 'none');
      try {
        await client.from('broadcast_requests').delete().neq('id', 'none');
      } catch {
        // ignore if table not present
      }
      try {
        await client.from('attendance_logs').delete().neq('id', 'none');
      } catch {
        // ignore if table not present
      }
      try {
        await client.from('seat_qr_codes').delete().neq('id', 'none');
      } catch {
        // ignore if table not present
      }
      return;
    }

    localStorage.removeItem(STORAGE_KEY_LOCAL_DB);
  },
};
