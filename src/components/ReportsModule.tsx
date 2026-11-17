import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FilePlus2,
  History,
  Link2,
  Search,
  Share2,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ALLOWED_REPORT_CATEGORIES } from '../lib/matching.ts';

interface LabValue {
  parameter: string;
  value: string;
  unit: string;
  referenceRange: string;
  flag?: string;
}

interface MedicalReport {
  id: number;
  reportRefNumber: string;
  patientId: number | null;
  patientName: string;
  patientRefNumber: string;
  hospitalId: number;
  hospitalName: string;
  branchId: number | null;
  branchName: string;
  departmentId: number | null;
  departmentName: string;
  doctorName: string;
  reviewingDoctorId: number | null;
  category: string;
  title: string;
  examinationDate: string;
  uploadDate: string;
  sourceChannel: string;
  status: string;
  aiAdministrativeSummary: string;
  aiMissingFields: string[] | null;
  aiConfidenceScore: number;
  labValues: LabValue[] | null;
  clinicalNotes: string;
  version: number;
  isDuplicateFlagged: boolean;
  patientMatchedUncertain: boolean;
}

interface PatientItem {
  id: number;
  patientRefNumber: string;
  hospitalRegNumber: string;
  fullName: string;
  dateOfBirth: string;
}

interface DirectoryData {
  branches: Array<{ id: number; name: string }>;
  departments: Array<{ id: number; name: string }>;
  laboratories: Array<{ id: number; name: string }>;
  doctors: Array<{ id: number; fullName: string; specialty: string }>;
}

interface ApprovalEvent {
  id: number;
  action: string;
  clinicalComments: string;
  version: number;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  delivered: 'text-teal-700',
  approved: 'text-sky-700',
  pending_verification: 'text-amber-700',
  correction_requested: 'text-orange-700',
  manual_matching: 'text-indigo-700',
  rejected: 'text-rose-700',
};

