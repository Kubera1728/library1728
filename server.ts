import 'dotenv/config';
import dns from 'node:dns';
import fs from 'node:fs';
import zlib from 'node:zlib';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import { buildCanonicalSeatLabels, buildMasterQrPdfDocument } from './src/lib/masterQrPdfBuilder.ts';
import {
  encodeSeatQrPayload,
  formatSeatBadgeNumber,
  generateSeatQrPngBytes,
  generateSeatQrSvg,
  normalizeSeatLabel,
} from './src/lib/seatQrGenerator.ts';

dns.setDefaultResultOrder('ipv4first');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DATA_DIR = path.resolve(__dirname, '.studylingo-data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

interface ServerAttendanceRecord {
  id: string;
  library_id: string;
  student_id: string;
  student_name: string;
  seat_number: string;
  shift: string;
  date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  duration_minutes: number | null;
  status: 'checked_in' | 'checked_out' | 'absent';
  qr_payload: string;
  created_at?: string;
}

interface ServerStore {
  libraries: any[];
  students: any[];
  logins: any[];
  shifts: any[];
  attendance: ServerAttendanceRecord[];
  attendanceActivationDates: Record<string, string>;
  seatQrReferences?: Record<string, any[]>;
}

const DEFAULT_STORE: ServerStore = {
  libraries: [],
  students: [],
  logins: [{ code: 'ADMIN-MASTER', role: 'admin', reference_id: null, is_active: true }],
  shifts: [],
  attendance: [],
  attendanceActivationDates: {},
  seatQrReferences: {},
};

const STRICT_STUDENT_PIN_REGEX = /^[1-9]\d{3}$/;

function isValidStudentPin(pin: unknown): boolean {
  return STRICT_STUDENT_PIN_REGEX.test(String(pin || '').trim());
}

function generateServerFourDigitPin(usedCodes: Set<string>): string {
  for (let i = 0; i < 2000; i++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }
  for (let n = 1000; n <= 9999; n++) {
    const candidate = String(n);
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function migrateLegacyStudentLoginsInStore(store: ServerStore): boolean {
  let changed = false;
  const usedCodes = new Set<string>();

  for (const login of store.logins) {
    if (login?.role !== 'student' || isValidStudentPin(login.code)) {
      if (login?.code) usedCodes.add(String(login.code).trim().toUpperCase());
    }
  }

  for (const login of store.logins) {
    if (login?.role === 'student') {
      const clean = String(login.code || '').trim();
      if (!isValidStudentPin(clean)) {
        const nextPin = generateServerFourDigitPin(usedCodes);
        login.code = nextPin;
        login.student_pin = nextPin;
        changed = true;
      } else {
        if (login.code !== clean) {
          login.code = clean;
          changed = true;
        }
        if (login.student_pin !== clean) {
          login.student_pin = clean;
          changed = true;
        }
      }
    }
  }

  const studentPinByRef = new Map<string, string>();
  for (const login of store.logins) {
    if (login?.role === 'student' && login.reference_id && isValidStudentPin(login.code)) {
      studentPinByRef.set(String(login.reference_id), String(login.code));
    }
  }

  for (const stu of store.students) {
    const linkedPin = studentPinByRef.get(String(stu?.id || ''));
    if (linkedPin && stu.student_pin !== linkedPin) {
      stu.student_pin = linkedPin;
      changed = true;
    }
  }

  return changed;
}

function loadServerStore(): ServerStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const loaded: ServerStore = {
        libraries: Array.isArray(parsed.libraries) ? parsed.libraries : [],
        students: Array.isArray(parsed.students) ? parsed.students : [],
        logins:
          Array.isArray(parsed.logins) && parsed.logins.length > 0
            ? parsed.logins
            : [...DEFAULT_STORE.logins],
        shifts: Array.isArray(parsed.shifts) ? parsed.shifts : [],
        attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
        attendanceActivationDates:
          parsed.attendanceActivationDates && typeof parsed.attendanceActivationDates === 'object'
            ? parsed.attendanceActivationDates
            : {},
        seatQrReferences:
          parsed.seatQrReferences && typeof parsed.seatQrReferences === 'object'
            ? parsed.seatQrReferences
            : {},
      };
      if (migrateLegacyStudentLoginsInStore(loaded)) {
        try {
          if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
          }
          fs.writeFileSync(STORE_FILE, JSON.stringify(loaded, null, 2), 'utf8');
        } catch {
          // ignore initial write error
        }
      }
      return loaded;
    }
  } catch (err) {
    console.warn('Could not load persisted store.json, initializing fresh store:', err);
  }
  return {
    libraries: [],
    students: [],
    logins: [...DEFAULT_STORE.logins],
    shifts: [],
    attendance: [],
    attendanceActivationDates: {},
  };
}

