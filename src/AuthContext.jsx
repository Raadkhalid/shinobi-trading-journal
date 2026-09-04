import React, { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

const SUPABASE_URL = 'https://tdyjwofueivtsxegwzae.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkeWp3b2Z1ZWl2dHN4ZWd3emFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNjY4MjksImV4cCI6MjA4NDk0MjgyOX0.VU0LVZzyAyn1C2kHYUocPHxOnoXigRhEK-YMzFMij8I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'trading-journal-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

const AuthContext = createContext({});
export const useAuth = () => useContext(AuthContext);

// Every country/region libphonenumber-js knows a calling code for (245 as of writing) -
// generated rather than hand-typed so it stays accurate and genuinely covers the world.
// Multiple countries can share a calling code (e.g. +1 for US/Canada/Caribbean nations);
// each still gets its own row here so people can find their actual country, but `iso`
// (not `code`) is what's unique - use it as the React key.
const regionNames = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export const countryCodes = getCountries()
  .map(iso => ({
    iso,
    code: `+${getCountryCallingCode(iso)}`,
    country: regionNames ? (regionNames.of(iso) || iso) : iso
  }))
  .sort((a, b) => a.country.localeCompare(b.country));

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const fetchProfileInternal = async (userId) => {
    try {
      setProfileLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) setProfile(data);
    } catch (err) {
      console.error('Profile fetch error:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    // Get initial session - this is all we need
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfileInternal(session.user.id);
      } else {
        setProfileLoading(false);
      }
      setLoading(false);
    });

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        setUser(session.user);
        setPasswordRecovery(true);
        setLoading(false);
      } else if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        fetchProfileInternal(session.user.id);
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setPasswordRecovery(false);
        setProfileLoading(true);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) setProfile(data);
      return { data, error };
    } catch (err) {
      return { data: null, error: err };
    }
  };

  const signUp = async ({ email, password, fullName, phone, countryCode, location, instagram }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, country_code: countryCode, location, instagram }
      }
    });
    return { data, error };
  };

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signOut = async () => {
    setUser(null);
    setProfile(null);
    await supabase.auth.signOut();
  };

  // Records why someone wants to leave. Doesn't delete the account itself -
  // that needs elevated (service-role) permissions this client doesn't have,
  // so actual removal is a manual step for now (Supabase Dashboard > Authentication > Users).
  const requestAccountDeletion = async ({ reason, details }) => {
    const { error } = await supabase
      .from('deletion_requests')
      .insert({ user_id: user.id, email: user.email, reason, details: details || null });
    return { error };
  };

  const resetPassword = async (email) => {
    return await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
  };

  const updateProfile = async (updates) => {
    // Google sign-ins may not have a profiles row yet (or it's missing required
    // columns like email/full_name that the email/password signup trigger fills in).
    // Check first so an existing row only gets the fields we're actually changing,
    // and a missing row gets created with everything the table needs.
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    const result = existing
      ? await supabase
          .from('profiles')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', user.id)
      : await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
            ...updates,
            updated_at: new Date().toISOString()
          });

    const { data, error } = result;
    if (!error) setProfile(prev => ({ ...prev, ...updates }));
    return { data, error };
  };

  const changePassword = async (newPassword) => {
    const result = await supabase.auth.updateUser({ password: newPassword });
    if (!result.error) setPasswordRecovery(false);
    return result;
  };

  const sendPasswordResetEmail = async () => {
    return await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: window.location.origin
    });
  };

  const signInWithGoogle = async () => {
    return await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  const signInWithApple = async () => {
    return await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: window.location.origin } });
  };

  return (
    <AuthContext.Provider value={{
      user, profile, loading, profileLoading, passwordRecovery,
      signUp, signIn, signOut, resetPassword,
      updateProfile, fetchProfile, changePassword,
      sendPasswordResetEmail, signInWithGoogle, signInWithApple,
      requestAccountDeletion
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
