/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { X, Check, Copy, AlertCircle, Database, Sparkles, Trash2, ArrowRight } from 'lucide-react';
import {
  getStoredSupabaseConfig,
  getSupabaseConfigSource,
  saveStoredSupabaseConfig,
  testSupabaseConnection,
  SQL_SETUP_SCRIPT,
  dataService,
  isSupabaseConfigured,
} from '../lib/supabase';
import { playSound } from '../lib/utils';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({
  isOpen,
  onClose,
  onDataChanged,
}) => {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    tableStatus?: Record<string, boolean>;
  } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const config = getStoredSupabaseConfig();
      setUrl(config.url);
      setAnonKey(config.anonKey);
      setTestResult(null);
      setStatusMessage(null);
      setConfirmReset(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    saveStoredSupabaseConfig({ url, anonKey });
    playSound('pop');
    setStatusMessage('Settings saved successfully!');
    if (onDataChanged) onDataChanged();
  };

  const handleTest = async () => {
    saveStoredSupabaseConfig({ url, anonKey });
    setTesting(true);
    setTestResult(null);
    setStatusMessage(null);

    const res = await testSupabaseConnection();
    setTesting(false);
    setTestResult(res);
    if (res.success) {
      playSound('success');
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_SETUP_SCRIPT);
    setCopiedSql(true);
    playSound('pop');
    setTimeout(() => setCopiedSql(false), 2500);
  };

  const handleSeedStarter = async () => {
    setSeeding(true);
    try {
      const res = await dataService.seedStarterData();
      setStatusMessage(res.message);
      if (res.success) {
        playSound('success');
        if (onDataChanged) onDataChanged();
      }
    } catch (e: any) {
      setStatusMessage(`Error: ${e.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      playSound('pop');
      return;
    }
    setClearing(true);
    try {
      await dataService.clearAllData();
      playSound('pop');
      setConfirmReset(false);
      setStatusMessage('All data cleared successfully! Database is completely clean.');
      if (onDataChanged) onDataChanged();
    } catch (e: any) {
      setStatusMessage(`Error clearing: ${e.message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative bg-white border-3 border-[#e5e5e5] rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-[#f0f0f0]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#58cc02] text-white flex items-center justify-center border-b-3 border-[#46a302] font-black text-xl shadow-xs">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-[#3c3c3c]">Supabase Dynamic Connection</h2>
              <p className="text-xs font-semibold text-slate-500">
                Connect your real Supabase project or use local storage
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connection Source Indicator */}
        {(() => {
          const source = getSupabaseConfigSource();
          if (source === 'env') {
            return (
              <div className="mt-4 p-3 rounded-2xl bg-[#58cc02]/10 border-2 border-[#58cc02]/30 text-xs font-bold text-[#2c6800] flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0 text-[#58cc02]" />
                <span>
                  Connected via Environment Variables — synced across Preview &amp; Deployed Live URLs.
                </span>
              </div>
            );
          }
          if (source === 'local') {
            return (
              <div className="mt-4 p-3 rounded-2xl bg-amber-50 border-2 border-amber-300 text-xs font-semibold text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  Saved in this browser only. To sync across Preview &amp; Deployed URLs automatically, set{' '}
                  <code className="font-mono font-bold">VITE_SUPABASE_URL</code> and{' '}
                  <code className="font-mono font-bold">VITE_SUPABASE_ANON_KEY</code> in your deployment environment variables.
                </span>
              </div>
            );
          }
          return null;
        })()}

        {/* Status Alert if any */}
        {statusMessage && (
          <div className="mt-4 p-3 rounded-2xl bg-[#58cc02]/10 border-2 border-[#58cc02]/30 text-xs font-bold text-[#46a302] flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Inputs */}
        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
              Supabase Project URL
            </label>
            <input
              type="text"
              placeholder="https://your-project-id.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden font-medium text-sm text-[#3c3c3c] bg-white transition-colors"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Found in your Supabase Dashboard → Project Settings → API → Project URL
            </p>
          </div>

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-1.5">
              Supabase Anon Public API Key
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-[#e5e5e5] focus:border-[#1cb0f6] focus:outline-hidden font-mono text-xs text-[#3c3c3c] bg-white transition-colors"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Found in your Supabase Dashboard → Project Settings → API → anon / public key
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              className="px-5 py-2.5 rounded-2xl text-xs font-black duo-btn-blue cursor-pointer"
            >
              Save Credentials
            </button>

            <button
              onClick={handleTest}
              disabled={testing || !url}
              className="px-5 py-2.5 rounded-2xl text-xs font-black duo-btn-green cursor-pointer disabled:opacity-50"
            >
              {testing ? 'Testing Connection...' : '⚡ Test Connection'}
            </button>
          </div>
        </div>

        {/* Test Result Box */}
        {testResult && (
          <div
            className={`mt-4 p-4 rounded-2xl border-2 text-xs font-semibold ${
              testResult.success
                ? 'bg-[#58cc02]/10 border-[#58cc02] text-[#2c6800]'
                : 'bg-[#ff4b4b]/10 border-[#ff4b4b] text-[#b91c1c]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {testResult.success ? (
                <Check className="w-5 h-5 text-[#58cc02] shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[#ff4b4b] shrink-0 mt-0.5" />
              )}
              <div className="space-y-2">
                <p className="font-bold">{testResult.message}</p>
                {testResult.tableStatus && (
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] pt-1">
                    <span>
                      all_logins:{' '}
                      <strong className={testResult.tableStatus.all_logins ? 'text-[#46a302]' : 'text-red-600'}>
                        {testResult.tableStatus.all_logins ? '✓ Found' : '✗ Missing'}
                      </strong>
                    </span>
                    <span>
                      libraries:{' '}
                      <strong className={testResult.tableStatus.libraries ? 'text-[#46a302]' : 'text-red-600'}>
                        {testResult.tableStatus.libraries ? '✓ Found' : '✗ Missing'}
                      </strong>
                    </span>
                    <span>
                      students:{' '}
                      <strong className={testResult.tableStatus.students ? 'text-[#46a302]' : 'text-red-600'}>
                        {testResult.tableStatus.students ? '✓ Found' : '✗ Missing'}
                      </strong>
                    </span>
                    <span>
                      shifts:{' '}
                      <strong className={testResult.tableStatus.shifts ? 'text-[#46a302]' : 'text-red-600'}>
                        {testResult.tableStatus.shifts ? '✓ Ready' : '✗ Blocked / Missing'}
                      </strong>
                    </span>
                    <span>
                      attendance_logs:{' '}
                      <strong className={testResult.tableStatus.attendance_logs ? 'text-[#46a302]' : 'text-red-600'}>
                        {testResult.tableStatus.attendance_logs ? '✓ Found' : '✗ Missing'}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Database Schema Setup Helper */}
        <div className="mt-6 pt-5 border-t-2 border-[#f0f0f0] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-[#3c3c3c]">Supabase SQL Schema Helper</h3>
              <p className="text-xs text-slate-500">
                Run this SQL script in your Supabase SQL Editor to initialize all tables & policies.
              </p>
            </div>
            <button
              onClick={handleCopySql}
              className="px-3.5 py-1.5 rounded-xl text-xs font-black duo-btn-white flex items-center gap-1.5 cursor-pointer"
            >
              {copiedSql ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#58cc02]" />
                  <span className="text-[#46a302]">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy SQL</span>
                </>
              )}
            </button>
          </div>

          <div className="p-3 bg-slate-900 rounded-2xl text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-32 border-2 border-slate-800">
            <pre>{SQL_SETUP_SCRIPT.slice(0, 320)}... (click 'Copy SQL' for full script)</pre>
          </div>
        </div>

        {/* Starter Data & Clean State Tools */}
        <div className="mt-5 pt-4 border-t-2 border-[#f0f0f0] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSeedStarter}
              disabled={seeding || clearing}
              className="px-3.5 py-2 rounded-xl text-xs font-black duo-btn-yellow flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Populate test admin, library owners, and student records"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{seeding ? 'Seeding...' : 'Load Demo Starter Data'}</span>
            </button>

            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearing}
              className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                confirmReset
                  ? 'duo-btn-red text-white'
                  : 'duo-btn-white text-red-600 hover:text-red-700'
              }`}
              title="Reset database to 100% blank clean state"
            >
              <Trash2 className={`w-3.5 h-3.5 ${confirmReset ? 'text-white' : 'text-red-500'}`} />
              <span>
                {clearing ? 'Clearing...' : confirmReset ? 'Confirm Clear All?' : 'Reset Clean State'}
              </span>
            </button>

            {confirmReset && !clearing && (
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-black duo-btn-white cursor-pointer ml-auto"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