export const ReportsModule: React.FC = () => {
  const { user, apiFetch, token } = useAuth();
  const [reports, setReports] = useState<MedicalReport[]>([]);
  const [pendingPatientCount, setPendingPatientCount] = useState(0);
  const [patients, setPatients] = useState<PatientItem[]>([]);
  const [directory, setDirectory] = useState<DirectoryData>({
    branches: [],
    departments: [],
    laboratories: [],
    doctors: [],
  });
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [searchQ, setSearchQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Upload / Gemini AI Modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiResult, setAiResult] = useState<{
    confidenceScore: number;
    missingFields: string[];
    administrativeSummary: string;
    duplicateWarning?: string;
  } | null>(null);

  const [formState, setFormState] = useState({
    patientId: '',
    branchId: '',
    departmentId: '',
    laboratoryId: '',
    reviewingDoctorId: '',
    category: 'Blood test reports',
    title: '',
    examinationDate: new Date().toISOString().slice(0, 10),
    reportRefNumber: '',
    sourceChannel: 'pdf_upload',
    clinicalNotes: '',
    patientMatchedUncertain: false,
    labValuesJson:
      '[{"parameter":"Hemoglobin (Hb)","value":"14.2","unit":"g/dL","referenceRange":"13.5 - 17.5","flag":"Normal"}]',
  });

  // Review / Details Modal
  const [selectedReport, setSelectedReport] = useState<MedicalReport | null>(null);
  const [historyList, setHistoryList] = useState<ApprovalEvent[]>([]);
  const [reviewComment, setReviewComment] = useState('');
  const [matchPatientId, setMatchPatientId] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const canUpload = ['super_admin', 'hospital_admin', 'lab_staff', 'reception_staff'].includes(
    user?.role || ''
  );
  const canVerify = ['doctor', 'super_admin'].includes(user?.role || '');
  const canMatch = ['reception_staff', 'hospital_admin', 'super_admin'].includes(
    user?.role || ''
  );

  const loadAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (searchQ.trim()) params.set('q', searchQ.trim());

      const repRes = await apiFetch<{ reports: MedicalReport[]; pendingCount: number }>(
        `/api/reports?${params.toString()}`
      );
      setReports(repRes.reports);
      setPendingPatientCount(repRes.pendingCount);

      if (user?.role !== 'patient') {
        const [patRes, dirRes] = await Promise.all([
          apiFetch<PatientItem[]>('/api/patients'),
          apiFetch<DirectoryData>('/api/hospital-directory'),
        ]);
        setPatients(patRes);
        setDirectory(dirRes);
      }
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load reports.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [statusFilter, categoryFilter]);

  const handleOpenReport = async (rep: MedicalReport) => {
    setSelectedReport(rep);
    setReviewComment(rep.clinicalNotes || '');
    setMatchPatientId(rep.patientId ? String(rep.patientId) : '');
    try {
      const hist = await apiFetch<ApprovalEvent[]>(`/api/reports/${rep.id}/history`);
      setHistoryList(hist);
    } catch {
      setHistoryList([]);
    }
  };

  const handleAiExtract = async () => {
    setAiExtracting(true);
    setBanner(null);
    try {
      const fd = new FormData();
      if (uploadFile) fd.append('file', uploadFile);
      if (rawText.trim()) fd.append('rawText', rawText.trim());

      const res = await apiFetch<{
        extracted: {
          patientName: string;
          hospitalRegNumber: string;
          reportRefNumber: string;
          category: string;
          title: string;
          examinationDate: string;
          labValues: LabValue[];
          missingFields: string[];
          administrativeSummary: string;
          confidenceScore: number;
        };
        matchedPatient: PatientItem | null;
        duplicateReport: MedicalReport | null;
      }>('/api/reports/ai-extract', {
        method: 'POST',
        body: fd,
      });

      const ex = res.extracted;
      setFormState((prev) => ({
        ...prev,
        patientId: res.matchedPatient ? String(res.matchedPatient.id) : '',
        patientMatchedUncertain: !res.matchedPatient,
        category: ex.category || prev.category,
        title: ex.title || prev.title,
        examinationDate: ex.examinationDate || prev.examinationDate,
        reportRefNumber: ex.reportRefNumber || prev.reportRefNumber,
        labValuesJson:
          ex.labValues && ex.labValues.length > 0
            ? JSON.stringify(ex.labValues, null, 2)
            : prev.labValuesJson,
      }));

      setAiResult({
        confidenceScore: ex.confidenceScore,
        missingFields: ex.missingFields,
        administrativeSummary: ex.administrativeSummary,
        duplicateWarning: res.duplicateReport
          ? `Potential duplicate reference detected (${res.duplicateReport.reportRefNumber}).`
          : undefined,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gemini AI extraction failed.',
      });
    } finally {
      setAiExtracting(false);
    }
  };

  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAction(true);
    setBanner(null);
    try {
      const fd = new FormData();
      if (uploadFile) fd.append('file', uploadFile);
      fd.append('patientId', formState.patientId);
      fd.append('branchId', formState.branchId);
      fd.append('departmentId', formState.departmentId);
      fd.append('laboratoryId', formState.laboratoryId);
      fd.append('reviewingDoctorId', formState.reviewingDoctorId);
      fd.append('category', formState.category);
      fd.append('title', formState.title || formState.category);
      fd.append('examinationDate', formState.examinationDate);
      fd.append('reportRefNumber', formState.reportRefNumber);
      fd.append('sourceChannel', formState.sourceChannel);
      fd.append('clinicalNotes', formState.clinicalNotes);
      fd.append('patientMatchedUncertain', String(formState.patientMatchedUncertain));
      fd.append('labValues', formState.labValuesJson);
      if (aiResult) {
        fd.append('aiAdministrativeSummary', aiResult.administrativeSummary);
        fd.append('aiConfidenceScore', String(aiResult.confidenceScore));
        fd.append('aiMissingFields', JSON.stringify(aiResult.missingFields));
      }

      const res = await apiFetch<{ report: MedicalReport; isDuplicateFlagged: boolean }>(
        '/api/reports',
        { method: 'POST', body: fd }
      );

      setShowUpload(false);
      setUploadFile(null);
      setAiResult(null);
      setBanner({
        type: 'ok',
        text: `Report ${res.report.reportRefNumber} submitted (${res.report.status.replace(
          /_/g,
          ' '
        )}).${res.isDuplicateFlagged ? ' Flagged for duplicate review.' : ''}`,
      });
      await loadAll();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit report.',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleVerifyReport = async (
    action: 'approved' | 'rejected' | 'correction_requested'
  ) => {
    if (!selectedReport) return;
    setSubmittingAction(true);
    try {
      const res = await apiFetch<{
        report: MedicalReport;
        deliveryResult?: { notifications?: Array<{ channel: string; status: string }> };
      }>(`/api/reports/${selectedReport.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ action, clinicalComments: reviewComment }),
      });

      const channels =
        res.deliveryResult?.notifications
          ?.map((n) => `${n.channel} (${n.status})`)
          .join(', ') || '';

      setBanner({
        type: 'ok',
        text:
          action === 'approved'
            ? `Report ${selectedReport.reportRefNumber} approved and released. Dispatched: ${channels}`
            : `Report ${selectedReport.reportRefNumber} updated to ${action.replace(/_/g, ' ')}.`,
      });
      setSelectedReport(null);
      await loadAll();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Verification action failed.',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleMatchPatient = async () => {
    if (!selectedReport || !matchPatientId) return;
    setSubmittingAction(true);
    try {
      await apiFetch(`/api/reports/${selectedReport.id}/match-patient`, {
        method: 'POST',
        body: JSON.stringify({ patientId: Number(matchPatientId) }),
      });
      setBanner({
        type: 'ok',
        text: `Report ${selectedReport.reportRefNumber} matched and routed to physician verification queue.`,
      });
      setSelectedReport(null);
      await loadAll();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Patient match failed.',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleResubmitCorrection = async () => {
    if (!selectedReport) return;
    setSubmittingAction(true);
    try {
      await apiFetch(`/api/reports/${selectedReport.id}/resubmit`, {
        method: 'POST',
        body: JSON.stringify({ clinicalNotes: reviewComment }),
      });
      setBanner({
        type: 'ok',
        text: `Report ${selectedReport.reportRefNumber} resubmitted as v${
          selectedReport.version + 1
        } for physician verification.`,
      });
      setSelectedReport(null);
      await loadAll();
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Resubmission failed.',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleShareWithDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport || !shareEmail.trim()) return;
    setSubmittingAction(true);
    try {
      await apiFetch(`/api/reports/${selectedReport.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ sharedWithEmail: shareEmail.trim() }),
      });
      setBanner({
        type: 'ok',
        text: `Authorized doctor access granted to ${shareEmail.trim()} for 14 days.`,
      });
      setShareEmail('');
    } catch (err: unknown) {
      setBanner({
        type: 'err',
        text: err instanceof Error ? err.message : 'Share failed.',
      });
    } finally {
      setSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {banner && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between ${
            banner.type === 'ok'
              ? 'bg-teal-50 border-teal-200 text-teal-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {user?.role === 'patient' && pendingPatientCount > 0 && (
        <div className="p-3.5 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900">
          You have <span className="font-mono font-semibold">{pendingPatientCount}</span> report(s)
          currently undergoing mandatory physician review. Unverified reports are released only after
          doctor approval.
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadAll()}
              placeholder="Search Ref #, Patient, Title..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Categories</option>
            {ALLOWED_REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {user?.role !== 'patient' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Workflow States</option>
              <option value="pending_verification">Pending Verification</option>
              <option value="manual_matching">Manual Patient Matching</option>
              <option value="correction_requested">Correction Requested</option>
              <option value="approved">Approved</option>
              <option value="delivered">Delivered</option>
              <option value="rejected">Rejected</option>
            </select>
          )}
          <button
            onClick={loadAll}
            className="px-3 py-2 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg"
          >
            Search
          </button>
        </div>

        {canUpload && (
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            Upload / Ingest Medical Report
          </button>
        )}
      </div>

      {/* Reports Data Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Patient</th>
                <th className="py-3 px-4">Category & Title</th>
                <th className="py-3 px-4">Exam Date</th>
                <th className="py-3 px-4">Reviewing Doctor</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading clinical reports...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    No medical reports found matching current filters.
                  </td>
                </tr>
              ) : (
                reports.map((rep) => (
                  <tr key={rep.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-900 whitespace-nowrap">
                      {rep.reportRefNumber}
                      <span className="text-slate-400 ml-1">v{rep.version}</span>
                      {rep.isDuplicateFlagged && (
                        <span className="block text-[10px] text-rose-600 font-sans">
                          Duplicate Flag
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{rep.patientName}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {rep.patientRefNumber}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{rep.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {rep.category} · {rep.hospitalName}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {rep.examinationDate}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {rep.doctorName || 'Unassigned'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`font-medium capitalize ${
                          STATUS_STYLE[rep.status] || 'text-slate-700'
                        }`}
                      >
                        {rep.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleOpenReport(rep)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-md"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {canVerify && rep.status === 'pending_verification' ? 'Review' : 'Open'}
                        </button>
                        {(user?.role !== 'patient' ||
                          rep.status === 'approved' ||
                          rep.status === 'delivered') && (
                          <a
                            href={`/api/reports/${rep.id}/download?auth=${encodeURIComponent(
                              token || ''
                            )}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200 hover:bg-teal-50 rounded-md"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload & Gemini AI Extraction Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl p-6 my-8 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Upload Medical Report & Gemini AI Extraction
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  AI extracts administrative fields & lab metrics only; physician verification is
                  mandatory before release.
                </p>
              </div>
              <button
                onClick={() => setShowUpload(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* File Drop & Text OCR Input */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <Upload className="w-4 h-4 text-teal-600" />
                  <span>{uploadFile ? uploadFile.name : 'Select PDF, JPG, or PNG scan'}</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.txt"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  disabled={aiExtracting}
                  onClick={handleAiExtract}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded-lg whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiExtracting ? 'Running Gemini OCR...' : 'Extract with Gemini AI'}
                </button>
              </div>

              <textarea
                rows={2}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Optional: Paste raw laboratory text or scanned report snippet for Gemini AI extraction..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              />

              {aiResult && (
                <div className="p-3 bg-white border border-sky-200 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-medium text-slate-900">
                    <span>Gemini AI Administrative Summary (Non-Diagnostic)</span>
                    <span className="font-mono text-teal-700">
                      Confidence: {aiResult.confidenceScore}%
                    </span>
                  </div>
                  <p className="text-slate-600">{aiResult.administrativeSummary}</p>
                  {aiResult.missingFields.length > 0 && (
                    <p className="text-amber-700">
                      Missing fields detected: {aiResult.missingFields.join(', ')}
                    </p>
                  )}
                  {aiResult.duplicateWarning && (
                    <p className="text-rose-700 font-medium">{aiResult.duplicateWarning}</p>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={handleCreateReport} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Patient Record (leave blank if uncertain)
                  </label>
                  <select
                    value={formState.patientId}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        patientId: e.target.value,
                        patientMatchedUncertain: !e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Unmatched — Send to Manual Verification Queue</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.patientRefNumber} / {p.hospitalRegNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Report Category
                  </label>
                  <select
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {ALLOWED_REPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Report Title
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.title}
                    onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                    placeholder="e.g. Complete Blood Count & Lipid Profile"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Examination Date
                  </label>
                  <input
                    type="date"
                    required
                    value={formState.examinationDate}
                    onChange={(e) =>
                      setFormState({ ...formState, examinationDate: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    value={formState.departmentId}
                    onChange={(e) => setFormState({ ...formState, departmentId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select Department</option>
                    {directory.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Reviewing Doctor / Medical Officer
                  </label>
                  <select
                    value={formState.reviewingDoctorId}
                    onChange={(e) =>
                      setFormState({ ...formState, reviewingDoctorId: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Assign Reviewing Physician</option>
                    {directory.doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.specialty})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Collection Source
                  </label>
                  <select
                    value={formState.sourceChannel}
                    onChange={(e) => setFormState({ ...formState, sourceChannel: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="pdf_upload">PDF Upload</option>
                    <option value="scanned_document">Scanned Document (OCR)</option>
                    <option value="image_upload">JPG / PNG Image</option>
                    <option value="manual_entry">Manual Report Entry</option>
                    <option value="lims_integration">LIMS Integration</option>
                    <option value="hms_integration">Hospital Management System (HMS)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Report Reference Number (auto if blank)
                  </label>
                  <input
                    type="text"
                    value={formState.reportRefNumber}
                    onChange={(e) =>
                      setFormState({ ...formState, reportRefNumber: e.target.value })
                    }
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Structured Measurements (JSON)
                </label>
                <textarea
                  rows={3}
                  value={formState.labValuesJson}
                  onChange={(e) => setFormState({ ...formState, labValuesJson: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg"
                >
                  {submittingAction ? 'Submitting...' : 'Submit for Physician Verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Review, Matching & Download Modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl p-6 my-8 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {selectedReport.reportRefNumber} · v{selectedReport.version} ·{' '}
                  {selectedReport.category}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{selectedReport.title}</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Patient: <span className="font-medium">{selectedReport.patientName}</span> (
                  {selectedReport.patientRefNumber}) · Examined {selectedReport.examinationDate}
                </p>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedReport.aiAdministrativeSummary && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <div className="font-semibold text-slate-800 mb-1">
                  Administrative Extraction Summary
                </div>
                <p className="text-slate-600">{selectedReport.aiAdministrativeSummary}</p>
                {selectedReport.aiMissingFields && selectedReport.aiMissingFields.length > 0 && (
                  <p className="text-amber-700 mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Missing document fields: {selectedReport.aiMissingFields.join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Lab Values */}
            {selectedReport.labValues && selectedReport.labValues.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Parameter</th>
                      <th className="py-2 px-3 font-semibold text-right">Value</th>
                      <th className="py-2 px-3 font-semibold">Unit</th>
                      <th className="py-2 px-3 font-semibold">Reference Range</th>
                      <th className="py-2 px-3 font-semibold">Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedReport.labValues.map((lv, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3 font-medium text-slate-900">{lv.parameter}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                          {lv.value}
                        </td>
                        <td className="py-2 px-3 text-slate-500">{lv.unit}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{lv.referenceRange}</td>
                        <td
                          className={`py-2 px-3 font-medium ${
                            lv.flag && lv.flag !== 'Normal' ? 'text-rose-700' : 'text-teal-700'
                          }`}
                        >
                          {lv.flag || 'Normal'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Reception Manual Patient Matching */}
            {canMatch && selectedReport.status === 'manual_matching' && (
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                  <Link2 className="w-4 h-4" />
                  <span>Manual Patient Record Matching Required</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={matchPatientId}
                    onChange={(e) => setMatchPatientId(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs border border-indigo-300 rounded-lg bg-white"
                  >
                    <option value="">Select verified patient profile...</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} · {p.patientRefNumber} · DOB {p.dateOfBirth}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleMatchPatient}
                    disabled={!matchPatientId || submittingAction}
                    className="px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg whitespace-nowrap"
                  >
                    Confirm Match & Queue for Doctor
                  </button>
                </div>
              </div>
            )}

            {/* Doctor Verification Controls */}
            {canVerify &&
              (selectedReport.status === 'pending_verification' ||
                selectedReport.status === 'correction_requested') && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <label className="block text-xs font-semibold text-slate-800">
                    Authorized Physician Clinical Comments
                  </label>
                  <textarea
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Enter clinical verification notes or correction instructions..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleVerifyReport('approved')}
                      disabled={submittingAction || !selectedReport.patientId}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve & Trigger Patient Delivery
                    </button>
                    <button
                      onClick={() => handleVerifyReport('correction_requested')}
                      disabled={submittingAction}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg"
                    >
                      Request Correction
                    </button>
                    <button
                      onClick={() => handleVerifyReport('rejected')}
                      disabled={submittingAction}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-800 bg-rose-100 hover:bg-rose-200 rounded-lg"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject Report
                    </button>
                  </div>
                </div>
              )}

            {/* Lab Correction Resubmission */}
            {canUpload && selectedReport.status === 'correction_requested' && !canVerify && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                <div className="text-xs font-semibold text-amber-900">
                  Correction Requested by Reviewing Physician
                </div>
                <textarea
                  rows={2}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-amber-300 rounded-lg bg-white"
                />
                <button
                  onClick={handleResubmitCorrection}
                  disabled={submittingAction}
                  className="px-4 py-2 text-xs font-medium text-white bg-amber-700 hover:bg-amber-800 rounded-lg"
                >
                  Resubmit Corrected Version (v{selectedReport.version + 1})
                </button>
              </div>
            )}

            {/* Patient Share with Authorised Doctor */}
            {user?.role === 'patient' && (
              <form
                onSubmit={handleShareWithDoctor}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700 shrink-0">
                  <Share2 className="w-4 h-4 text-teal-600" />
                  <span>Share with Authorised Doctor:</span>
                </div>
                <input
                  type="email"
                  required
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="specialist@clinic.ae"
                  className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap"
                >
                  Grant 14-Day Access
                </button>
              </form>
            )}

            {/* Version History */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                <History className="w-3.5 h-3.5" />
                <span>Verification & Version History</span>
              </div>
              {historyList.length === 0 ? (
                <p className="text-xs text-slate-500">Initial submission (v{selectedReport.version}).</p>
              ) : (
                <div className="space-y-1.5 text-xs">
                  {historyList.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-slate-600">
                      <span>
                        <strong className="text-slate-900 capitalize">
                          {h.action.replace(/_/g, ' ')}
                        </strong>{' '}
                        (v{h.version}) — {h.clinicalComments || 'No comment'}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {new Date(h.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
