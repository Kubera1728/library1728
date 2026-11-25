/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthSession } from './types/database';
import { Navbar } from './components/Navbar';
import { LoginScreen } from './components/LoginScreen';
import { AdminDashboard } from './components/AdminDashboard';
import { OwnerDashboard } from './components/OwnerDashboard';
import { StudentDashboard } from './components/StudentDashboard';
import { PublicQrScanPage } from './components/PublicQrScanPage';
import { SupabaseModal } from './components/SupabaseModal';
import { hydrateSupabaseConfigFromServer, isSupabaseConfigured } from './lib/supabase';
import { playSound } from './lib/utils';

interface ScanRouteParams {
  seat: string;
  lib: string;
}

function parseScanRouteFromLocation(): ScanRouteParams | null {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  const isScanPath = pathname === '/scan' || params.get('scan') === '1';
  if (!isScanPath) return null;
  return {
    seat: (params.get('seat') || params.get('s') || '').trim(),
    lib: (params.get('lib') || params.get('libraryId') || '').trim(),
  };
}

function parseOwnerRouteFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  if (pathname === '/owner' || pathname === '/owner-login') {
    const lib = (params.get('lib') || params.get('libraryId') || '').trim();
    return lib || null;
  }
  const ownerLib = (params.get('ownerLib') || '').trim();
  return ownerLib || null;
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const saved = sessionStorage.getItem('studylingo_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [scanRoute, setScanRoute] = useState<ScanRouteParams | null>(() =>
    parseScanRouteFromLocation()
  );
  const [ownerRouteLibId, setOwnerRouteLibId] = useState<string | null>(() =>
    parseOwnerRouteFromLocation()
  );
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);
  const [configReady, setConfigReady] = useState(() => isSupabaseConfigured());
  const [, setUiTick] = useState(0);

  // Hydrate runtime Supabase env vars from server if not already present on window/Vite env
  useEffect(() => {
    if (isSupabaseConfigured()) {
      setConfigReady(true);
      return;
    }
    let cancelled = false;
    void hydrateSupabaseConfigFromServer()
      .then((hydrated) => {
        if (cancelled) return;
        if (hydrated) {
          setConfigVersion((v) => v + 1);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConfigReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen to browser navigation (back/forward) for /scan and /owner routes
  useEffect(() => {
    const handlePopState = () => {
      setScanRoute(parseScanRouteFromLocation());
      setOwnerRouteLibId(parseOwnerRouteFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sync session with storage
  useEffect(() => {
    if (session) {
      sessionStorage.setItem('studylingo_session', JSON.stringify(session));
    } else {
      sessionStorage.removeItem('studylingo_session');
    }
  }, [session]);

  const navigateToHome = () => {
    if (typeof window !== 'undefined' && (window.location.pathname !== '/' || window.location.search)) {
      window.history.pushState({}, '', '/');
    }
    setScanRoute(null);
    setOwnerRouteLibId(null);
  };

  // If scanning Owner Master QR while already signed in as Owner for that exact library, land cleanly on OwnerDashboard
  const isOwnerQrAlreadySignedIn = Boolean(
    ownerRouteLibId &&
      session?.role === 'owner' &&
      (session.reference_id === ownerRouteLibId || session.library?.id === ownerRouteLibId)
  );

  useEffect(() => {
    if (isOwnerQrAlreadySignedIn) {
      navigateToHome();
    }
  }, [isOwnerQrAlreadySignedIn]);

  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
    navigateToHome();
  };

  const handleLogout = () => {
    playSound('pop');
    setSession(null);
    navigateToHome();
  };

  const handleDataChanged = () => {
    setUiTick((v) => v + 1);
  };

  const handleSupabaseConfigChanged = () => {
    setConfigVersion((v) => v + 1);
  };

  const needsOwnerQrLogin = Boolean(ownerRouteLibId && !isOwnerQrAlreadySignedIn);
  const isDashboardMode = Boolean(session && !scanRoute && !needsOwnerQrLogin);

  return (
    <div
      className={`${
        isDashboardMode
          ? 'h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#f7f9fa]'
          : 'min-h-screen bg-white'
      } w-full flex flex-col text-[#3c3c3c] overflow-x-hidden`}
    >
      {/* Top Navbar (only shown inside authenticated dashboards) */}
      {isDashboardMode && (
        <Navbar
          session={session}
          onLogout={handleLogout}
          onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
          onSelectTab={(tab) => {
            if (tab === 'home' && (scanRoute || needsOwnerQrLogin)) {
              navigateToHome();
            }
          }}
        />
      )}

      {/* Main Content Area */}
      <main className={`flex-1 ${isDashboardMode ? 'min-h-0 overflow-hidden flex flex-col' : ''}`}>
        {!configReady && (session || scanRoute || ownerRouteLibId) ? (
          <div className="flex-1 flex items-center justify-center p-6 text-xs font-bold text-slate-500">
            Connecting to database...
          </div>
        ) : scanRoute ? (
          <PublicQrScanPage
            seatParam={scanRoute.seat}
            libraryIdParam={scanRoute.lib}
            onNavigateHome={navigateToHome}
            onOpenStudentSession={handleLoginSuccess}
          />
        ) : needsOwnerQrLogin || !session ? (
          <LoginScreen
            onLoginSuccess={handleLoginSuccess}
            targetOwnerLibraryId={needsOwnerQrLogin ? ownerRouteLibId : null}
            onClearTargetLibrary={navigateToHome}
          />
        ) : session.role === 'admin' ? (
          <AdminDashboard
            key={`admin_${configVersion}`}
            adminCode={session.code}
            onRefresh={handleDataChanged}
            onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
            onLogout={handleLogout}
          />
        ) : session.role === 'owner' ? (
          <OwnerDashboard
            key={`owner_${session.reference_id || session.library?.id || ''}_${configVersion}`}
            ownerCode={session.code}
            libraryId={session.reference_id || session.library?.id || ''}
            onLogout={handleLogout}
          />
        ) : session.role === 'student' && session.student ? (
          <StudentDashboard
            studentCode={session.code}
            student={session.student}
            library={session.library}
            onLogout={handleLogout}
          />
        ) : (
          <div className="max-w-md mx-auto my-auto p-6 bg-white duo-card text-center space-y-4">
            <h2 className="text-xl font-black text-[#3c3c3c]">Profile Data Not Linked</h2>
            <p className="text-xs text-slate-500">
              The code <span className="font-mono font-bold text-slate-700">{session.code}</span> was recognized as a {session.role}, but its reference data was removed.
            </p>
            <button
              onClick={handleLogout}
              className="py-2.5 px-6 rounded-xl text-xs font-black duo-btn-red cursor-pointer"
            >
              Return to Login
            </button>
          </div>
        )}
      </main>

      {/* Supabase Dynamic Configuration Modal */}
      <SupabaseModal
        isOpen={isSupabaseModalOpen}
        onClose={() => setIsSupabaseModalOpen(false)}
        onDataChanged={handleSupabaseConfigChanged}
      />
    </div>
  );
}
