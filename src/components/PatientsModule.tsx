import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Search, UserPlus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface PatientRow {
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
  needsManualVerification: boolean;
  duplicateCandidateId: number | null;
}

export const PatientsModule: React.FC = () => {
  const { apiFetch } = useAuth();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'verification'>('all');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    hospitalRegNumber: '',
    dateOfBirth: '1988-03-20',
    gender: 'Male',
    email: '',
    mobileCountryCode: '+971',
    mobileNumber: '',
    consentStatus: 'granted',
  });

  const loadPatients = async () => {
    setLoading(true);
    try {
      const q = searchQ.trim() ? `?q=${encodeURIComponent(searchQ.trim())}` : '';
      const data = await apiFetch<PatientRow[]>(`/api/patients${q}`);
      setPatients(data);
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load patients.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      const res = await apiFetch<{
        patient: PatientRow;
        uncertainMatchWarning?: string;
      }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      setForm({
        fullName: '',
        hospitalRegNumber: '',
        dateOfBirth: '1988-03-20',
        gender: 'Male',
        email: '',
        mobileCountryCode: '+971',
        mobileNumber: '',
        consentStatus: 'granted',
      });
      if (res.uncertainMatchWarning) {
        setBanner({
          type: 'warn',
          text: `Patient ${res.patient.patientRefNumber} created in Manual Verification Queue (not auto-merged): ${res.uncertainMatchWarning}`,
        });
      } else {
        setBanner({
          type: 'ok',
          text: `Registered patient ${res.patient.fullName} (${res.patient.patientRefNumber}).`,
        });
      }
      await loadPatients();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Registration blocked.',
      });
    }
  };

  const handleResolveDuplicate = async (
    patientId: number,
    resolution: 'confirm_distinct' | 'merge_into_target',
    targetPatientId?: number
  ) => {
    try {
      await apiFetch(`/api/patients/${patientId}/resolve-duplicate`, {
        method: 'POST',
        body: JSON.stringify({ resolution, targetPatientId }),
      });
      setBanner({
        type: 'ok',
        text:
          resolution === 'merge_into_target'
            ? 'Duplicate record manually merged.'
            : 'Patient identity verified as distinct profile.',
      });
      await loadPatients();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to resolve verification.',
      });
    }
  };

  const displayed =
    filterMode === 'verification'
      ? patients.filter((p) => p.needsManualVerification)
      : patients;

  const verificationCount = patients.filter((p) => p.needsManualVerification).length;

  return (
    <div className="space-y-6">
      {banner && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
            banner.type === 'ok'
              ? 'bg-teal-50 border-teal-200 text-teal-900'
              : banner.type === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadPatients()}
              placeholder="Search Patient ID, Name, Phone, Email, or MRN..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <button
            onClick={loadPatients}
            className="px-3 py-2 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg"
          >
            Search
          </button>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${
                filterMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              All Patients ({patients.length})
            </button>
            <button
              onClick={() => setFilterMode('verification')}
              className={`px-3 py-1 text-xs font-medium rounded-md ${
                filterMode === 'verification'
                  ? 'bg-white text-amber-800 shadow-sm'
                  : 'text-slate-600'
              }`}
            >
              Manual Verification ({verificationCount})
            </button>
          </div>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg whitespace-nowrap shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Register Patient
        </button>
      </div>

      {/* Patient Directory Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Patient Ref ID</th>
                <th className="py-3 px-4">Hospital MRN</th>
                <th className="py-3 px-4">Full Name & Demographics</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Consent</th>
                <th className="py-3 px-4 text-right">Identity Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading patient registry...
                  </td>
                </tr>
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No matching patient records found.
                  </td>
                </tr>
              ) : (
                displayed.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-slate-900">{p.patientRefNumber}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{p.hospitalRegNumber}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{p.fullName}</div>
                      <div className="text-[11px] text-slate-500">
                        DOB {p.dateOfBirth} · {p.gender}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-mono text-slate-700">
                        {p.mobileCountryCode} {p.mobileNumber}
                      </div>
                      <div className="text-[11px] text-slate-500">{p.email || 'No email'}</div>
                    </td>
                    <td className="py-3 px-4 capitalize font-medium text-teal-700">
                      {p.consentStatus}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {p.needsManualVerification ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Uncertain Match
                          </span>
                          <button
                            onClick={() => handleResolveDuplicate(p.id, 'confirm_distinct')}
                            className="px-2 py-1 text-[11px] font-medium border border-slate-300 rounded hover:bg-slate-100"
                          >
                            Confirm Distinct
                          </button>
                          {p.duplicateCandidateId && (
                            <button
                              onClick={() =>
                                handleResolveDuplicate(
                                  p.id,
                                  'merge_into_target',
                                  p.duplicateCandidateId!
                                )
                              }
                              className="px-2 py-1 text-[11px] font-medium text-white bg-amber-700 hover:bg-amber-800 rounded"
                            >
                              Merge
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-teal-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verified
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Patient Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Register New Patient Profile
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configurable duplicate checks prevent silent merges on uncertain matches.
                </p>
              </div>
              <button onClick={() => setShowCreate(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Patient Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Hospital Registration Number (MRN)
                  </label>
                  <input
                    type="text"
                    required
                    value={form.hospitalRegNumber}
                    onChange={(e) => setForm({ ...form, hospitalRegNumber: e.target.value })}
                    placeholder="MRN-AUH-..."
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    required
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Gender</label>
                  <select
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mobile with Country Code
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={form.mobileCountryCode}
                      onChange={(e) => setForm({ ...form, mobileCountryCode: e.target.value })}
                      className="w-16 px-2 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      value={form.mobileNumber}
                      onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })}
                      className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
                >
                  Register Patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
