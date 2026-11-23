/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { ArrowRight, Building2, KeyRound, AlertCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { MascotOwl } from './MascotOwl';
import { dataService, isValidStudentPin } from '../lib/supabase';
import { playSound, fireDuolingoConfetti } from '../lib/utils';
import { AuthSession, Library } from '../types/database';

interface LoginScreenProps {
  onLoginSuccess: (session: AuthSession) => void;
  targetOwnerLibraryId?: string | null;
  onClearTargetLibrary?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  targetOwnerLibraryId,
  onClearTargetLibrary,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetLibrary, setTargetLibrary] = useState<Library | null>(null);
  const [loadingTargetLibrary, setLoadingTargetLibrary] = useState(false);

  useEffect(() => {
    const libId = (targetOwnerLibraryId || '').trim();
    if (!libId) {
      setTargetLibrary(null);
      setLoadingTargetLibrary(false);
      return;
    }
    let cancelled = false;
    setLoadingTargetLibrary(true);
    setError(null);
    void dataService
      .getLibraryById(libId)
      .then((lib) => {
        if (cancelled) return;
        setTargetLibrary(lib);
        if (!lib) {
          setError('The library linked to this Master QR code could not be found.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to load library details. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTargetLibrary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetOwnerLibraryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setError(
        targetOwnerLibraryId
          ? 'Please enter your Library Owner Access Code.'
          : 'Please enter your 4-digit Student Pin or login code.'
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const record = await dataService.verifyAccessCode(cleanCode);
      if (!record) {
        playSound('pop');
        setError(
          targetOwnerLibraryId
            ? 'Invalid or inactive Owner Access Code. Please verify your library code.'
            : 'Invalid or inactive Student Pin / login code. Please double-check or consult your library owner.'
        );
        setLoading(false);
        return;
      }

      if (targetOwnerLibraryId) {
        if (record.role !== 'owner' || record.reference_id !== targetOwnerLibraryId) {
          playSound('pop');
          setError(
            `This Master QR is dedicated to ${targetLibrary?.name || `Library ${targetOwnerLibraryId}`}. Please enter the matching Library Owner Code.`
          );
          setLoading(false);
          return;
        }
      }

      // 1. ADMIN LOGIN: Always allowed to log in successfully, regardless of library statuses
      if (record.role === 'admin') {
        playSound('success');
        fireDuolingoConfetti();
        onLoginSuccess({
          code: record.code,
          role: 'admin',
          reference_id: record.reference_id,
        });
        return;
      }

      // 2. LIBRARY OWNER LOGIN: Allowed only if their specific library's 'subscription_status' is 'active'
      if (record.role === 'owner') {
        if (!record.reference_id) {
          playSound('pop');
          setError('No library is linked to this owner account. Please contact the administrator.');
          setLoading(false);
          return;
        }

        // Query the 'libraries' table in Supabase for this specific library
        const library = targetLibrary && targetLibrary.id === record.reference_id
          ? targetLibrary
          : await dataService.getLibraryById(record.reference_id);

        if (!library) {
          playSound('pop');
          setError('Your library record could not be found. Please contact the administrator.');
          setLoading(false);
          return;
        }

        // Block if subscription_status is 'inactive' (or not 'active')
        const libraryStatus = (library.subscription_status || '').trim().toLowerCase();
        if (libraryStatus !== 'active') {
          playSound('pop');
          setError('Your library subscription is inactive or expired. Please contact the administrator.');
          setLoading(false);
          return;
        }

        playSound('success');
        fireDuolingoConfetti();
        onLoginSuccess({
          code: record.code,
          role: 'owner',
          reference_id: record.reference_id,
          library,
        });
        return;
      }

      // 3. STUDENT LOGIN: Exclusively validate strict 4-digit numeric PIN (1000-9999) + parent library status
      if (record.role === 'student') {
        if (!isValidStudentPin(cleanCode) || !isValidStudentPin(record.code)) {
          playSound('pop');
          setError('Students must sign in with a valid 4-digit numeric Student Pin (1000–9999).');
          setLoading(false);
          return;
        }

        if (!record.reference_id) {
          playSound('pop');
          setError('No student profile is linked to this Student Pin. Please contact your library owner.');
          setLoading(false);
          return;
        }

        const student = await dataService.getStudentById(record.reference_id);
        if (!student) {
          playSound('pop');
          setError('Student record could not be found. Please contact your library administrator.');
          setLoading(false);
          return;
        }

        if (student.is_active === false) {
          playSound('pop');
          setError('This student pass has been marked as exited. Please contact your library owner to re-enroll.');
          setLoading(false);
          return;
        }

        // Query the 'libraries' table for the student's parent library
        const parentLibrary = await dataService.getLibraryById(student.library_id);
        if (!parentLibrary) {
          playSound('pop');
          setError('Associated library could not be found. Please contact your library administrator.');
          setLoading(false);
          return;
        }

        // Block student only if their parent library is 'inactive' (or not 'active')
        const parentLibraryStatus = (parentLibrary.subscription_status || '').trim().toLowerCase();
        if (parentLibraryStatus !== 'active') {
          playSound('pop');
          setError('Your library subscription is inactive or expired. Please contact your library administrator.');
          setLoading(false);
          return;
        }

        // Student's parent library is active: allow login normally
        playSound('success');
        fireDuolingoConfetti();
        onLoginSuccess({
          code: record.code,
          role: 'student',
          reference_id: record.reference_id,
          library: parentLibrary,
          student,
        });
        return;
      }
    } catch (err: any) {
      setError(`Verification error: ${err.message || 'Could not verify code'}`);
    } finally {
      setLoading(false);
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
            {targetOwnerLibraryId
              ? 'Owner Desk Access · Enter your Library Owner Code to open your branch dashboard.'
              : 'Enter your 4-digit Student Pin or Admin/Owner Code to open your portal.'}
          </p>
        </div>

        {/* Main Clean & Secure Login Card */}
        <div className="duo-card p-6 sm:p-8 bg-white space-y-5">
          {targetOwnerLibraryId && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#58cc02] text-white flex items-center justify-center shrink-0 border-b-2 border-[#46a302]">
                {loadingTargetLibrary ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Building2 className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  Owner Master QR Mapped
                </span>
                <p className="font-display text-sm font-black text-[#3c3c3c] truncate">
                  {loadingTargetLibrary
                    ? 'Loading library...'
                    : targetLibrary?.name || 'Study Library'}
                </p>
                <p className="text-[11px] font-semibold text-slate-500 truncate">
                  {targetLibrary?.location ? `${targetLibrary.location} · ` : ''}
                  <span className="font-mono">{targetOwnerLibraryId}</span>
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="accessCode"
                className="block text-xs font-black uppercase tracking-wider text-[#777777] mb-2"
              >
                {targetOwnerLibraryId ? 'Owner Access Code' : 'Student Pin / Login Code'}
              </label>
              <div className="relative">
                <input
                  id="accessCode"
                  type="text"
                  placeholder={
                    targetOwnerLibraryId
                      ? 'Enter your Owner Access Code'
                      : '4-digit Student Pin (1000–9999) or Login Code'
                  }
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
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
              <span>{loading ? 'Verifying...' : targetOwnerLibraryId ? 'Open Owner Dashboard' : 'Continue'}</span>
              <ArrowRight className="w-5 h-5 stroke-[3]" />
            </button>

            {targetOwnerLibraryId && onClearTargetLibrary && (
              <button
                type="button"
                onClick={onClearTargetLibrary}
                className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Switch to standard Student / Admin login
              </button>
            )}
          </form>
        </div>

        {/* Clean Security Footer */}
        <div className="flex items-center justify-center gap-1.5 text-center mt-6 text-xs text-slate-400 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>StudyLingo Secure Access Portal</span>
        </div>

      </div>
    </div>
  );
};
