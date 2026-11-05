/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'admin' | 'owner' | 'student';

export interface LoginRecord {
  id?: string;
  code: string;
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
  subscription_status: 'active' | 'expiring_soon' | 'expired';
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
  created_at?: string;
  notes?: string;
}

export interface AuthSession {
  code: string;
  role: UserRole;
  reference_id: string | null;
  library?: Library | null;
  student?: Student | null;
}
