import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Download,
  FileCheck2,
  Lock,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface VerifiedTokenReport {
  id: number;
  reportRefNumber: string;
  title: string;
  category: string;
  examinationDate: string;
  hospitalName: string;
  patientName: string;
  patientRefNumber: string;
  clinicalNotes: string;
  labValues: Array<{
    parameter: string;
    value: string;
    unit: string;
    referenceRange: string;
    flag?: string;
  }>;
}

const ROLE_OPTIONS = [
  {
    id: 'super_admin',
    label: 'Super Administrator',
    desc: 'Platform governance, hospitals, billing & audit',
    mfa: true,
    icon: ShieldCheck,
  },
  {
    id: 'hospital_admin',
    label: 'Hospital Administrator',
    desc: 'Al Noor Specialist Hospital · Departments, labs & KPIs',
    mfa: true,
    icon: Building2,
  },
  {
    id: 'doctor',
    label: 'Doctor / Medical Officer',
    desc: 'Dr. Evelyn Reed · Clinical verification & release',
    mfa: true,
    icon: Stethoscope,
  },
  {
    id: 'lab_staff',
    label: 'Laboratory Staff',
    desc: 'Upload scans, run Gemini AI extraction & submit',
    mfa: false,
    icon: FileCheck2,
  },
  {
    id: 'reception_staff',
    label: 'Reception & Records',
    desc: 'Patient registration, duplicate checks & matching',
    mfa: false,
    icon: Users,
  },
  {
    id: 'patient',
    label: 'Patient Portal',
    desc: 'Rashid Al-Mansoor · View & download verified PDFs',
    mfa: false,
    icon: UserCheck,
  },
];

