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
import { SupabaseModal } from './components/SupabaseModal';
import { dataService, isSupabaseConfigured } from './lib/supabase';
import { playSound } from './lib/utils';

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      const saved = sessionStorage.getItem('studylingo_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // Sync session with storage
  useEffect(() => {
    if (session) {
      sessionStorage.setItem('studylingo_session', JSON.stringify(session));
    } else {
      sessionStorage.removeItem('studylingo_session');
    }
  }, [session]);

  const handleLoginSuccess = (newSession: AuthSession) => {
    setSession(newSession);
  };

  const handleLogout = () => {
    playSound('pop');
    setSession(null);
  };

  const handleDataChanged = () => {
    setDataVersion((v) => v + 1);
  };

  return (
    <div className="min-h-screen bg-[#f7f9fa] flex flex-col text-[#3c3c3c]">
      {/* Top Navbar */}
      <Navbar
        session={session}
        onLogout={handleLogout}
        onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1">
        {!session ? (
          <LoginScreen
            onLoginSuccess={handleLoginSuccess}
            onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
            dataVersion={dataVersion}
          />
        ) : session.role === 'admin' ? (
          <AdminDashboard
            adminCode={session.code}
            onRefresh={handleDataChanged}
          />
        ) : session.role === 'owner' ? (
          <OwnerDashboard
            ownerCode={session.code}
            libraryId={session.reference_id || ''}
          />
        ) : session.role === 'student' && session.student ? (
          <StudentDashboard
            studentCode={session.code}
            student={session.student}
            library={session.library}
          />
        ) : (
          <div className="max-w-md mx-auto my-12 p-8 bg-white duo-card text-center space-y-4">
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
        onDataChanged={handleDataChanged}
      />
    </div>
  );
}
