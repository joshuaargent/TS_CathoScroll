'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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

  const supabase = useMemo(() => createClient(), []);
  const profileRequest = useRef(0);
  const authEventVersion = useRef(0);

  const loadProfile = useCallback(async (userId: string, isActive: () => boolean = () => true) => {
    const requestId = ++profileRequest.current;
    const { data, error } = await supabase.from('profiles').select('id,username,display_name,bio,avatar_url,subscription_tier,created_at').eq('id', userId).single();
    if (!isActive() || requestId !== profileRequest.current) return;

    if (error) {
      setProfile(null);
      return;
    }

    setProfile(data);
  }, [supabase]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await loadProfile(user.id);
  }, [user, loadProfile]);

  useEffect(() => {
    let active = true;

    // Restore the existing session once, then keep the context synchronized
    // with sign-in, sign-out, and token-refresh events from Supabase.
    async function initialise() {
      const initialVersion = authEventVersion.current;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active || initialVersion !== authEventVersion.current) return;

        const currentSession = data.session;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          setProfile(null);
          await loadProfile(currentSession.user.id, () => active);
        } else {
          profileRequest.current++;
          setProfile(null);
        }
      } catch (cause) {
        console.error('Unable to restore the authentication session:', cause);
        if (active && initialVersion === authEventVersion.current) {
          setSession(null);
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (active && initialVersion === authEventVersion.current) setLoading(false);
      }
    }

    void initialise();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      authEventVersion.current++;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        setProfile(null);
        void loadProfile(nextSession.user.id, () => active);
      } else {
        profileRequest.current++;
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      active = false;
      // Prevent the auth listener from retaining this provider after unmount.
      authListener.subscription.unsubscribe();
    };
  }, [loadProfile, supabase]);

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