export const LoginView: React.FC = () => {
  const { loginWithGoogle, loginWithRole, registerPatient, loading } = useAuth();
  const [tab, setTab] = useState<'portal' | 'register'>('portal');
  const [error, setError] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  // MFA challenge state
  const [mfaTargetRole, setMfaTargetRole] = useState<string | null>(null);
  const [mfaEmail, setMfaEmail] = useState<string>('');
  const [mfaCode, setMfaCode] = useState<string>('482910');

  // Patient self-registration form
  const [regForm, setRegForm] = useState({
    fullName: '',
    email: '',
    dateOfBirth: '1990-01-15',
    gender: 'Male',
    mobileCountryCode: '+971',
    mobileNumber: '',
    hospitalRegNumber: '',
  });

  // Secure expiring access link state
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenPatientHint, setTokenPatientHint] = useState<string>('');
  const [tokenDob, setTokenDob] = useState<string>('');
  const [verifiedReport, setVerifiedReport] = useState<VerifiedTokenReport | null>(null);
  const [viewerToken, setViewerToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('access_token');
    if (tok) {
      setAccessToken(tok);
      fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) setError(data.error);
          else if (data.patientHint) setTokenPatientHint(data.patientHint);
        })
        .catch(() => setError('Unable to validate secure access link.'));
    }
  }, []);

  const handleRoleSelect = async (roleId: string) => {
    setError(null);
    try {
      const res = await loginWithRole(roleId);
      if (res.requiresMfa) {
        setMfaTargetRole(roleId);
        setMfaEmail(res.email || '');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaTargetRole) return;
    setError(null);
    try {
      await loginWithRole(mfaTargetRole, mfaCode);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
    }
  };

  const handlePatientRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await registerPatient(regForm);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Patient registration failed');
    }
  };

  const handleVerifyAccessToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    try {
      const res = await fetch('/api/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: accessToken, dateOfBirth: tokenDob }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setVerifiedReport(data.report);
      setViewerToken(data.viewerToken);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Identity verification failed');
    }
  };

  // Render secure link verification view if ?access_token= is active
  if (accessToken) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
            <div>
              <span className="text-lg font-bold text-slate-900">MediReport Connect</span>
              <p className="text-xs text-slate-500 mt-0.5">
                Encrypted Time-Limited Patient Report Access
              </p>
            </div>
            <button
              onClick={() => {
                window.history.replaceState({}, '', '/');
                setAccessToken(null);
                setVerifiedReport(null);
              }}
              className="text-xs font-medium text-sky-700 hover:underline whitespace-nowrap"
            >
              Return to Portal Login
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {error}
            </div>
          )}

          {!verifiedReport ? (
            <form onSubmit={handleVerifyAccessToken} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Lock className="w-4 h-4 text-teal-600" />
                <span>Verify Your Date of Birth to Unlock Report</span>
              </div>
              {tokenPatientHint && (
                <p className="text-xs text-slate-600">
                  Patient Account: <span className="font-mono">{tokenPatientHint}</span>
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Date of Birth (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  required
                  value={tokenDob}
                  onChange={(e) => setTokenDob(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Synthetic demo patient DOB for Rashid: 1984-05-14
                </p>
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
              >
                Verify Identity & View Report
              </button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{verifiedReport.title}</h2>
                  <p className="text-xs text-slate-500 mt-1 font-mono">
                    {verifiedReport.reportRefNumber} · {verifiedReport.hospitalName} · Examined{' '}
                    {verifiedReport.examinationDate}
                  </p>
                </div>
                {viewerToken && (
                  <a
                    href={`/api/reports/${verifiedReport.id}/download?auth=${encodeURIComponent(
                      viewerToken
                    )}`}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    Download Verified PDF
                  </a>
                )}
              </div>

              {verifiedReport.labValues && verifiedReport.labValues.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Parameter</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Result</th>
                        <th className="py-2.5 px-3 font-semibold">Unit</th>
                        <th className="py-2.5 px-3 font-semibold">Reference</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {verifiedReport.labValues.map((lv, i) => (
                        <tr key={i}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{lv.parameter}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                            {lv.value}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500">{lv.unit}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">
                            {lv.referenceRange}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-teal-700">
                            {lv.flag || 'Normal'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {verifiedReport.clinicalNotes && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-xs font-semibold text-slate-700 mb-1">
                    Physician Notes
                  </div>
                  <p className="text-sm text-slate-700">{verifiedReport.clinicalNotes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Left Authentication Column */}
      <div className="lg:col-span-6 flex flex-col justify-between p-8 sm:p-12 lg:p-16">
        <div className="max-w-xl w-full mx-auto">
          <div className="flex items-center justify-between gap-4 mb-10">
            <span className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
              MediReport Connect
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setTab('portal')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'portal'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Staff & Patient Sign In
              </button>
              <button
                type="button"
                onClick={() => setTab('register')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'register'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Patient Registration
              </button>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance">
            Verified Medical Report Collection & Patient Delivery
          </h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            Centralised diagnostic intake with Gemini AI document extraction, strict physician
            verification gates, hospital-isolated records, and encrypted multi-channel delivery.
          </p>

          {error && (
            <div className="mt-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {error}
            </div>
          )}

          {mfaTargetRole ? (
            <form
              onSubmit={handleMfaSubmit}
              className="mt-8 p-6 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Lock className="w-4 h-4 text-teal-600" />
                <span>Multi-Factor Authentication Required</span>
              </div>
              <p className="text-xs text-slate-600">
                Privileged clinical account <span className="font-mono">{mfaEmail}</span> requires
                a 6-digit verification code. Synthetic sandbox OTP:{' '}
                <span className="font-mono font-semibold text-slate-900">482910</span>
              </p>
              <input
                type="text"
                maxLength={6}
                required
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="Enter 6-digit MFA code"
                className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                >
                  {loading ? 'Verifying...' : 'Verify MFA & Enter Workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => setMfaTargetRole(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Back
                </button>
              </div>
            </form>
          ) : tab === 'portal' ? (
            <div className="mt-8 space-y-6">
              <div>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <ShieldCheck className="w-4 h-4 text-teal-400" />
                  <span>Sign in with Google (Firebase SSO)</span>
                </button>
              </div>

              <div className="relative flex items-center">
                <div className="flex-grow border-t border-slate-200" />
                <span className="mx-3 text-xs text-slate-500">
                  Or launch a synthetic role workspace
                </span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ROLE_OPTIONS.map((r) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handleRoleSelect(r.id)}
                      className="text-left p-3.5 rounded-xl border border-slate-200 hover:border-teal-600 hover:bg-teal-50/30 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 group-hover:text-teal-800">
                          {r.label}
                        </span>
                        <Icon className="w-4 h-4 text-slate-400 group-hover:text-teal-600 shrink-0" />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{r.desc}</p>
                      {r.mfa && (
                        <span className="inline-block mt-1.5 text-[10px] font-mono text-sky-700">
                          MFA Protected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <form onSubmit={handlePatientRegister} className="mt-8 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Full Legal Name
                  </label>
                  <input
                    type="text"
                    required
                    value={regForm.fullName}
                    onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                    placeholder="e.g. Mariam Zayed Al-Shamsi"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    placeholder="patient@example.ae"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    required
                    value={regForm.dateOfBirth}
                    onChange={(e) => setRegForm({ ...regForm, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
                  <select
                    value={regForm.gender}
                    onChange={(e) => setRegForm({ ...regForm, gender: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mobile Number (with Country Code)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={regForm.mobileCountryCode}
                      onChange={(e) =>
                        setRegForm({ ...regForm, mobileCountryCode: e.target.value })
                      }
                      className="w-20 px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      value={regForm.mobileNumber}
                      onChange={(e) => setRegForm({ ...regForm, mobileNumber: e.target.value })}
                      placeholder="501234567"
                      className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Hospital MRN (Optional)
                  </label>
                  <input
                    type="text"
                    value={regForm.hospitalRegNumber}
                    onChange={(e) => setRegForm({ ...regForm, hospitalRegNumber: e.target.value })}
                    placeholder="MRN-AUH-..."
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
              >
                {loading ? 'Creating Patient Account...' : 'Register Patient Account & Consent'}
              </button>
            </form>
          )}
        </div>

        <div className="max-w-xl w-full mx-auto pt-8 border-t border-slate-100 mt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>UAE Healthcare Privacy & Consent Compliant</span>
          <span>Synthetic Demonstration Environment</span>
        </div>
      </div>

      {/* Right Visual Column */}
      <div className="lg:col-span-6 relative bg-slate-900 min-h-[360px] lg:min-h-screen overflow-hidden">
        {!heroImgFailed ? (
          <img
            src="/src/assets/images/clinical_portal_hero_1794929864212.jpg"
            alt="Modern clinical diagnostic laboratory atrium"
            referrerPolicy="no-referrer"
            onError={() => setHeroImgFailed(true)}
            className="w-full h-full object-cover opacity-85"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-900 via-sky-950 to-teal-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 sm:p-12 text-white">
          <p className="text-xs font-mono text-teal-300 mb-2">
            9-STEP VERIFIED CLINICAL PIPELINE
          </p>
          <h2 className="text-xl sm:text-2xl font-semibold text-balance max-w-lg">
            Zero unverified reports ever reach a patient.
          </h2>
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-200 border-t border-white/15 pt-5">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <span>Gemini AI OCR & missing-field audit</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <span>Mandatory physician sign-off gate</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <span>Expiring Email, WhatsApp & SMS links</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
