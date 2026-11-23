/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Database, LogOut, ShieldCheck, Building2, GraduationCap, Lock } from 'lucide-react';
import { AuthSession } from '../types/database';
import { isSupabaseConfigured } from '../lib/supabase';

interface NavbarProps {
  session: AuthSession | null;
  onLogout: () => void;
  onOpenSupabaseModal: () => void;
  onSelectTab?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  session,
  onLogout,
  onOpenSupabaseModal,
  onSelectTab,
}) => {
  const isConnected = isSupabaseConfigured();

  return (
    <header className="shrink-0 z-40 bg-white/95 backdrop-blur-md border-b-2 border-[#e5e5e5]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-12 sm:h-15 flex items-center justify-between gap-4 sm:gap-8">
        
        {/* Zone 1: Single text element Brand Zone */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#58cc02] border-b-2 border-[#46a302] flex items-center justify-center text-white font-black text-base sm:text-lg shadow-xs">
            🦉
          </div>
          <button
            type="button"
            onClick={() => onSelectTab && onSelectTab('home')}
            className="text-left group cursor-pointer"
          >
            <span className="font-display text-lg sm:text-2xl font-black tracking-tight text-[#3c3c3c] group-hover:text-[#58cc02] transition-colors whitespace-nowrap">
              Study<span className="text-[#58cc02]">Lingo</span>
            </span>
          </button>
        </div>

        {/* Zone 2: Role Context (Desktop) */}
        <nav className="hidden md:flex items-center gap-4 text-xs font-bold text-slate-600">
          {session ? (
            <>
              {session.role === 'admin' && (
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#e08500]" />
                  <span className="font-black text-[#e08500]">Admin Portal</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono text-slate-600">{session.code}</span>
                </div>
              )}
              {session.role === 'owner' && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#1899d6]" />
                  <span className="font-black text-[#1899d6]">{session.library?.name || 'Owner Portal'}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono text-slate-600">{session.code}</span>
                </div>
              )}
              {session.role === 'student' && (
                <div className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-[#46a302]" />
                  <span className="font-black text-[#46a302]">{session.student?.name}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="text-slate-600">Seat #{session.student?.seat_number || 'N/A'}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Unified Access Portal</span>
            </div>
          )}
        </nav>

        {/* Zone 3: Compact Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          {session ? (
            <>
              {session.role === 'admin' && (
                <button
                  type="button"
                  onClick={onOpenSupabaseModal}
                  title={isConnected ? 'Supabase Connected' : 'Configure Supabase'}
                  className="hidden sm:flex px-3 py-1.5 rounded-xl text-xs font-extrabold items-center gap-1.5 transition-all duo-btn-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Database className={`w-3.5 h-3.5 ${isConnected ? 'text-[#58cc02]' : 'text-[#ff9600]'}`} />
                  <span className={isConnected ? 'text-[#46a302]' : 'text-[#e08500]'}>
                    {isConnected ? 'DB Ready' : 'Setup DB'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 rounded-xl text-xs font-extrabold duo-btn-red flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Exit</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Lock className="w-3.5 h-3.5 text-[#58cc02]" />
              <span className="hidden sm:inline">Secure Session</span>
            </div>
          )}
        </div>

      </div>
    </header>
  );
};
