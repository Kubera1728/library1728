/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Database, LogOut, ShieldCheck, Building2, GraduationCap } from 'lucide-react';
import { AuthSession } from '../types/database';
import { isSupabaseConfigured } from '../lib/supabase';

interface NavbarProps {
  session: AuthSession | null;
  onLogout: () => void;
  onOpenSupabaseModal: () => void;
  currentTab?: string;
  onSelectTab?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  session,
  onLogout,
  onOpenSupabaseModal,
  currentTab,
  onSelectTab,
}) => {
  const isConnected = isSupabaseConfigured();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b-2 border-[#e5e5e5]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-8">
        
        {/* Zone 1: Single text element Brand Zone */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-[#58cc02] border-b-3 border-[#46a302] flex items-center justify-center text-white font-black text-xl shadow-xs">
            🦉
          </div>
          <button
            onClick={() => onSelectTab && onSelectTab('home')}
            className="text-left group cursor-pointer"
          >
            <span className="font-display text-2xl font-black tracking-tight text-[#3c3c3c] group-hover:text-[#58cc02] transition-colors whitespace-nowrap">
              Study<span className="text-[#58cc02]">Lingo</span>
            </span>
          </button>
        </div>

        {/* Zone 2: Navigation Links / Session Role Context */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-bold text-[#777777]">
          {session ? (
            <>
              {session.role === 'admin' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-[#afafaf]">
                  <span className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-xl bg-[#ff9600]/15 text-[#e08500] border border-[#ff9600]/30">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    ADMIN PORTAL
                  </span>
                  <span>·</span>
                  <span className="text-slate-600 font-bold">Access Code: {session.code}</span>
                </div>
              )}
              {session.role === 'owner' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-[#afafaf]">
                  <span className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-xl bg-[#1cb0f6]/15 text-[#1899d6] border border-[#1cb0f6]/30">
                    <Building2 className="w-3.5 h-3.5" />
                    LIBRARY OWNER
                  </span>
                  <span>·</span>
                  <span className="text-slate-700 font-bold">{session.library?.name || 'My Library'}</span>
                </div>
              )}
              {session.role === 'student' && (
                <div className="flex items-center gap-2 text-xs font-semibold text-[#afafaf]">
                  <span className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-xl bg-[#58cc02]/15 text-[#46a302] border border-[#58cc02]/30">
                    <GraduationCap className="w-3.5 h-3.5" />
                    STUDENT DESK
                  </span>
                  <span>·</span>
                  <span className="text-slate-700 font-bold">Seat #{session.student?.seat_number || 'N/A'}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-6">
              <span className="text-xs font-semibold text-slate-500">
                Playful Library Management · Unified Access Code
              </span>
            </div>
          )}
        </nav>

        {/* Zone 3: 1 Primary Action Area */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Supabase status toggle button */}
          <button
            onClick={onOpenSupabaseModal}
            title={isConnected ? 'Supabase Connected' : 'Supabase Not Connected'}
            className="px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all duo-btn-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Database className={`w-3.5 h-3.5 ${isConnected ? 'text-[#58cc02]' : 'text-[#ff9600]'}`} />
            <span className="hidden sm:inline">Supabase:</span>
            <span className={isConnected ? 'text-[#46a302]' : 'text-[#e08500]'}>
              {isConnected ? 'Connected' : 'Configure'}
            </span>
          </button>

          {session ? (
            <button
              onClick={onLogout}
              className="px-4 py-1.5 rounded-xl text-xs font-extrabold duo-btn-red flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
          ) : (
            <button
              onClick={onOpenSupabaseModal}
              className="px-4 py-1.5 rounded-xl text-xs font-extrabold duo-btn-blue flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Setup DB</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