let serverStore: ServerStore = loadServerStore();

function persistServerStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(serverStore, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to persist store.json:', err);
  }
}

const sseClients = new Set<Response>();

function broadcastAttendanceEvent(payload: {
  type: 'record_saved' | 'purged' | 'cleared';
  libraryId?: string;
  studentId?: string;
  recordId?: string;
}): void {
  const frame = `event: attendance\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

interface BroadcastGenerateBody {
  libraryName?: string;
  category?: string;
  reason?: string;
  scheduleMode?: 'single' | 'range' | 'hours';
  singleDate?: string;
  fromDate?: string;
  toDate?: string;
  hoursDate?: string;
  startTime?: string;
  endTime?: string;
}

function formatReadableDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return dateStr;
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatReadableTime(timeStr?: string): string {
  if (!timeStr) return '';
  try {
    const [hourStr, minStr] = timeStr.split(':');
    const hour = Number(hourStr);
    const min = Number(minStr);
    if (Number.isNaN(hour) || Number.isNaN(min)) return timeStr;
    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}:${String(min).padStart(2, '0')} ${period}`;
  } catch {
    return timeStr;
  }
}

const PRODUCTION_QR_BASE_ORIGIN = 'https://library1728.vercel.app';

function isPreviewOrLocalHost(urlOrHost: string): boolean {
  const lower = urlOrHost.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('.run.app') ||
    lower.includes('0.0.0.0')
  );
}

function resolveRequestBaseOrigin(req: Request, explicitOrigin?: string): string {
  if (
    explicitOrigin &&
    /^https?:\/\//i.test(explicitOrigin.trim()) &&
    !isPreviewOrLocalHost(explicitOrigin)
  ) {
    return explicitOrigin.trim().replace(/\/+$/, '');
  }
  const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const hostHeader = String(req.headers['x-forwarded-host'] || req.get('host') || '').trim();
  if (hostHeader && !isPreviewOrLocalHost(hostHeader)) {
    return `${protoHeader}://${hostHeader}`.replace(/\/+$/, '');
  }
  return PRODUCTION_QR_BASE_ORIGIN;
}

function getPublicSupabaseEnv(): { VITE_SUPABASE_URL: string; VITE_SUPABASE_ANON_KEY: string } {
  const url = (
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const anonKey = (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.VITE_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  return {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anonKey,
  };
}

function injectPublicEnvIntoHtml(html: string): string {
  const publicEnv = getPublicSupabaseEnv();
  const serialized = JSON.stringify(publicEnv).replace(/</g, '\\u003c');
  const scriptTag = `<script>window.__STUDYLINGO_ENV__=${serialized};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${scriptTag}\n  </head>`);
  }
  return `${scriptTag}\n${html}`;
}

