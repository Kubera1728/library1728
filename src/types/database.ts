/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'owner' | 'student';

export interface LoginRecord {
  id?: string;
  code: string;
  student_pin?: string;
  role: UserRole;
  reference_id: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface Library {
  id: string;
  name: string;
  location: string;
  total_seats: number;
  owner_name: string;
  contact_phone: string;
  subscription_status: 'active' | 'inactive' | 'expiring_soon' | 'expired' | string;
  subscription_expiry: string; // YYYY-MM-DD
  created_at?: string;
}

export interface Student {
  id: string;
  library_id: string;
  name: string;
  phone: string;
  seat_number: string;
  shift: string;
  subscription_start: string; // YYYY-MM-DD
  subscription_end: string;   // YYYY-MM-DD
  is_active: boolean;
  student_pin?: string;
  notes?: string;
  created_at?: string;
}

export interface Shift {
  id: string;
  library_id: string;
  name: string;
  timing: string;
  fee: number;
  is_active?: boolean;
  created_at?: string;
}

export interface BroadcastRequest {
  id: string;
  library_id: string;
  library_name: string;
  message: string;
  status: 'pending' | 'sent' | 'archived';
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  library_id: string;
  student_id: string;
  student_name: string;
  seat_number: string;
  shift: string;
  date: string; // YYYY-MM-DD
  check_in_time: string | null; // ISO timestamp (null when absent)
  check_out_time: string | null;
  duration_minutes: number | null;
  status: 'checked_in' | 'checked_out' | 'absent';
  qr_payload: string;
  created_at?: string;
}

export interface AuthSession {
  code: string;
  role: UserRole;
  reference_id: string | null;
  library?: Library | null;
  student?: Student | null;
}

export interface SeatQrReference {
  id: string;
  library_id: string;
  seat_label: string;
  badge_number: string;
  qr_payload: string;
  error_correction: 'H';
  qr_image_url: string;
  updated_at?: string;
}

export interface FeePayment {
  id: string;
  library_id: string;
  student_id: string;
  month_key: string; // YYYY-MM
  amount: number;
  status: 'paid' | 'due';
  payment_date: string | null; // YYYY-MM-DD
  created_at?: string;
  updated_at?: string;
}
