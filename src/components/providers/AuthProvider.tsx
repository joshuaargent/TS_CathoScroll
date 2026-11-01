'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import type { User, Session } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

export interface Profile {
  id: string;

  username: string;

  display_name: string;

  bio: string | null;

  avatar_url: string | null;

  subscription_tier: string;

  created_at: string;
}

interface AuthContextValue {
  user: User | null;

  profile: Profile | null;

  session: Session | null;

  loading: boolean;

  isAuthenticated: boolean;

  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [session, setSession] = useState<Session | null>(null);

  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();

    if (error) {
      setProfile(null);
      return;
    }

    setProfile(data);
  }

  async function refreshProfile() {
    if (!user) {
      return;
    }

    await loadProfile(user.id);
  }

  useEffect(() => {
    async function initialise() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);

      setUser(session?.user ?? null);

      if (session?.user) {
        await loadProfile(session.user.id);
      }

      setLoading(false);
    }

    initialise();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);

      setUser(session?.user ?? null);

      if (session?.user) {
        await loadProfile(session.user.id);
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,

        profile,

        session,

        loading,

        isAuthenticated: !!session,

        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
