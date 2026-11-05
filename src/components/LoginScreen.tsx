/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ArrowRight, KeyRound, Sparkles, AlertCircle, Database, PlusCircle } from 'lucide-react';
import { MascotOwl } from './MascotOwl';
import { dataService, isSupabaseConfigured } from '../lib/supabase';
import { playSound, fireDuolingoConfetti } from '../lib/utils';
import { AuthSession } from '../types/database';

interface LoginScreenProps {
  onLoginSuccess: (session: AuthSession) => void;
  onOpenSupabaseModal: () => void;
  dataVersion: number;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onOpenSupabaseModal,
  dataVersion,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableCodes, setAvailableCodes] = useState<Array<{ code: string; role: string }>>([]);
  const [showQuickInit, setShowQuickInit] = useState(false);
  const [newAdminCode, setNewAdminCode] = useState('ADMIN-ROOT');
  const [creatingCode, setCreatingCode] = useState(false);

  // Load existing codes to assist user / detect clean blank state
  useEffect(() => {
    async function checkExistingLogins() {
      try {
        const logins = await dataService.getAllLogins();
        const active = logins.filter((l) => l.is_active);
        setAvailableCodes(active.map((l) => ({ code: l.code, role: l.role })));
      } catch (e) {
        // may be empty or not connected yet
        setAvailableCodes([]);
      }
    }
    checkExistingLogins();
  }, [dataVersion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setError('Please enter your unique access code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const record = await dataService.verifyAccessCode(cleanCode);
      if (!record) {
        playSound('pop');
        setError('Invalid or inactive access code. Please check your code or consult your library administrator.');
        setLoading(false);
        return;
      }

      // Route by role
      let library = null;
      let student = null;

      if (record.role === 'owner' && record.reference_id) {
        library = await dataService.getLibraryById(record.reference_id);
      } else if (record.role === 'student' && record.reference_id) {
        student = await dataService.getStudentById(record.reference_id);
        if (student) {
          library = await dataService.getLibraryById(student.library_id);
        }
      }

      playSound('success');
      fireDuolingoConfetti();

      onLoginSuccess({
        code: record.code,
        role: record.role,
        reference_id: record.reference_id,
        library,
        student,
      });
    } catch (err: any) {
      setError(`Verification error: ${err.message || 'Could not verify code'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCreateAdmin = async () => {
    if (!newAdminCode.trim()) return;
    setCreatingCode(true);
    try {
      await dataService.createLoginCode({
        code: newAdminCode.trim().toUpperCase(),
        role: 'admin',
        reference_id: null,
        is_active: true,
      });
      playSound('success');
      setCode(newAdminCode.trim().toUpperCase());
      setShowQuickInit(false);
      // Reload
      const logins = await dataService.getAllLogins();
      setAvailableCodes(logins.map((l) => ({ code: l.code, role: l.role })));
    } catch (err: any) {
      setError(`Failed to create code: ${err.message}`);
    } finally {
      setCreatingCode(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4.5rem)] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Mascot & Title */}
        <div className="text-center mb-8">
          <div className="relative inline-block mb-3">
            <MascotOwl mood="studying" size={128} />
          </div>

          <h1 className="font-display text-3xl sm:text-4xl font-black text-[#3c3c3c] tracking-tight">
            Study<span className="text-[#58cc02]">Lingo</span>
          </h1>
          <p className="mt-2 text-sm font-semibold text-[#777777] max-w-xs mx-auto">
            Enter your unique access code to enter your Library, Owner, or Student desk.
          </p>
        </div>

        {/* Main Card */}
        <div className="duo-card p-6 sm:p-8 bg-white">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="accessCode"
                className="block text-xs font-black uppercase tracking-wider text-[#777777] mb-2"
              >
                Access Code
              </label>
              <div className="relative">
                <input
                  id="accessCode"
                  type="text"
                  placeholder="e.g. ADMIN-99, LIB-OWNER, STU-101"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  autoFocus
                  className="w-full px-4 py-3.5 pl-11 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#58cc02] focus:ring-0 focus:outline-hidden font-display text-base font-black text-[#3c3c3c] uppercase placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 bg-white transition-colors"
                />
                <KeyRound className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3.5 rounded-2xl bg-[#ff4b4b]/10 border-2 border-[#ff4b4b]/40 text-xs font-bold text-[#d33131] flex items-start gap-2.5 animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full py-3.5 px-6 rounded-2xl text-base font-black duo-btn-green flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wide"
            >
              <span>{loading ? 'Verifying...' : 'Continue'}</span>
              <ArrowRight className="w-5 h-5 stroke-[3]" />
            </button>
          </form>

          {/* Quick Code helper chips if any exist */}
          {availableCodes.length > 0 && (
            <div className="mt-6 pt-5 border-t-2 border-[#f0f0f0]">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                  Quick Access Test Codes
                </span>
                <span className="text-[11px] font-semibold text-slate-500">
                  Click to populate
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCodes.slice(0, 5).map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setCode(item.code);
                      playSound('pop');
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      item.role === 'admin'
                        ? 'bg-[#ff9600]/15 text-[#e08500] hover:bg-[#ff9600]/25 border border-[#ff9600]/30'
                        : item.role === 'owner'
                        ? 'bg-[#1cb0f6]/15 text-[#1899d6] hover:bg-[#1cb0f6]/25 border border-[#1cb0f6]/30'
                        : 'bg-[#58cc02]/15 text-[#46a302] hover:bg-[#58cc02]/25 border border-[#58cc02]/30'
                    }`}
                  >
                    {item.code}
                    <span className="ml-1 opacity-75 font-semibold text-[10px]">({item.role})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Clean State helper if 0 codes in database */}
          {availableCodes.length === 0 && (
            <div className="mt-6 pt-5 border-t-2 border-[#f0f0f0] text-center">
              <div className="p-3.5 rounded-2xl bg-amber-50 border-2 border-amber-200 text-xs text-amber-800 text-left">
                <p className="font-bold mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Database is completely clean / blank
                </p>
                <p className="text-[11px] text-amber-700 leading-relaxed mb-3">
                  No access codes are found in your database. You can initialize a master admin code right now or load demo data from Supabase settings.
                </p>
                
                {showQuickInit ? (
                  <div className="space-y-2 mt-2">
                    <input
                      type="text"
                      value={newAdminCode}
                      onChange={(e) => setNewAdminCode(e.target.value.toUpperCase())}
                      placeholder="e.g. ADMIN-ROOT"
                      className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-amber-300 uppercase bg-white"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleQuickCreateAdmin}
                        disabled={creatingCode}
                        className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-orange cursor-pointer"
                      >
                        {creatingCode ? 'Creating...' : 'Create Admin Code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowQuickInit(false)}
                        className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowQuickInit(true)}
                      className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-orange cursor-pointer flex items-center gap-1"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Create Master Admin Code</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSupabaseModal}
                      className="px-3 py-1.5 rounded-xl text-xs font-black duo-btn-white cursor-pointer flex items-center gap-1"
                    >
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      <span>Connect Supabase</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-xs text-slate-500 font-medium">
          StudyLingo · Powered by Supabase & Duolingo Playful Aesthetics
        </div>

      </div>
    </div>
  );
};
