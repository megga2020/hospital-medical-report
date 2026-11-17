import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle2, Code2, CreditCard, KeyRound, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface HospitalRow {
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

interface StaffRow {
  id: number;
  email: string;
  fullName: string;
  role: string;
  hospitalId: number | null;
  mfaEnabled: boolean;
}

interface SubscriptionRow {
  id: number;
  hospitalId: number;
  hospitalName: string;
  hospitalCode: string;
  planTier: string;
  monthlyPriceAed: number;
  maxReportsPerMonth: number;
  reportsUsedThisMonth: number;
  status: string;
}

interface AuditRow {
  id: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export const PlatformAdminModule: React.FC<{
  mode: 'organization' | 'integrations' | 'audit' | 'apidocs';
}> = ({ mode }) => {
  const { user, apiFetch } = useAuth();
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [integrations, setIntegrations] = useState<{
    credentials: {
      geminiConfigured: boolean;
      emailConfigured: boolean;
      whatsappConfigured: boolean;
      smsConfigured: boolean;
    };
    settings: {
      maxRetries: number;
      retryDelayMinutes: number;
      pendingReminderHours: number;
      sandboxMode: boolean;
    } | null;
  } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Forms
  const [newHosp, setNewHosp] = useState({
    name: '',
    code: '',
    licenseNumber: '',
    city: 'Dubai',
    emiratesJurisdiction: 'UAE-DHA (Dubai)',
  });
  const [newStaff, setNewStaff] = useState({
    fullName: '',
    email: '',
    role: 'lab_staff',
    specialty: '',
  });
  const [newDept, setNewDept] = useState({ hospitalId: '', name: '', code: '', headDoctorName: '' });
  const [newLab, setNewLab] = useState({ hospitalId: '', name: '', code: '', limsIntegrationType: 'HL7 FHIR R4 REST' });

  const loadData = async () => {
    try {
      if (mode === 'organization') {
        const [h, s] = await Promise.all([
          apiFetch<HospitalRow[]>('/api/hospitals'),
          apiFetch<StaffRow[]>('/api/staff').catch(() => []),
        ]);
        setHospitals(h);
        setStaff(s);
        if (h.length > 0 && !newDept.hospitalId) {
          setNewDept((d) => ({ ...d, hospitalId: String(h[0].id) }));
          setNewLab((l) => ({ ...l, hospitalId: String(h[0].id) }));
        }
      } else if (mode === 'integrations') {
        const [intRes, subRes] = await Promise.all([
          apiFetch<typeof integrations>('/api/settings/integrations'),
          apiFetch<SubscriptionRow[]>('/api/subscriptions').catch(() => []),
        ]);
        setIntegrations(intRes);
        setSubs(subRes);
      } else if (mode === 'audit') {
        const logs = await apiFetch<AuditRow[]>('/api/audit-logs');
        setAuditLogs(logs);
      }
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to load administrative records.');
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const handleCreateHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/hospitals', { method: 'POST', body: JSON.stringify(newHosp) });
      setBanner(`Hospital ${newHosp.name} registered.`);
      setNewHosp({ name: '', code: '', licenseNumber: '', city: 'Dubai', emiratesJurisdiction: 'UAE-DHA (Dubai)' });
      await loadData();
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to register hospital.');
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ ...newStaff, hospitalId: hospitals[0]?.id }),
      });
      setBanner(`Staff account created for ${newStaff.fullName}.`);
      setNewStaff({ fullName: '', email: '', role: 'lab_staff', specialty: '' });
      await loadData();
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to create staff.');
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    const hospId = Number(newDept.hospitalId || hospitals[0]?.id);
    if (!hospId) return;
    try {
      await apiFetch(`/api/hospitals/${hospId}/departments`, {
        method: 'POST',
        body: JSON.stringify(newDept),
      });
      setBanner(`Department ${newDept.name} registered.`);
      setNewDept({ ...newDept, name: '', code: '', headDoctorName: '' });
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to register department.');
    }
  };

  const handleCreateLab = async (e: React.FormEvent) => {
    e.preventDefault();
    const hospId = Number(newLab.hospitalId || hospitals[0]?.id);
    if (!hospId) return;
    try {
      await apiFetch(`/api/hospitals/${hospId}/laboratories`, {
        method: 'POST',
        body: JSON.stringify(newLab),
      });
      setBanner(`Laboratory ${newLab.name} registered.`);
      setNewLab({ ...newLab, name: '', code: '' });
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to register laboratory.');
    }
  };

  const handleUpdateSubscription = async (hospitalId: number, planTier: string) => {
    try {
      await apiFetch(`/api/subscriptions/${hospitalId}`, {
        method: 'PUT',
        body: JSON.stringify({ planTier }),
      });
      setBanner('Hospital subscription tier updated.');
      await loadData();
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Subscription update failed.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!integrations?.settings) return;
    try {
      await apiFetch('/api/settings/integrations', {
        method: 'PUT',
        body: JSON.stringify(integrations.settings),
      });
      setBanner('Retry & notification policy settings saved.');
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to save settings.');
    }
  };

  if (mode === 'apidocs') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-teal-600" />
            <h2 className="text-base font-semibold text-slate-900">
              LIMS / HMS REST API Integration Documentation
            </h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Hospital Management Systems (HMS) and Laboratory Information Management Systems (LIMS)
            can push verified diagnostic payloads directly into MediReport Connect for automatic
            patient matching and physician verification queuing.
          </p>

          <div className="p-4 bg-slate-950 text-slate-100 rounded-lg font-mono text-xs overflow-x-auto space-y-2">
            <div className="text-teal-400">POST /api/integrations/lims/reports</div>
            <pre>{`{
  "hospitalCode": "ALNOOR",
  "patientRefNumber": "PAT-ALNO-100421",
  "hospitalRegNumber": "MRN-AUH-90412",
  "category": "Blood test reports",
  "title": "Lipid & Liver Function Panel",
  "examinationDate": "2026-11-17",
  "labValues": [
    { "parameter": "ALT", "value": "24", "unit": "U/L", "referenceRange": "7 - 55", "flag": "Normal" }
  ]
}`}</pre>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="font-semibold text-slate-900 mb-1">
                UAE Healthcare Data Isolation
              </div>
              <p className="text-slate-600">
                Every request is scoped strictly by hospital ID. Cross-hospital reads or downloads
                return HTTP 403 Forbidden and generate an immutable audit log entry.
              </p>
            </div>
            <div className="p-4 border border-slate-200 rounded-lg">
              <div className="font-semibold text-slate-900 mb-1">
                Automated Upload Malware Scanning
              </div>
              <p className="text-slate-600">
                All multipart PDF, JPG, and PNG uploads undergo MIME allowlist checks, SHA-256
                checksum hashing, and binary signature scanning prior to database persistence.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'audit') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Immutable Security & Clinical Audit Trail
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks authentications, report uploads, AI extractions, approvals, downloads, and
              patient consent changes.
            </p>
          </div>
          <Shield className="w-5 h-5 text-teal-600" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-slate-900">{log.actorEmail}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{log.actorRole}</td>
                  <td className="py-2.5 px-4 font-mono font-medium text-teal-700">{log.action}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">
                    {log.resourceType} #{log.resourceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (mode === 'integrations') {
    const creds = integrations?.credentials;
    return (
      <div className="space-y-6">
        {banner && (
          <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
            {banner}
          </div>
        )}

        {/* Environment Integration Status (No secret inputs in UI) */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                External Gateway & AI Integration Status
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Credentials are managed securely via server environment variables. Channels without
                live credentials operate in safe Sandbox Mode.
              </p>
            </div>
            <KeyRound className="w-5 h-5 text-sky-600" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {[
              { name: 'Google Gemini AI (OCR)', active: creds?.geminiConfigured, env: 'GEMINI_API_KEY' },
              { name: 'Email Provider (Resend)', active: creds?.emailConfigured, env: 'RESEND_API_KEY' },
              { name: 'WhatsApp Cloud API', active: creds?.whatsappConfigured, env: 'WHATSAPP_ACCESS_TOKEN' },
              { name: 'SMS Gateway (Twilio)', active: creds?.smsConfigured, env: 'TWILIO_ACCOUNT_SID' },
            ].map((item) => (
              <div key={item.name} className="p-4 border border-slate-200 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900">{item.name}</div>
                <div className={item.active ? 'text-teal-700 font-medium' : 'text-amber-700 font-medium'}>
                  {item.active ? 'Live Credentials Connected' : 'Safe Sandbox Mode'}
                </div>
                <div className="font-mono text-[11px] text-slate-400">Env: {item.env}</div>
              </div>
            ))}
          </div>

          {integrations?.settings && (
            <form onSubmit={handleSaveSettings} className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Max Notification Retries
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={integrations.settings.maxRetries}
                  onChange={(e) =>
                    setIntegrations({
                      ...integrations,
                      settings: { ...integrations.settings!, maxRetries: Number(e.target.value) },
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Retry Delay (Minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  value={integrations.settings.retryDelayMinutes}
                  onChange={(e) =>
                    setIntegrations({
                      ...integrations,
                      settings: {
                        ...integrations.settings!,
                        retryDelayMinutes: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Pending Reminder (Hours)
                </label>
                <input
                  type="number"
                  min={1}
                  value={integrations.settings.pendingReminderHours}
                  onChange={(e) =>
                    setIntegrations({
                      ...integrations,
                      settings: {
                        ...integrations.settings!,
                        pendingReminderHours: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Save Retry Rules
              </button>
            </form>
          )}
        </div>

        {/* Subscriptions & Billing */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-teal-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Hospital Subscriptions & Monthly Report Quotas
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {subs.map((s) => (
              <div
                key={s.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900">{s.hospitalName}</div>
                  <div className="text-slate-500 font-mono mt-0.5">
                    {s.reportsUsedThisMonth} / {s.maxReportsPerMonth} reports this month · AED{' '}
                    {s.monthlyPriceAed}/mo
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {user?.role === 'super_admin' ? (
                    <select
                      value={s.planTier}
                      onChange={(e) => handleUpdateSubscription(s.hospitalId, e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-medium"
                    >
                      <option value="starter">Starter (AED 1,800/mo)</option>
                      <option value="clinical_pro">Clinical Pro (AED 4,500/mo)</option>
                      <option value="enterprise_network">Enterprise Network (AED 9,800/mo)</option>
                    </select>
                  ) : (
                    <span className="font-medium text-teal-700 capitalize">
                      {s.planTier.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Organization Mode (Hospitals, Departments, Labs, Staff)
  return (
    <div className="space-y-6">
      {banner && (
        <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900">
          {banner}
        </div>
      )}

      {/* Registered Hospitals */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-teal-600" />
          <h2 className="text-base font-semibold text-slate-900">
            Registered Hospitals & Medical Centres
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hospitals.map((h) => (
            <div key={h.id} className="p-4 border border-slate-200 rounded-lg text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 text-sm">{h.name}</span>
                <span className="font-mono text-teal-700">{h.code}</span>
              </div>
              <div className="text-slate-600">
                {h.emiratesJurisdiction} · License {h.licenseNumber}
              </div>
              <div className="text-slate-500">
                Match rule: {h.duplicateMatchRule} · Retention: {h.retentionDays} days
              </div>
            </div>
          ))}
        </div>

        {user?.role === 'super_admin' && (
          <form onSubmit={handleCreateHospital} className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-5 gap-3">
            <input
              type="text"
              required
              placeholder="Hospital Name"
              value={newHosp.name}
              onChange={(e) => setNewHosp({ ...newHosp, name: e.target.value })}
              className="sm:col-span-2 px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Code (e.g. ZAYED)"
              value={newHosp.code}
              onChange={(e) => setNewHosp({ ...newHosp, code: e.target.value })}
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="License (DOH/DHA)"
              value={newHosp.licenseNumber}
              onChange={(e) => setNewHosp({ ...newHosp, licenseNumber: e.target.value })}
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
            >
              Register Hospital
            </button>
          </form>
        )}
      </div>

      {/* Departments & Laboratories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleCreateDept} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Register Clinical Department</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              required
              placeholder="Department Name"
              value={newDept.name}
              onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Code (e.g. NEURO)"
              value={newDept.code}
              onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            Add Department
          </button>
        </form>

        <form onSubmit={handleCreateLab} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Register Laboratory / LIMS Node</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              required
              placeholder="Laboratory Name"
              value={newLab.name}
              onChange={(e) => setNewLab({ ...newLab, name: e.target.value })}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <input
              type="text"
              required
              placeholder="Code (e.g. LAB-04)"
              value={newLab.code}
              onChange={(e) => setNewLab({ ...newLab, code: e.target.value })}
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
          >
            Add Laboratory
          </button>
        </form>
      </div>

      {/* Staff Accounts */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-900">Staff & Clinician Accounts</h3>
        <form onSubmit={handleCreateStaff} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            required
            placeholder="Full Name"
            value={newStaff.fullName}
            onChange={(e) => setNewStaff({ ...newStaff, fullName: e.target.value })}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
          <input
            type="email"
            required
            placeholder="Email Address"
            value={newStaff.email}
            onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
          <select
            value={newStaff.role}
            onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="lab_staff">Laboratory Staff</option>
            <option value="doctor">Doctor / Medical Officer</option>
            <option value="reception_staff">Reception & Records</option>
            <option value="hospital_admin">Hospital Administrator</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
          >
            Create Staff Account
          </button>
        </form>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-3">Name</th>
                <th className="py-2.5 px-3">Email</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">MFA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((st) => (
                <tr key={st.id}>
                  <td className="py-2.5 px-3 font-medium text-slate-900">{st.fullName}</td>
                  <td className="py-2.5 px-3 text-slate-600">{st.email}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-700">{st.role}</td>
                  <td className="py-2.5 px-3">
                    {st.mfaEnabled ? (
                      <span className="inline-flex items-center gap-1 text-teal-700">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enabled
                      </span>
                    ) : (
                      <span className="text-slate-400">Standard</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
