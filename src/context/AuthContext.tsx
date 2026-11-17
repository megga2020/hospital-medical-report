import React, { createContext, useContext, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { Language } from '../lib/i18n.ts';

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  role: string;
  hospitalId: number | null;
  branchId: number | null;
  departmentId: number | null;
  mfaEnabled: boolean;
  language: Language;
}

export interface HospitalInfo {
  id: number;
  name: string;
  nameAr: string;
  code: string;
  licenseNumber: string;
  emiratesJurisdiction: string;
  city: string;
  duplicateMatchRule: string;
  retentionDays: number;
}

export interface PatientProfile {
  id: number;
  patientRefNumber: string;
  hospitalRegNumber: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  email: string;
  mobileCountryCode: string;
  mobileNumber: string;
  hospitalId: number;
  consentStatus: string;
}

export interface NotificationPrefs {
  patientId: number;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  preferredChannel: string;
  preferredLanguage: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  hospital: HospitalInfo | null;
  patientProfile: PatientProfile | null;
  preferences: NotificationPrefs | null;
  language: Language;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithRole: (role: string, mfaCode?: string) => Promise<{ requiresMfa?: boolean; email?: string; fullName?: string }>;
  registerPatient: (payload: Record<string, string | number>) => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  refreshProfile: (overrideToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  apiFetch: <T>(url: string, options?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Store auth token strictly in React memory (never localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hospital, setHospital] = useState<HospitalInfo | null>(null);
  const [patientProfile, setPatientProfile] = useState<PatientProfile | null>(null);
  const [preferences, setPreferences] = useState<NotificationPrefs | null>(null);
  const [language, setLangState] = useState<Language>('en');
  const [loading, setLoading] = useState(false);

  const apiFetch = async <T,>(url: string, options: RequestInit = {}, overrideTok?: string): Promise<T> => {
    const activeToken = overrideTok || token;
    const headers = new Headers(options.headers || {});
    if (activeToken) {
      headers.set('Authorization', `Bearer ${activeToken}`);
    }
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: text };
    }
    if (!res.ok) {
      const errObj = parsed as { error?: string };
      throw new Error(errObj.error || `Request failed (${res.status})`);
    }
    return parsed as T;
  };

  const refreshProfile = async (overrideTok?: string) => {
    const data = await apiFetch<{
      user: AuthUser;
      hospital: HospitalInfo | null;
      patientProfile: PatientProfile | null;
      preferences: NotificationPrefs | null;
    }>('/api/auth/me', {}, overrideTok);
    setUser(data.user);
    setHospital(data.hospital);
    setPatientProfile(data.patientProfile);
    setPreferences(data.preferences);
    setLangState(data.user.language === 'ar' ? 'ar' : 'en');
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google sign-in failed');
      setToken(data.sessionToken);
      await refreshProfile(data.sessionToken);
    } finally {
      setLoading(false);
    }
  };

  const loginWithRole = async (role: string, mfaCode?: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, mfaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      if (data.requiresMfa) {
        return { requiresMfa: true, email: data.email, fullName: data.fullName };
      }
      setToken(data.sessionToken);
      await refreshProfile(data.sessionToken);
      return {};
    } finally {
      setLoading(false);
    }
  };

  const registerPatient = async (payload: Record<string, string | number>) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/patient-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setToken(data.sessionToken);
      await refreshProfile(data.sessionToken);
    } finally {
      setLoading(false);
    }
  };

  const setLanguage = async (lang: Language) => {
    setLangState(lang);
    if (token) {
      await apiFetch('/api/auth/language', {
        method: 'PUT',
        body: JSON.stringify({ language: lang }),
      }).catch(() => {});
    }
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    setHospital(null);
    setPatientProfile(null);
    setPreferences(null);
    await signOut(auth).catch(() => {});
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        hospital,
        patientProfile,
        preferences,
        language,
        loading,
        loginWithGoogle,
        loginWithRole,
        registerPatient,
        setLanguage,
        refreshProfile,
        logout,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
