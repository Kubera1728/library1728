/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Search,
  KeyRound,
  Users,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Phone,
  MapPin,
  RefreshCw,
  Trash2,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
} from 'lucide-react';
import { Library, LoginRecord, Student } from '../types/database';
import { dataService } from '../lib/supabase';
import { calculateDaysRemaining, formatFriendlyDate, playSound, fireDuolingoConfetti } from '../lib/utils';
import { MascotOwl } from './MascotOwl';

interface AdminDashboardProps {
  adminCode: string;
  onRefresh: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ adminCode, onRefresh }) => {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [logins, setLogins] = useState<LoginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'libraries' | 'codes'>('libraries');

  // Modals
  const [showAddLibraryModal, setShowAddLibraryModal] = useState(false);
  const [showAddCodeModal, setShowAddCodeModal] = useState(false);
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null);
  const [selectedLibStudents, setSelectedLibStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // New Library Form state
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

  // New Code Form state
  const [codeForm, setCodeForm] = useState({
    code: '',
    role: 'owner' as 'admin' | 'owner' | 'student',
    reference_id: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [libs, logs] = await Promise.all([
        dataService.getAllLibraries(),
        dataService.getAllLogins(),
      ]);
      setLibraries(libs);
      setLogins(logs);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenLibraryDetails = async (lib: Library) => {
    setSelectedLibrary(lib);
    setLoadingStudents(true);
    try {
      const studs = await dataService.getStudentsByLibrary(lib.id);
      setSelectedLibStudents(studs);
    } catch (e) {
      console.error(e);
      setSelectedLibStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!libForm.name.trim() || !libForm.location.trim()) return;

    const slugId = 'lib_' + libForm.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) + '_' + Math.floor(Math.random() * 1000);
    const generatedOwnerCode = libForm.owner_code.trim().toUpperCase() || `OWNER-${libForm.name.slice(0, 4).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

    const newLib: Library = {
      id: slugId,
      name: libForm.name.trim(),
      location: libForm.location.trim(),
      total_seats: Number(libForm.total_seats) || 50,
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
      loadData();
    } catch (err: any) {
      alert(`Error creating library: ${err.message}`);
    }
  };

  const handleDeleteLibrary = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to remove "${name}" and all its students?`)) {
      try {
        await dataService.deleteLibrary(id);
        playSound('pop');
        if (selectedLibrary?.id === id) {
          setSelectedLibrary(null);
        }
        loadData();
      } catch (err: any) {
        alert(`Error deleting library: ${err.message}`);
      }
    }
  };

  const handleExtendSubscription = async (libId: string, daysToAdd: number) => {
    const lib = libraries.find((l) => l.id === libId);
    if (!lib) return;

    const currentExpiry = new Date(lib.subscription_expiry || Date.now());
    const baseDate = currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();
    baseDate.setDate(baseDate.getDate() + daysToAdd);
    const newExpiry = baseDate.toISOString().split('T')[0];

    try {
      await dataService.updateLibrary({
        id: libId,
        subscription_expiry: newExpiry,
        subscription_status: 'active',
      });
      playSound('success');
      loadData();
      if (selectedLibrary?.id === libId) {
        setSelectedLibrary({ ...selectedLibrary, subscription_expiry: newExpiry, subscription_status: 'active' });
      }
    } catch (err: any) {
      alert(`Error extending subscription: ${err.message}`);
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeForm.code.trim()) return;

    try {
      await dataService.createLoginCode({
        code: codeForm.code.trim().toUpperCase(),
        role: codeForm.role,
        reference_id: codeForm.reference_id.trim() || null,
        is_active: true,
      });
      playSound('success');
      setShowAddCodeModal(false);
      setCodeForm({ code: '', role: 'owner', reference_id: '' });
      loadData();
    } catch (err: any) {
      alert(`Error creating code: ${err.message}`);
    }
  };

  const handleToggleCode = async (code: string, currentActive: boolean) => {
    try {
      await dataService.toggleLoginCodeStatus(code, !currentActive);
      playSound('pop');
      loadData();
    } catch (err: any) {
      alert(`Error updating code: ${err.message}`);
    }
  };

  const handleDeleteCode = async (code: string) => {
    if (confirm(`Delete access code "${code}"?`)) {
      try {
        await dataService.deleteLoginCode(code);
        playSound('pop');
        loadData();
      } catch (err: any) {
        alert(`Error deleting code: ${err.message}`);
      }
    }
  };

  // Filtered Libraries
  const filteredLibraries = libraries.filter(
    (l) =>
      l.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.owner_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Statistics
  const totalSeats = libraries.reduce((acc, l) => acc + (l.total_seats || 0), 0);
  const activeSubs = libraries.filter((l) => calculateDaysRemaining(l.subscription_expiry) > 0).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 sm:p-8 duo-card">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#ff9600] text-white flex items-center justify-center border-b-4 border-[#e08500] font-black text-2xl shadow-xs">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl sm:text-3xl font-black text-[#3c3c3c]">
                Admin Command Center
              </h1>
              <span className="text-xs font-black px-2.5 py-0.5 rounded-lg bg-[#ff9600]/15 text-[#e08500] border border-[#ff9600]/30">
                MASTER
              </span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">
              Oversee all registered libraries, manage owner access codes, and monitor subscriptions.
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
            title="Refresh database"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowAddLibraryModal(true)}
            className="px-5 py-2.5 rounded-2xl text-xs font-black duo-btn-green flex items-center gap-1.5 cursor-pointer uppercase tracking-wider"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Library</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Libraries */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Registered Libraries
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              {libraries.length}
            </div>
            <span className="text-xs font-bold text-[#58cc02] mt-0.5 inline-block">
              {activeSubs} with active license
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#58cc02]/15 text-[#58cc02] flex items-center justify-center border-2 border-[#58cc02]/30">
            <Building2 className="w-6 h-6" />
          </div>
        </div>

        {/* Total Seats Capacity */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Network Seat Capacity
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              {totalSeats}
            </div>
            <span className="text-xs font-bold text-slate-500 mt-0.5 inline-block">
              Across all library branches
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#1cb0f6]/15 text-[#1cb0f6] flex items-center justify-center border-2 border-[#1cb0f6]/30">
            <Users className="w-6 h-6" />
          </div>
        </div>

        {/* Access Codes Total */}
        <div className="bg-white p-5 duo-card flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Active Access Codes
            </span>
            <div className="font-display text-3xl font-black text-[#3c3c3c] mt-1 tabular-nums">
              {logins.filter((l) => l.is_active).length}
            </div>
            <span className="text-xs font-bold text-[#ff9600] mt-0.5 inline-block">
              Admins, Owners & Students
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#ff9600]/15 text-[#ff9600] flex items-center justify-center border-2 border-[#ff9600]/30">
            <KeyRound className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-[#e5e5e5]/50 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('libraries')}
          className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'libraries'
              ? 'bg-white text-[#3c3c3c] shadow-xs border-b-2 border-slate-300'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Libraries Directory ({libraries.length})
        </button>

        <button
          onClick={() => setActiveTab('codes')}
          className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
            activeTab === 'codes'
              ? 'bg-white text-[#3c3c3c] shadow-xs border-b-2 border-slate-300'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All Access Codes ({logins.length})
        </button>
      </div>

      {/* TAB 1: Registered Libraries */}
      {activeTab === 'libraries' && (
        <div className="space-y-4">
          
          {/* Search bar */}
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search libraries by name, location, or owner..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
            />
          </div>

          {/* Clean State when 0 Libraries */}
          {libraries.length === 0 && !loading && (
            <div className="bg-white p-12 text-center duo-card">
              <MascotOwl mood="happy" size={96} className="mx-auto mb-4" />
              <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                No Libraries Registered Yet
              </h3>
              <p className="text-xs font-medium text-slate-500 max-w-sm mx-auto mt-1 mb-6">
                Your database is clean. Click below to add your first study library and generate an owner access code.
              </p>
              <button
                onClick={() => setShowAddLibraryModal(true)}
                className="px-6 py-3 rounded-2xl text-xs font-black duo-btn-green inline-flex items-center gap-2 cursor-pointer uppercase"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Add First Library</span>
              </button>
            </div>
          )}

          {/* Library Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredLibraries.map((lib) => {
              const daysLeft = calculateDaysRemaining(lib.subscription_expiry);
              const isExpired = daysLeft < 0;
              const isExpiringSoon = daysLeft >= 0 && daysLeft <= 5;

              return (
                <div
                  key={lib.id}
                  className="bg-white p-6 duo-card hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-display text-lg font-black text-[#3c3c3c]">
                          {lib.name}
                        </h3>
                        <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{lib.location}</span>
                        </p>
                      </div>

                      <span
                        className={`text-[11px] font-black px-2.5 py-1 rounded-xl shrink-0 ${
                          isExpired
                            ? 'bg-red-100 text-red-700 border border-red-200'
                            : isExpiringSoon
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-[#58cc02]/15 text-[#46a302] border border-[#58cc02]/30'
                        }`}
                      >
                        {isExpired ? 'Expired' : isExpiringSoon ? `${daysLeft}d Left` : 'Active'}
                      </span>
                    </div>

                    {/* Details list */}
                    <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs text-slate-600 font-medium">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Total Seats:</span>
                        <span className="font-bold text-[#3c3c3c] tabular-nums">{lib.total_seats} Seats</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Owner:</span>
                        <span className="font-bold text-[#3c3c3c]">{lib.owner_name}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Phone:</span>
                        <span className="font-mono text-[11px]">{lib.contact_phone}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">License Expiry:</span>
                        <span className="font-bold tabular-nums">{formatFriendlyDate(lib.subscription_expiry)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-4 border-t-2 border-[#f0f0f0] flex items-center gap-2">
                    <button
                      onClick={() => handleOpenLibraryDetails(lib)}
                      className="flex-1 py-2 px-3 rounded-xl text-xs font-black duo-btn-blue text-center cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>Manage & Students</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleExtendSubscription(lib.id, 30)}
                      title="Extend +30 Days"
                      className="py-2 px-3 rounded-xl text-xs font-black duo-btn-green cursor-pointer"
                    >
                      +30d
                    </button>

                    <button
                      onClick={() => handleDeleteLibrary(lib.id, lib.name)}
                      title="Delete library"
                      className="p-2 rounded-xl text-xs font-black duo-btn-white text-red-500 hover:text-red-700 cursor-pointer"
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

      {/* TAB 2: All Access Codes Directory */}
      {activeTab === 'codes' && (
        <div className="bg-white duo-card p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-black text-[#3c3c3c]">
                Unified Access Codes (`all_logins`)
              </h2>
              <p className="text-xs font-semibold text-slate-500">
                Inspect and generate access codes for Admins, Owners, and Students.
              </p>
            </div>

            <button
              onClick={() => setShowAddCodeModal(true)}
              className="px-4 py-2 rounded-xl text-xs font-black duo-btn-green flex items-center gap-1.5 cursor-pointer uppercase"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Generate New Code</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-slate-100 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Reference ID</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logins.map((item) => (
                  <tr key={item.code} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 font-display font-black text-sm text-[#3c3c3c]">
                      {item.code}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center text-[10px] font-black uppercase px-2 py-0.5 rounded-lg ${
                          item.role === 'admin'
                            ? 'bg-[#ff9600]/15 text-[#e08500] border border-[#ff9600]/30'
                            : item.role === 'owner'
                            ? 'bg-[#1cb0f6]/15 text-[#1899d6] border border-[#1cb0f6]/30'
                            : 'bg-[#58cc02]/15 text-[#46a302] border border-[#58cc02]/30'
                        }`}
                      >
                        {item.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                      {item.reference_id || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleCode(item.code, item.is_active)}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-all ${
                          item.is_active
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {item.is_active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDeleteCode(item.code)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                        title="Delete code"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: Add New Library */}
      {showAddLibraryModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-lg w-full p-6 sm:p-8 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                Register New Library
              </h3>
              <button
                onClick={() => setShowAddLibraryModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateLibrary} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Library Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vidya Study Hub"
                  value={libForm.name}
                  onChange={(e) => setLibForm({ ...libForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Location / Address *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sector 14, Near Metro Station"
                  value={libForm.location}
                  onChange={(e) => setLibForm({ ...libForm, location: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
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
                    value={libForm.total_seats}
                    onChange={(e) => setLibForm({ ...libForm, total_seats: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    License Expiry Date
                  </label>
                  <input
                    type="date"
                    value={libForm.subscription_expiry}
                    onChange={(e) => setLibForm({ ...libForm, subscription_expiry: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Owner / Manager Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={libForm.owner_name}
                    onChange={(e) => setLibForm({ ...libForm, owner_name: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                    Contact Phone (WhatsApp)
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 919876543210"
                    value={libForm.contact_phone}
                    onChange={(e) => setLibForm({ ...libForm, contact_phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Owner Access Code (Auto-generated if blank)
                </label>
                <input
                  type="text"
                  placeholder="e.g. OWNER-VIDYA"
                  value={libForm.owner_code}
                  onChange={(e) => setLibForm({ ...libForm, owner_code: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddLibraryModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase"
                >
                  Save & Issue Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Library Details & Students inspector */}
      {selectedLibrary && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-3xl w-full p-6 sm:p-8 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <div>
                <h3 className="font-display text-2xl font-black text-[#3c3c3c]">
                  {selectedLibrary.name}
                </h3>
                <p className="text-xs font-semibold text-slate-500">
                  {selectedLibrary.location} · {selectedLibrary.total_seats} Total Seats
                </p>
              </div>
              <button
                onClick={() => setSelectedLibrary(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Quick Extension & Subscription Bar */}
            <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <span className="text-slate-400 font-bold uppercase text-[10px]">
                  Subscription Expiry:
                </span>
                <p className="font-bold text-[#3c3c3c] text-sm tabular-nums">
                  {formatFriendlyDate(selectedLibrary.subscription_expiry)} (
                  {calculateDaysRemaining(selectedLibrary.subscription_expiry)} days left)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExtendSubscription(selectedLibrary.id, 30)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-green cursor-pointer"
                >
                  +30 Days
                </button>
                <button
                  onClick={() => handleExtendSubscription(selectedLibrary.id, 90)}
                  className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-blue cursor-pointer"
                >
                  +90 Days
                </button>
              </div>
            </div>

            {/* Enrolled Students list */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-base font-black text-[#3c3c3c]">
                  Enrolled Students ({selectedLibStudents.length})
                </h4>
                <span className="text-xs font-bold text-slate-500">
                  Seat Occupancy: {selectedLibStudents.length} / {selectedLibrary.total_seats}
                </span>
              </div>

              {loadingStudents ? (
                <div className="py-8 text-center text-xs font-bold text-slate-400">
                  Loading students...
                </div>
              ) : selectedLibStudents.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-xs font-bold text-slate-500">
                  No students assigned to this library yet. The owner can add students from their Owner Dashboard.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border-2 border-slate-100 rounded-2xl">
                  {selectedLibStudents.map((st) => (
                    <div key={st.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-[#3c3c3c]">{st.name}</span>
                          <span className="px-2 py-0.5 rounded-md bg-[#58cc02]/15 text-[#46a302] font-black text-[10px]">
                            Seat #{st.seat_number}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {st.shift} · Phone: {st.phone}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[11px] font-bold text-slate-600 block">
                          Valid till {formatFriendlyDate(st.subscription_end)}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {calculateDaysRemaining(st.subscription_end)}d remaining
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t-2 border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedLibrary(null)}
                className="px-5 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Generate Custom Code */}
      {showAddCodeModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-md w-full p-6 sm:p-8 duo-card shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b-2 border-slate-100">
              <h3 className="font-display text-xl font-black text-[#3c3c3c]">
                Generate Access Code
              </h3>
              <button
                onClick={() => setShowAddCodeModal(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCode} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Unique Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. OWNER-VIDYA, ADMIN-02, STU-KABIR"
                  value={codeForm.code}
                  onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold uppercase font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Target Role *
                </label>
                <select
                  value={codeForm.role}
                  onChange={(e) => setCodeForm({ ...codeForm, role: e.target.value as any })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold bg-white"
                >
                  <option value="owner">Library Owner</option>
                  <option value="admin">Administrator</option>
                  <option value="student">Student</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 mb-1">
                  Reference ID (Optional - Library ID or Student ID)
                </label>
                <input
                  type="text"
                  placeholder="e.g. lib_vidya"
                  value={codeForm.reference_id}
                  onChange={(e) => setCodeForm({ ...codeForm, reference_id: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:outline-hidden text-xs font-bold font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddCodeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-black duo-btn-green cursor-pointer uppercase"
                >
                  Save Code
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