function getServerSupabaseClient(req?: Request) {
  const headerUrl = req ? String(req.headers['x-supabase-url'] || '').trim() : '';
  const headerKey = req ? String(req.headers['x-supabase-key'] || '').trim() : '';
  const runtimeEnv = getPublicSupabaseEnv();
  const url = (headerUrl || runtimeEnv.VITE_SUPABASE_URL).trim();
  const key = (headerKey || runtimeEnv.VITE_SUPABASE_ANON_KEY).trim();
  if (!url || !key || !url.startsWith('http')) return null;
  try {
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

async function resolveLibraryAndSeatsForQr(
  libraryId: string,
  req: Request,
  fallbackLibrary?: any,
  providedSeatLabels?: string[]
) {
  let library =
    serverStore.libraries.find((l) => l.id === libraryId) || fallbackLibrary || null;
  let libStudents = serverStore.students.filter((s) => s.library_id === libraryId);
  const storedRefsMap = new Map<string, any>();

  const existingServerRefs = serverStore.seatQrReferences?.[libraryId];
  if (Array.isArray(existingServerRefs)) {
    for (const r of existingServerRefs) {
      if (r?.seat_label) storedRefsMap.set(normalizeSeatLabel(r.seat_label), r);
    }
  }

  const sb = getServerSupabaseClient(req);
  if (sb) {
    try {
      const [libRes, stuRes, qrRes] = await Promise.all([
        sb.from('libraries').select('*').eq('id', libraryId).maybeSingle(),
        sb.from('students').select('id, name, seat_number, is_active').eq('library_id', libraryId),
        sb.from('seat_qr_codes').select('*').eq('library_id', libraryId),
      ]);
      if (!libRes.error && libRes.data) {
        library = libRes.data;
      }
      if (!stuRes.error && Array.isArray(stuRes.data)) {
        libStudents = stuRes.data;
      }
      if (!qrRes.error && Array.isArray(qrRes.data)) {
        for (const r of qrRes.data) {
          if (r?.seat_label) storedRefsMap.set(normalizeSeatLabel(r.seat_label), r);
        }
      }
    } catch {
      // Fallback cleanly to serverStore / fallbackLibrary if Supabase is unavailable
    }
  }

  if (!library) {
    library = {
      id: libraryId,
      name: 'Ekā Library',
      location: 'Study Hall',
      total_seats: 50,
    };
  }

  const extraSeats = [
    ...libStudents.map((s: any) => String(s?.seat_number || '')),
    ...(Array.isArray(providedSeatLabels) ? providedSeatLabels : []),
  ].filter(Boolean);

  const seatLabels = buildCanonicalSeatLabels(Number(library.total_seats) || 50, extraSeats);

  return { library, libStudents, seatLabels, storedRefsMap };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/config/public', (_req: Request, res: Response) => {
    const publicEnv = getPublicSupabaseEnv();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      supabaseUrl: publicEnv.VITE_SUPABASE_URL,
      supabaseAnonKey: publicEnv.VITE_SUPABASE_ANON_KEY,
    });
  });

  app.post('/api/broadcast/generate', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        res.status(400).json({
          error:
            'Gemini API key is not configured. Please set GEMINI_API_KEY in the Settings > Secrets panel.',
        });
        return;
      }

      const body = (req.body || {}) as BroadcastGenerateBody;
      const libraryName = (body.libraryName || 'the library').trim();
      const category = (body.category || 'General Notice').trim();
      const reason = (body.reason || '').trim();
      const scheduleMode = body.scheduleMode || 'single';

      if (!reason) {
        res.status(400).json({ error: 'Please enter an event or reason to generate the notice.' });
        return;
      }

      let timingDescription = '';
      if (scheduleMode === 'range') {
        const fromFmt = formatReadableDate(body.fromDate);
        const toFmt = formatReadableDate(body.toDate);
        timingDescription =
          fromFmt && toFmt
            ? `From ${fromFmt} to ${toFmt}`
            : fromFmt || toFmt || 'for the upcoming dates';
      } else if (scheduleMode === 'hours') {
        const dateFmt = formatReadableDate(body.hoursDate);
        const startFmt = formatReadableTime(body.startTime);
        const endFmt = formatReadableTime(body.endTime);
        const timeRange =
          startFmt && endFmt ? `${startFmt} to ${endFmt}` : startFmt || endFmt || 'scheduled hours';
        timingDescription = dateFmt ? `On ${dateFmt}, between ${timeRange}` : `Between ${timeRange}`;
      } else {
        const singleFmt = formatReadableDate(body.singleDate);
        timingDescription = singleFmt ? `On ${singleFmt} (full day)` : 'Tomorrow';
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 40000,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = [
        `Draft a concise, warm, and professional WhatsApp broadcast message to study library students.`,
        `Library Name: ${libraryName}`,
        `Notice Category: ${category}`,
        `Event / Reason: ${reason}`,
        `Schedule / Timing: ${timingDescription}`,
        `WhatsApp Bold Formatting Rules (STRICT):`,
        `- Use ONLY single asterisks *text* for WhatsApp bold formatting. NEVER use double asterisks **text**.`,
        `- Always bold the Library Name in uppercase or title case (e.g., *${libraryName.toUpperCase()}* or *${libraryName}*).`,
        `- Always bold the Status / Action phrase (e.g., *remain closed*, *deep cleaning session*, *scheduled maintenance*, *revised timings*).`,
        `- Always bold the Specific Date(s) and Time(s) (e.g., *Sunday, 15 November 2026*, *4:00 PM to 10:00 PM*).`,
        `- Always bold the Event / Festival / Reason name (e.g., *${reason}*).`,
        `Tone & Structure Requirements:`,
        `- Address students warmly (e.g., "Dear Students,").`,
        `- Clearly state whether the library is closed, operating on revised hours, or undergoing maintenance/cleaning during the specified date/time.`,
        `- Mention the resumption note politely if applicable, or thank students for their cooperation.`,
        `- Include 1 to 2 tasteful relevant emojis suitable for WhatsApp.`,
        `- Keep it crisp (2 to 4 short sentences, under 80 words).`,
        `- Return ONLY the final ready-to-send WhatsApp message text without outer quotation marks or preamble.`,
      ].join('\n');

      const generationPromise = ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a communication assistant for Indian study hall and library owners writing clear, polite WhatsApp notices for enrolled students. Always highlight key details (library name, closure/action status, dates/times, and event/reason) using WhatsApp single-asterisk *bold* syntax, never Markdown **bold**.',
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.MINIMAL,
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(Object.assign(new Error('Gemini request timed out. Please try again.'), { status: 504 }));
        }, 40000);
      });

      const response = await Promise.race([generationPromise, timeoutPromise]);

      let generatedText = (response.text || '').trim().replace(/^["']|["']$/g, '');
      if (!generatedText) {
        res.status(502).json({ error: 'Gemini returned an empty notice. Please try again.' });
        return;
      }

      // Normalize any Markdown **bold** -> WhatsApp *bold*
      generatedText = generatedText.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

      // Ensure libraryName and reason are wrapped in *...* if left unbolded
      const ensureWhatsAppBold = (text: string, phrase: string): string => {
        const clean = phrase.trim();
        if (!clean || clean.length < 3) return text;
        const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!\\*)\\b(${escaped})\\b(?!\\*)`, 'i');
        // Skip replacement if already bolded anywhere in text
        const alreadyBoldRegex = new RegExp(`\\*[^*\\n]*${escaped}[^*\\n]*\\*`, 'i');
        if (alreadyBoldRegex.test(text)) return text;
        return text.replace(regex, '*$1*');
      };

      generatedText = ensureWhatsAppBold(generatedText, libraryName);
      generatedText = ensureWhatsAppBold(generatedText, reason);

      console.log(`Gemini broadcast generated in ${Date.now() - startedAt}ms`);
      res.json({ message: generatedText });
    } catch (err: any) {
      console.error(`Gemini broadcast generation error (${Date.now() - startedAt}ms):`, err?.message || err);
      const status = typeof err?.status === 'number' ? err.status : 500;
      const rawMessage = err?.message || 'Failed to generate broadcast message.';
      res.status(status).json({ error: rawMessage });
    }
  });

  // =========================================================================
  // Real-Time Attendance Stream (Server-Sent Events) & Persistent Backend API
  // =========================================================================
  app.get('/api/attendance/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write('event: connected\ndata: {"ok":true}\n\n');
    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(':\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/attendance/library/:libraryId', (req: Request, res: Response) => {
    const libraryId = (req.params.libraryId || '').trim();
    const records = serverStore.attendance
      .filter((r) => r.library_id === libraryId)
      .sort((a, b) => {
        const ta = new Date(a.check_in_time || a.created_at || a.date).getTime();
        const tb = new Date(b.check_in_time || b.created_at || b.date).getTime();
        return tb - ta;
      });
    res.json({
      records,
      activationDate: serverStore.attendanceActivationDates[libraryId] || null,
    });
  });

  app.get('/api/attendance/student/:studentId', (req: Request, res: Response) => {
    const studentId = (req.params.studentId || '').trim();
    const records = serverStore.attendance
      .filter((r) => r.student_id === studentId && r.status !== 'absent')
      .sort((a, b) => {
        const ta = new Date(a.check_in_time || a.created_at || a.date).getTime();
        const tb = new Date(b.check_in_time || b.created_at || b.date).getTime();
        return tb - ta;
      });
    res.json({ records });
  });

  app.post('/api/attendance/record', (req: Request, res: Response) => {
    const record = req.body as ServerAttendanceRecord | undefined;
    if (!record || !record.id || !record.library_id || !record.student_id || !record.date) {
      res.status(400).json({ error: 'Invalid attendance record payload.' });
      return;
    }

    const normalizeShiftKey = (s: string | null | undefined) => (s || '').trim().toLowerCase();
    const incomingShiftKey = normalizeShiftKey(record.shift);

    // 1. Strict Duplicate & Multi-Scan Prevention for Check-In
    if (record.status === 'checked_in') {
      const existingSameDayShift = serverStore.attendance.find(
        (r) =>
          r.student_id === record.student_id &&
          r.date === record.date &&
          r.status !== 'absent' &&
          (r.status === 'checked_in' || normalizeShiftKey(r.shift) === incomingShiftKey)
      );

      if (existingSameDayShift) {
        res.status(409).json({
          error: 'Attendance for this shift has already been recorded or completed today.',
          code: 'DUPLICATE_ATTENDANCE',
        });
        return;
      }

      serverStore.attendance = [
        record,
        ...serverStore.attendance.filter(
          (r) =>
            !(
              r.student_id === record.student_id &&
              r.date === record.date &&
              r.status === 'absent'
            )
        ),
      ];
    } else if (record.status === 'checked_out') {
      const idx = serverStore.attendance.findIndex((r) => r.id === record.id);
      if (idx !== -1) {
        if (serverStore.attendance[idx].status === 'checked_out') {
          res.status(409).json({
            error: 'Attendance for this shift has already been recorded or completed today.',
            code: 'DUPLICATE_ATTENDANCE',
          });
          return;
        }
        serverStore.attendance[idx] = { ...serverStore.attendance[idx], ...record };
      } else {
        const duplicateCompleted = serverStore.attendance.find(
          (r) =>
            r.student_id === record.student_id &&
            r.date === record.date &&
            r.status === 'checked_out' &&
            normalizeShiftKey(r.shift) === incomingShiftKey
        );
        if (duplicateCompleted) {
          res.status(409).json({
            error: 'Attendance for this shift has already been recorded or completed today.',
            code: 'DUPLICATE_ATTENDANCE',
          });
          return;
        }
        serverStore.attendance = [record, ...serverStore.attendance];
      }
    } else {
      // Absent log: never overwrite an existing check-in/check-out for that student and date
      const hasRealAttendance = serverStore.attendance.some(
        (r) =>
          r.student_id === record.student_id &&
          r.date === record.date &&
          r.status !== 'absent'
      );
      if (hasRealAttendance) {
        res.json({
          ok: true,
          skipped: true,
          activationDate: serverStore.attendanceActivationDates[record.library_id] || null,
        });
        return;
      }
      const idx = serverStore.attendance.findIndex((r) => r.id === record.id);
      if (idx !== -1) {
        serverStore.attendance[idx] = { ...serverStore.attendance[idx], ...record };
      } else {
        serverStore.attendance = [record, ...serverStore.attendance];
      }
    }

    if (record.status !== 'absent' && record.date) {
      const existingAct = serverStore.attendanceActivationDates[record.library_id];
      if (!existingAct || record.date < existingAct) {
        serverStore.attendanceActivationDates[record.library_id] = record.date;
      }
    }

    persistServerStore();
    broadcastAttendanceEvent({
      type: 'record_saved',
      libraryId: record.library_id,
      studentId: record.student_id,
      recordId: record.id,
    });

    res.json({
      ok: true,
      record,
      activationDate: serverStore.attendanceActivationDates[record.library_id] || null,
    });
  });

  app.post('/api/attendance/purge-pre-activation', (req: Request, res: Response) => {
    const { libraryId, activationDate } = (req.body || {}) as {
      libraryId?: string;
      activationDate?: string;
    };
    if (!libraryId || !activationDate) {
      res.status(400).json({ error: 'libraryId and activationDate required.' });
      return;
    }

    const existingAct = serverStore.attendanceActivationDates[libraryId];
    if (!existingAct || activationDate < existingAct) {
      serverStore.attendanceActivationDates[libraryId] = activationDate;
    }

    const prevLen = serverStore.attendance.length;
    serverStore.attendance = serverStore.attendance.filter(
      (r) => !(r.library_id === libraryId && r.status === 'absent' && r.date < activationDate)
    );
    if (serverStore.attendance.length !== prevLen || !existingAct) {
      persistServerStore();
      broadcastAttendanceEvent({ type: 'purged', libraryId });
    }
    res.json({ ok: true });
  });

  // Central cross-device store endpoints (backs local/preview deployments seamlessly across devices)
  app.get('/api/store/bootstrap', (_req: Request, res: Response) => {
    res.json(serverStore);
  });

  app.get('/api/store/library/:id', (req: Request, res: Response) => {
    const id = (req.params.id || '').trim();
    const library = serverStore.libraries.find((l) => l.id === id) || null;
    res.json({ library });
  });

  app.get('/api/store/student/:id', (req: Request, res: Response) => {
    const id = (req.params.id || '').trim();
    const student = serverStore.students.find((s) => s.id === id) || null;
    res.json({ student });
  });

  app.get('/api/store/verify-code/:code', (req: Request, res: Response) => {
    const cleanCode = decodeURIComponent(req.params.code || '').trim().toUpperCase();
    const login =
      serverStore.logins.find((l) => {
        if (l.is_active === false) return false;
        const stored = String(l.code || '').trim().toUpperCase();
        if (l.role === 'student') {
          return isValidStudentPin(cleanCode) && isValidStudentPin(stored) && stored === cleanCode;
        }
        return stored === cleanCode;
      }) || null;
    res.json({ login });
  });

  app.post('/api/store/sync', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      libraries?: any[];
      students?: any[];
      logins?: any[];
      shifts?: any[];
      attendanceActivationDates?: Record<string, string>;
      replaceAll?: boolean;
      deleteLibraryId?: string;
      deleteStudentId?: string;
      deleteShiftId?: string;
      deleteLoginCode?: string;
    };

    if (body.replaceAll) {
      if (Array.isArray(body.libraries)) serverStore.libraries = body.libraries;
      if (Array.isArray(body.students)) serverStore.students = body.students;
      if (Array.isArray(body.logins) && body.logins.length > 0) serverStore.logins = body.logins;
      if (Array.isArray(body.shifts)) serverStore.shifts = body.shifts;
      if (body.attendanceActivationDates) {
        serverStore.attendanceActivationDates = {
          ...serverStore.attendanceActivationDates,
          ...body.attendanceActivationDates,
        };
      }
      persistServerStore();
      res.json({ ok: true });
      return;
    }

    const upsertByKey = (list: any[], items: any[], key: string) => {
      const map = new Map<string, any>();
      for (const existing of list) {
        if (existing?.[key] !== undefined) map.set(String(existing[key]), existing);
      }
      for (const incoming of items) {
        if (incoming?.[key] !== undefined) {
          const k = String(incoming[key]);
          map.set(k, { ...(map.get(k) || {}), ...incoming });
        }
      }
      return Array.from(map.values());
    };

    if (Array.isArray(body.libraries)) {
      serverStore.libraries = upsertByKey(serverStore.libraries, body.libraries, 'id');
    }
    if (Array.isArray(body.students)) {
      serverStore.students = upsertByKey(serverStore.students, body.students, 'id');
    }
    if (Array.isArray(body.logins)) {
      serverStore.logins = upsertByKey(
        serverStore.logins,
        body.logins.map((l) => ({ ...l, code: String(l.code || '').trim().toUpperCase() })),
        'code'
      );
    }
    if (Array.isArray(body.shifts)) {
      serverStore.shifts = upsertByKey(serverStore.shifts, body.shifts, 'id');
    }
    if (body.attendanceActivationDates) {
      for (const [libId, dt] of Object.entries(body.attendanceActivationDates)) {
        const prev = serverStore.attendanceActivationDates[libId];
        if (!prev || dt < prev) {
          serverStore.attendanceActivationDates[libId] = dt;
        }
      }
    }

    if (body.deleteLibraryId) {
      const id = body.deleteLibraryId;
      serverStore.libraries = serverStore.libraries.filter((l) => l.id !== id);
      serverStore.students = serverStore.students.filter((s) => s.library_id !== id);
      serverStore.logins = serverStore.logins.filter((l) => l.reference_id !== id);
      serverStore.shifts = serverStore.shifts.filter((s) => s.library_id !== id);
      serverStore.attendance = serverStore.attendance.filter((a) => a.library_id !== id);
    }
    if (body.deleteStudentId) {
      const id = body.deleteStudentId;
      serverStore.students = serverStore.students.filter((s) => s.id !== id);
      serverStore.logins = serverStore.logins.filter((l) => l.reference_id !== id);
    }
    if (body.deleteShiftId) {
      serverStore.shifts = serverStore.shifts.filter((s) => s.id !== body.deleteShiftId);
    }
    if (body.deleteLoginCode) {
      const c = body.deleteLoginCode.trim().toUpperCase();
      serverStore.logins = serverStore.logins.filter(
        (l) => String(l.code || '').trim().toUpperCase() !== c
      );
    }

    migrateLegacyStudentLoginsInStore(serverStore);
    persistServerStore();
    res.json({ ok: true });
  });

  app.post('/api/store/clear', (_req: Request, res: Response) => {
    serverStore = {
      libraries: [],
      students: [],
      logins: [...DEFAULT_STORE.logins],
      shifts: [],
      attendance: [],
      attendanceActivationDates: {},
      seatQrReferences: {},
    };
    persistServerStore();
    broadcastAttendanceEvent({ type: 'cleared' });
    res.json({ ok: true });
  });

  // =========================================================================
  // Custom Level-H Center-Badge QR & Master PDF Backend API (Supabase-Synced)
  // =========================================================================
  app.post('/api/qr/sync', (req: Request, res: Response) => {
    const libraryId = String(req.body?.libraryId || '').trim();
    const refs = Array.isArray(req.body?.qrReferences) ? req.body.qrReferences : [];
    if (!libraryId) {
      res.status(400).json({ error: 'libraryId is required' });
      return;
    }
    if (!serverStore.seatQrReferences) {
      serverStore.seatQrReferences = {};
    }
    serverStore.seatQrReferences[libraryId] = refs;
    persistServerStore();
    res.json({ ok: true, count: refs.length });
  });

  app.get('/api/qr/seat/:libraryId/:seatLabel', (req: Request, res: Response) => {
    const libraryId = decodeURIComponent(req.params.libraryId || '').trim();
    const rawSeat = decodeURIComponent(req.params.seatLabel || '').trim();
    if (!libraryId || !rawSeat) {
      res.status(400).json({ error: 'libraryId and seatLabel are required' });
      return;
    }
    const cleanSeat = normalizeSeatLabel(rawSeat.replace(/\.(svg|png)$/i, ''));
    const formatQuery = String(req.query.format || '').toLowerCase();
    const isPng = formatQuery === 'png' || rawSeat.toLowerCase().endsWith('.png');
    const isJson = formatQuery === 'json';
    const size = Math.min(640, Math.max(160, Number(req.query.size) || 300));
    const baseOrigin = resolveRequestBaseOrigin(
      req,
      typeof req.query.origin === 'string' ? req.query.origin : undefined
    );

    if (isJson) {
      const badgeNumber = formatSeatBadgeNumber(cleanSeat);
      const qrPayload = encodeSeatQrPayload(libraryId, cleanSeat, baseOrigin);
      const svg = generateSeatQrSvg(libraryId, cleanSeat, { size, baseOrigin });
      res.json({
        libraryId,
        seatLabel: cleanSeat,
        badgeNumber,
        errorCorrection: 'H',
        qrPayload,
        qrImageUrl: `/api/qr/seat/${encodeURIComponent(libraryId)}/${encodeURIComponent(cleanSeat)}?format=svg`,
        svgDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      });
      return;
    }

    if (isPng) {
      const pngBytes = generateSeatQrPngBytes(
        libraryId,
        cleanSeat,
        { size, baseOrigin },
        (raw) => zlib.deflateSync(raw)
      );
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(Buffer.from(pngBytes));
      return;
    }

    const svg = generateSeatQrSvg(libraryId, cleanSeat, { size, baseOrigin });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  });

  app.get('/api/qr/library/:libraryId', async (req: Request, res: Response) => {
    try {
      const libraryId = decodeURIComponent(req.params.libraryId || '').trim();
      if (!libraryId) {
        res.status(400).json({ error: 'libraryId is required' });
        return;
      }
      const baseOrigin = resolveRequestBaseOrigin(
        req,
        typeof req.query.origin === 'string' ? req.query.origin : undefined
      );
      const { library, seatLabels, storedRefsMap } =
        await resolveLibraryAndSeatsForQr(libraryId, req);

      const seats = seatLabels.map((seatLabel) => {
        const stored = storedRefsMap.get(seatLabel);
        return {
          seatLabel,
          badgeNumber: stored?.badge_number || formatSeatBadgeNumber(seatLabel),
          qrPayload: stored?.qr_payload || encodeSeatQrPayload(libraryId, seatLabel, baseOrigin),
          errorCorrection: 'H' as const,
          qrImageUrl:
            stored?.qr_image_url ||
            `/api/qr/seat/${encodeURIComponent(libraryId)}/${encodeURIComponent(seatLabel)}?format=svg`,
        };
      });

      res.json({
        library,
        totalSeats: seats.length,
        seats,
      });
    } catch (err: any) {
      console.error('Error building library QR roster:', err);
      res.status(500).json({ error: err?.message || 'Failed to load library QR roster' });
    }
  });

  const handleMasterQrPdfRequest = async (req: Request, res: Response, libraryIdInput: string) => {
    try {
      const libraryId = libraryIdInput.trim();
      if (!libraryId) {
        res.status(400).json({ error: 'libraryId is required' });
        return;
      }
      const body = (req.body || {}) as {
        library?: any;
        seatLabels?: string[];
        baseOrigin?: string;
      };
      const baseOrigin = resolveRequestBaseOrigin(
        req,
        body.baseOrigin || (typeof req.query.origin === 'string' ? req.query.origin : undefined)
      );

      const { library, seatLabels } = await resolveLibraryAndSeatsForQr(
        libraryId,
        req,
        body.library,
        body.seatLabels
      );

      const { doc, filename } = await buildMasterQrPdfDocument({
        library,
        seatLabels,
        batchSize: 16,
        renderSeatPng: (seatLabel) =>
          generateSeatQrPngBytes(
            library.id,
            seatLabel,
            { size: 240, baseOrigin },
            (raw) => zlib.deflateSync(raw)
          ),
      });

      const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error('Error generating Master QR PDF:', err);
      res.status(500).json({ error: err?.message || 'Failed to generate Master QR PDF' });
    }
  };

  app.get('/api/qr/master-pdf/:libraryId', (req: Request, res: Response) => {
    void handleMasterQrPdfRequest(req, res, decodeURIComponent(req.params.libraryId || ''));
  });

  app.post('/api/qr/master-pdf', (req: Request, res: Response) => {
    const libId = String(req.body?.libraryId || req.body?.library?.id || '');
    void handleMasterQrPdfRequest(req, res, libId);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.get('*', async (req: Request, res: Response, next) => {
      try {
        const rawHtml = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).send(
          injectPublicEnvIntoHtml(transformed)
        );
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    const cachedProdHtml = fs.existsSync(indexHtmlPath)
      ? fs.readFileSync(indexHtmlPath, 'utf8')
      : '';
    app.use(express.static(distPath, { index: false }));
    app.get('*', (_req: Request, res: Response) => {
      const html = cachedProdHtml || (fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '');
      if (!html) {
        res.status(404).send('Build output not found.');
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(injectPublicEnvIntoHtml(html));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
