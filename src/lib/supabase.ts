/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Library, LoginRecord, Student, UserRole } from '../types/database';

// Storage keys for dynamic Supabase settings
const STORAGE_KEY_URL = 'studylingo_supabase_url';
const STORAGE_KEY_ANON = 'studylingo_supabase_anon_key';
const STORAGE_KEY_LOCAL_DB = 'studylingo_local_db_v1';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getStoredSupabaseConfig(): SupabaseConfig {
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

  const storedUrl = localStorage.getItem(STORAGE_KEY_URL) || envUrl;
  const storedKey = localStorage.getItem(STORAGE_KEY_ANON) || envKey;

  return {
    url: storedUrl.trim(),
    anonKey: storedKey.trim(),
  };
}

export function saveStoredSupabaseConfig(config: SupabaseConfig): void {
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
  cachedClient = null; // reset client
}

let cachedClient: SupabaseClient | null = null;

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
      console.error('Error creating Supabase client:', e);
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

  const tableStatus: Record<string, boolean> = {
    all_logins: false,
    libraries: false,
    students: false,
  };

  try {
    const loginsRes = await client.from('all_logins').select('count', { count: 'exact', head: true });
    tableStatus.all_logins = !loginsRes.error;

    const libRes = await client.from('libraries').select('count', { count: 'exact', head: true });
    tableStatus.libraries = !libRes.error;

    const stuRes = await client.from('students').select('count', { count: 'exact', head: true });
    tableStatus.students = !stuRes.error;

    const allExist = tableStatus.all_logins && tableStatus.libraries && tableStatus.students;
    if (allExist) {
      return {
        success: true,
        message: 'Successfully connected! All 3 required tables (all_logins, libraries, students) are detected and accessible.',
        tableStatus,
      };
    } else {
      const missing = Object.entries(tableStatus)
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
        .join(', ');
      return {
        success: false,
        message: `Connected to Supabase project, but the following tables were not found or lack permissions: ${missing}. Please run the SQL setup script in your Supabase SQL Editor.`,
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
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS) but allow anonymous public reads & writes
-- for this unified code-based application:
ALTER TABLE public.all_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- Allow anon read/write access
CREATE POLICY "Allow public all access on all_logins" 
  ON public.all_logins FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow public all access on libraries" 
  ON public.libraries FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

CREATE POLICY "Allow public all access on students" 
  ON public.students FOR ALL 
  TO anon, authenticated 
  USING (true) 
  WITH CHECK (true);

-- Helpful initial index
CREATE INDEX IF NOT EXISTS idx_logins_code ON public.all_logins(code);
CREATE INDEX IF NOT EXISTS idx_students_library ON public.students(library_id);
`;

// Local Storage Fallback state management (used when no Supabase credentials provided)
interface LocalDatabase {
  logins: LoginRecord[];
  libraries: Library[];
  students: Student[];
}

function getLocalDatabase(): LocalDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_DB);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to parse local database', e);
  }
  return { logins: [], libraries: [], students: [] };
}

function saveLocalDatabase(db: LocalDatabase): void {
  localStorage.setItem(STORAGE_KEY_LOCAL_DB, JSON.stringify(db));
}

// Service Layer
export const dataService = {
  // Check login code
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
      return data as LoginRecord | null;
    }

    // Local fallback
    const db = getLocalDatabase();
    const found = db.logins.find(
      (l) => l.code.toUpperCase() === cleanCode.toUpperCase() && l.is_active
    );
    return found || null;
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
        console.error('Error fetching libraries:', error);
        throw new Error(error.message);
      }
      return (data || []) as Library[];
    }

    const db = getLocalDatabase();
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

    const db = getLocalDatabase();
    return db.libraries.find((l) => l.id === id) || null;
  },

  async createLibrary(library: Library, ownerCode?: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error: libError } = await client.from('libraries').insert(library);
      if (libError) throw new Error(libError.message);

      if (ownerCode) {
        const { error: codeError } = await client.from('all_logins').insert({
          code: ownerCode.trim().toUpperCase(),
          role: 'owner',
          reference_id: library.id,
          is_active: true,
        });
        if (codeError) throw new Error(codeError.message);
      }
      return;
    }

    const db = getLocalDatabase();
    db.libraries.push(library);
    if (ownerCode) {
      db.logins.push({
        code: ownerCode.trim().toUpperCase(),
        role: 'owner',
        reference_id: library.id,
        is_active: true,
      });
    }
    saveLocalDatabase(db);
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
  },

  async deleteLibrary(id: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      // delete associated logins & students
      await client.from('all_logins').delete().eq('reference_id', id);
      await client.from('students').delete().eq('library_id', id);
      const { error } = await client.from('libraries').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    db.libraries = db.libraries.filter((l) => l.id !== id);
    db.students = db.students.filter((s) => s.library_id !== id);
    db.logins = db.logins.filter((l) => l.reference_id !== id);
    saveLocalDatabase(db);
  },

  // Students
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

    const db = getLocalDatabase();
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

    const db = getLocalDatabase();
    return db.students.find((s) => s.id === id) || null;
  },

  async createStudent(student: Student, studentCode?: string): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error: stuError } = await client.from('students').insert(student);
      if (stuError) throw new Error(stuError.message);

      if (studentCode) {
        const { error: codeError } = await client.from('all_logins').insert({
          code: studentCode.trim().toUpperCase(),
          role: 'student',
          reference_id: student.id,
          is_active: true,
        });
        if (codeError) throw new Error(codeError.message);
      }
      return;
    }

    const db = getLocalDatabase();
    db.students.push(student);
    if (studentCode) {
      db.logins.push({
        code: studentCode.trim().toUpperCase(),
        role: 'student',
        reference_id: student.id,
        is_active: true,
      });
    }
    saveLocalDatabase(db);
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
  },

  // All Logins Directory
  async getAllLogins(): Promise<LoginRecord[]> {
    const client = getSupabaseClient();
    if (client) {
      const { data, error } = await client
        .from('all_logins')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return (data || []) as LoginRecord[];
    }

    const db = getLocalDatabase();
    return db.logins;
  },

  async createLoginCode(record: LoginRecord): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      const { error } = await client.from('all_logins').insert({
        code: record.code.trim().toUpperCase(),
        role: record.role,
        reference_id: record.reference_id || null,
        is_active: record.is_active ?? true,
      });
      if (error) throw new Error(error.message);
      return;
    }

    const db = getLocalDatabase();
    db.logins.push({
      ...record,
      code: record.code.trim().toUpperCase(),
    });
    saveLocalDatabase(db);
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
        code: 'STU-ARJUN',
        role: 'student',
        reference_id: 'stu_arjun',
        is_active: true,
      },
      {
        code: 'STU-PRIYA',
        role: 'student',
        reference_id: 'stu_priya',
        is_active: true,
      },
      {
        code: 'STU-ROHIT',
        role: 'student',
        reference_id: 'stu_rohit',
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

    // Local storage fallback
    const db: LocalDatabase = {
      libraries: sampleLibraries,
      students: sampleStudents,
      logins: sampleLogins,
    };
    saveLocalDatabase(db);
    return {
      success: true,
      message: 'Starter data loaded into local preview storage!',
    };
  },

  // Clear all data
  async clearAllData(): Promise<void> {
    const client = getSupabaseClient();
    if (client) {
      await client.from('all_logins').delete().neq('role', 'none');
      await client.from('students').delete().neq('id', 'none');
      await client.from('libraries').delete().neq('id', 'none');
      return;
    }

    localStorage.removeItem(STORAGE_KEY_LOCAL_DB);
  },
};
