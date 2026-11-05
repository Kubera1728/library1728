/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  RefreshCw,
  Phone,
  Trash2,
  KeyRound,
  Grid3X3,
  List,
  Pencil,
} from 'lucide-react';
import { Library, Student } from '../types/database';
import { dataService } from '../lib/supabase';
import {
  calculateDaysRemaining,
  formatFriendlyDate,
  generateWhatsAppReminderUrl,
  isExpiringIn2DaysOrToday,
  playSound,
  fireDuolingoConfetti,
} from '../lib/utils';
import { MascotOwl } from './MascotOwl';

interface OwnerDashboardProps {
  ownerCode: string;
  libraryId: string;
}

const SHIFT_OPTIONS = [
  'Morning (7:00 AM - 1:00 PM)',
  'Evening (1:00 PM - 7:00 PM)',
  'Night (7:00 PM - 7:00 AM)',
  'Full Day (24 Hours)',
];

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({ ownerCode, libraryId }) => {
  const [library, setLibrary] = useState<Library | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'seatmap'>('list');

  // Add Student Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);

  // Form State
  const [studentForm, setStudentForm] = useState({
    name: '',
    phone: '',
    seat_number: '',
    shift: SHIFT_OPTIONS[0],
    subscription_start: new Date().toISOString().split('T')[0],
    subscription_end: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    student_code: '',
    notes: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [lib, studs] = await Promise.all([
        dataService.getLibraryById(libraryId),
        dataService.getStudentsByLibrary(libraryId),
      ]);
      setLibrary(lib);
      setStudents(studs);
    } catch (e) {
      console.error('Error loading library data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [libraryId]);

  // Expiring list (expiring today or within 2 days, or already expired)
  const expiringStudents = students.filter((s) => isExpiringIn2DaysOrToday(s.subscription_end));

  // Filtered students for table / list
  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.seat_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.phone.includes(searchQuery);

    const matchesShift = shiftFilter === 'all' || s.shift.includes(shiftFilter);
    return matchesSearch && matchesShift;
  });

  const handleOpenAddModal = (presetSeat?: string) => {
    setEditingStudent(null);
    setStudentForm({
      name: '',
      phone: '',
      seat_number: presetSeat || '',
      shift: SHIFT_OPTIONS[0],
      subscription_start: new Date().toISOString().split('T')[0],
      subscription_end: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      student_code: '',
      notes: '',
    });
    setShowAddModal(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentForm.name.trim() || !studentForm.seat_number.trim() || !studentForm.phone.trim()) {
      return;
    }

    const cleanSeat = studentForm.seat_number.trim().toUpperCase();
    const cleanPhone = studentForm.phone.trim().replace(/[^0-9]/g, '');

    if (editingStudent) {
      // Update
      try {
        await dataService.updateStudent({
          id: editingStudent.id,
          name: studentForm.name.trim(),
          phone: cleanPhone,
          seat_number: cleanSeat,
          shift: studentForm.shift,
          subscription_start: studentForm.subscription_start,
          subscription_end: studentForm.subscription_end,
          notes: studentForm.notes,
        });
        playSound('success');
        setShowAddModal(false);
        loadData();
      } catch (err: any) {
        alert(`Error updating student: ${err.message}`);
      }
    } else {
      // Create new
      const studentId = 'stu_' + Math.random().toString(36).substring(2, 9);
      const generatedCode =
        studentForm.student_code.trim().toUpperCase() ||
        `STU-${studentForm.name.slice(0, 3).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

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
        notes: studentForm.notes,
      };

      try {
        await dataService.createStudent(newStudent, generatedCode);
        playSound('success');
        fireDuolingoConfetti();
        setShowAddModal(false);
        loadData();
      } catch (err: any) {
        alert(`Error adding student: ${err.message}`);
      }
    }
  };

  const handleDeleteStudent = async (id: string, name: string) => {
    if (confirm(`Remove student "${name}" and free up the seat?`)) {
      try {
        await dataService.deleteStudent(id);
        playSound('pop');
        loadData();
      } catch (err: any) {
        alert(`Error removing student: ${err.message}`);
      }
    }
  };

  const handleExtendStudent = async (studentId: string, daysToAdd: number = 30) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;

    const currentExpiry = new Date(student.subscription_end || Date.now());
    const baseDate = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    baseDate.setDate(baseDate.getDate() + daysToAdd);
    const newEnd = baseDate.toISOString().split('T')[0];

    try {
      await dataService.updateStudent({
        id: studentId,
        subscription_end: newEnd,
      });
      playSound('success');
      loadData();
    } catch (err: any) {
      alert(`Error extending subscription: ${err.message}`);
    }
  };

  const handleEditClick = (student: Student) => {
    setEditingStudent(student);
    setStudentForm({
      name: student.name,
      phone: student.phone,
      seat_number: student.seat_number,
      shift: student.shift,
      subscription_start: student.subscription_start,
      subscription_end: student.subscription_end,
      student_code: '',
      notes: student.notes || '',
    });
    setShowAddModal(true);
  };

  // Stats calculation
  const totalSeats = library?.total_seats || 50;
  const occupiedSeats = students.length;
  const availableSeats = Math.max(0, totalSeats - occupiedSeats);
  const occupancyPercent = Math.min(100, Math.round((occupiedSeats / totalSeats) * 100));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Top Banner */}
      <div className="bg-white p-6 sm:p-8 duo-card flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#1cb0f6] text-white flex items-center justify-center border-b-4 border-[#1899d6] font-black text-2xl shadow-xs">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c]">
                {library?.name || 'Library Owner Dashboard'}
              </h1>
              <span className="text-xs font-black px-2.5 py-0.5 rounded-lg bg-[#1cb0f6]/15 text-[#1899d6] border border-[#1cb0f6]/30">
                OWNER
              </span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">
              {library?.location || 'Branch'} · Owner Code: <span className="font-mono font-bold text-slate-700">{ownerCode}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              loadData();
              playSound('pop');
            }}
            className="px-3.5 py-2.5 rounded-2xl text-xs font-black duo-btn-white flex items-center gap-1.5 cursor-pointer"
            title="Refresh students"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => handleOpenAddModal()}
            className="px-5 py-2.5 rounded-2xl text-xs font-black duo-btn-green flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Assign New Seat</span>
          </button>
        </div>
      </div>

      {/* Real-time KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Total Seats */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Seat Capacity
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              {occupiedSeats} <span className="text-lg font-bold text-slate-400">/ {totalSeats}</span>
            </div>
            <span className="text-xs font-bold text-[#1cb0f6] mt-0.5 inline-block">
              {availableSeats} seats currently free ({occupancyPercent}% full)
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#1cb0f6]/15 text-[#1cb0f6] flex items-center justify-center border-2 border-[#1cb0f6]/30">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        {/* Active Shifts */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Active Shifts
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              4
            </div>
            <span className="text-xs font-bold text-slate-500 mt-0.5 inline-block">
              Morning, Evening, Night, 24h
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#ce82ff]/15 text-[#ce82ff] flex items-center justify-center border-2 border-[#ce82ff]/30">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Total Enrolled Students */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Total Students
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              {students.length}
            </div>
            <span className="text-xs font-bold text-[#58cc02] mt-0.5 inline-block">
              Assigned & active members
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#58cc02]/15 text-[#58cc02] flex items-center justify-center border-2 border-[#58cc02]/30">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Expiring Subscriptions (Next 2 Days or Today) */}
        <div className={`p-5 duo-card flex items-center justify-between ${
          expiringStudents.length > 0 ? 'bg-amber-50/70 border-amber-300' : 'bg-white'
        }`}>
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-amber-700">
              Expiring in ≤ 2 Days
            </span>
            <div className="font-display text-3xl font-black text-amber-800 mt-1 tabular-nums">
              {expiringStudents.length}
            </div>
            <span className="text-xs font-bold text-amber-700 mt-0.5 inline-block">
              {expiringStudents.length > 0 ? 'Action required: Send WhatsApp' : 'All subscriptions healthy'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-200 text-amber-800 flex items-center justify-center border-2 border-amber-300">
            <AlertCircle className="w-6 h-6" />
          </div>
        </div>

      </div>

      {/* HIGH PRIORITY: Expiring Subscriptions & WhatsApp Reminder Station */}
      {expiringStudents.length > 0 && (
        <div className="bg-amber-50/80 border-3 border-amber-300 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#ff9600] text-white flex items-center justify-center border-b-3 border-[#e08500] font-black text-xl">
                <MessageCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-display text-xl font-black text-amber-950">
                  Expiring Subscriptions Alert ({expiringStudents.length})
                </h2>
                <p className="text-xs font-bold text-amber-800">
                  Subscriptions expiring today or within 48 hours. Tap the WhatsApp button to send an instant polite reminder without Meta API fees!
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {expiringStudents.map((st) => {
              const daysLeft = calculateDaysRemaining(st.subscription_end);
              const waUrl = generateWhatsAppReminderUrl(
                st.phone,
                st.name,
                library?.name || 'Library',
                st.seat_number,
                st.subscription_end,
                daysLeft
              );

              return (
                <div
                  key={st.id}
                  className="bg-white p-4.5 rounded-2xl border-2 border-amber-200 shadow-xs flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-display font-black text-base text-[#3c3c3c]">
                          {st.name}
                        </h4>
                        <span className="text-xs font-extrabold text-[#1899d6]">
                          Seat #{st.seat_number} · {st.shift.split(' ')[0]}
                        </span>
                      </div>
                      <span className="text-[11px] font-black px-2 py-0.5 rounded-lg bg-red-100 text-red-700 border border-red-200 shrink-0">
                        {daysLeft === 0 ? 'Expires Today!' : daysLeft === 1 ? '1 Day Left' : `${daysLeft} Days Left`}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-slate-500 mt-2">
                      Valid till {formatFriendlyDate(st.subscription_end)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    {/* Instant WhatsApp Reminder button */}
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 px-3 rounded-xl text-xs font-black duo-btn-green flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4 fill-white" />
                      <span>WhatsApp Reminder</span>
                    </a>

                    <button
                      onClick={() => handleExtendStudent(st.id, 30)}
                      title="Quick Renew +30 Days"
                      className="py-2 px-3 rounded-xl text-xs font-black duo-btn-blue cursor-pointer"
                    >
                      +30d
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Student Directory & Seat Grid */}
      <div className="bg-white duo-card p-6 sm:p-8 space-y-6">
        
        {/* Controls Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs font-black rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'list'
                    ? 'bg-white text-[#3c3c3c] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Roster List</span>
              </button>
              <button
                onClick={() => setViewMode('seatmap')}
                className={`px-3 py-1.5 text-xs font-black rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'seatmap'
                    ? 'bg-white text-[#3c3c3c] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                <span>Seat Layout Map</span>
              </button>
            </div>

            {/* Shift Filter */}
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-[#e5e5e5] text-xs font-bold text-slate-700 bg-white cursor-pointer focus:outline-hidden"
            >
              <option value="all">All Shifts</option>
              <option value="Morning">Morning Shift</option>
              <option value="Evening">Evening Shift</option>
              <option value="Night">Night Shift</option>
              <option value="Full Day">Full Day Shift</option>
            </select>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by student, seat, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden text-xs font-bold bg-white"
            />
          </div>
        </div>

        {/* Clean State if 0 students */}
        {students.length === 0 && !loading && (
          <div className="py-12 text-center">
            <MascotOwl mood="studying" size={96} className="mx-auto mb-4" />
            <h3 className="font-display text-xl font-black text-[#3c3c3c]">
              No Students Enrolled Yet
            </h3>
            <p className="text-xs font-medium text-slate-500 max-w-sm mx-auto mt-1 mb-6">
              Your library is brand new and ready! Click below to assign the very first desk seat.
            </p>
            <button
              onClick={() => handleOpenAddModal()}
              className="px-6 py-3 rounded-2xl text-xs font-black duo-btn-green inline-flex items-center gap-2 cursor-pointer uppercase tracking-wider"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Assign First Seat</span>
            </button>
          </div>
        )}

        {/* VIEW 1: Roster List Table */}
        {viewMode === 'list' && students.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Seat</th>
                  <th className="py-3 px-4">Student Name</th>
                  <th className="py-3 px-4">Shift Details</th>
                  <th className="py-3 px-4">WhatsApp Phone</th>
                  <th className="py-3 px-4">Subscription Period</th>
                  <th className="py-3 px-4 text-center">Days Left</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.map((st) => {
                  const daysLeft = calculateDaysRemaining(st.subscription_end);
                  const isExpiring = daysLeft >= 0 && daysLeft <= 2;
                  const isExp = daysLeft < 0;
                  const waUrl = generateWhatsAppReminderUrl(
                    st.phone,
                    st.name,
                    library?.name || 'Library',
                    st.seat_number,
                    st.subscription_end,
                    daysLeft
                  );

                  return (
                    <tr key={st.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 px-4">
                        <span className="font-display font-black text-sm px-2.5 py-1 rounded-xl bg-[#1cb0f6]/15 text-[#1899d6] border border-[#1cb0f6]/30">
                          {st.seat_number}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-display font-black text-sm text-[#3c3c3c]">
                        {st.name}
                        {st.notes && (
                          <span className="block text-[11px] font-normal text-slate-400 mt-0.5">
                            {st.notes}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-semibold text-slate-600">
                        {st.shift}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-medium text-slate-600">
                        {st.phone}
                      </td>

                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="font-semibold block tabular-nums">
                          {formatFriendlyDate(st.subscription_start)} → {formatFriendlyDate(st.subscription_end)}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full font-black text-[11px] tabular-nums ${
                            isExp
                              ? 'bg-red-100 text-red-700'
                              : isExpiring
                              ? 'bg-amber-100 text-amber-800 animate-pulse'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isExp ? 'Expired' : `${daysLeft}d left`}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* WhatsApp button */}
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-xl duo-btn-green flex items-center justify-center cursor-pointer"
                            title="Send WhatsApp Reminder"
                          >
                            <MessageCircle className="w-3.5 h-3.5 fill-white" />
                          </a>

                          {/* Quick +30 Days Extend */}
                          <button
                            onClick={() => handleExtendStudent(st.id, 30)}
                            className="px-2 py-1 rounded-xl text-[10px] font-black duo-btn-blue cursor-pointer"
                            title="Extend +30 Days"
                          >
                            +30d
                          </button>

                          {/* Edit */}
                          <button
                            onClick={() => handleEditClick(st)}
                            className="p-1.5 rounded-xl duo-btn-white text-slate-500 hover:text-slate-800 cursor-pointer"
                            title="Edit student"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteStudent(st.id, st.name)}
                            className="p-1.5 rounded-xl duo-btn-white text-red-500 hover:text-red-700 cursor-pointer"
                            title="Remove student"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* VIEW 2: Interactive Seat Map Grid */}
        {viewMode === 'seatmap' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold text-slate-500 pb-2 border-b border-slate-100">
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-md bg-[#58cc02] inline-block"></span>
                <span>Available</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-md bg-[#1cb0f6] inline-block"></span>
                <span>Occupied</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-md bg-[#ff9600] inline-block"></span>
                <span>Expiring Soon (≤ 2d)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 rounded-md bg-[#ff4b4b] inline-block"></span>
                <span>Expired</span>
              </span>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
              {Array.from({ length: totalSeats }, (_, i) => {
                const seatLabel = `A-${i + 1}`;
                const student = students.find((s) => s.seat_number.toUpperCase() === seatLabel || s.seat_number === String(i + 1));
                const daysLeft = student ? calculateDaysRemaining(student.subscription_end) : null;
                const isExp = daysLeft !== null && daysLeft < 0;
                const isExpiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 2;

                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (student) {
                        handleEditClick(student);
                      } else {
                        handleOpenAddModal(seatLabel);
                      }
                    }}
                    className={`p-3 rounded-2xl border-2 transition-all cursor-pointer text-center relative group flex flex-col justify-between aspect-square ${
                      !student
                        ? 'bg-emerald-50/50 border-[#58cc02]/40 hover:bg-[#58cc02]/20'
                        : isExp
                        ? 'bg-red-50 border-red-300 hover:bg-red-100'
                        : isExpiring
                        ? 'bg-amber-50 border-amber-300 hover:bg-amber-100'
                        : 'bg-blue-50 border-blue-300 hover:bg-blue-100'
                    }`}
                  >
                    <span className="font-display font-black text-xs text-[#3c3c3c]">
                      {seatLabel}
                    </span>

                    {student ? (
                      <div>
                        <span className="text-[10px] font-bold text-slate-700 block truncate">
                          {student.name.split(' ')[0]}
                        </span>
                        <span
                          className={`text-[9px] font-black uppercase px-1 rounded-sm ${
                            isExp ? 'text-red-700' : isExpiring ? 'text-amber-800' : 'text-blue-700'
                          }`}
                        >
                          {isExp ? 'EXP' : `${daysLeft}d`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] font-extrabold text-[#58cc02]">
                        FREE
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* MODAL: Add / Edit Student */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-lg w-full p-6 sm:p-8 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                {editingStudent ? 'Edit Student Details' : 'Assign Seat to New Student'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Student Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Arjun Mehta"
                  value={studentForm.name}
                  onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    WhatsApp Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 919876543210"
                    value={studentForm.phone}
                    onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Assigned Seat Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. A-12, B-04"
                    value={studentForm.seat_number}
                    onChange={(e) => setStudentForm({ ...studentForm, seat_number: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Assigned Shift *
                </label>
                <select
                  value={studentForm.shift}
                  onChange={(e) => setStudentForm({ ...studentForm, shift: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                >
                  {SHIFT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Subscription Start Date
                  </label>
                  <input
                    type="date"
                    value={studentForm.subscription_start}
                    onChange={(e) => setStudentForm({ ...studentForm, subscription_start: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Subscription End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={studentForm.subscription_end}
                    onChange={(e) => setStudentForm({ ...studentForm, subscription_end: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>
              </div>

              {!editingStudent && (
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Student Login Access Code (Auto-generated if left blank)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. STU-ARJUN"
                    value={studentForm.student_code}
                    onChange={(e) => setStudentForm({ ...studentForm, student_code: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Notes / Competitive Exam
                </label>
                <input
                  type="text"
                  placeholder="e.g. UPSC Aspirant, CA Prep, Medical"
                  value={studentForm.notes}
                  onChange={(e) => setStudentForm({ ...studentForm, notes: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase"
                >
                  {editingStudent ? 'Save Changes' : 'Confirm & Issue Seat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
