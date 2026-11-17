import React, { useEffect, useState } from 'react';
import {
  Bell,
  Building2,
  Download,
  FileText,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { t } from '../lib/i18n.ts';
import { AnalyticsCharts } from './AnalyticsCharts.tsx';

interface AnalyticsData {
  kpis: {
    totalPatients: number;
    totalReports: number;
    awaitingVerification: number;
    manualMatching: number;
    approvedReports: number;
    deliveredReports: number;
    failedNotifications: number;
    uploadedToday: number;
    uploadedThisMonth: number;
  };
  categoryBreakdown: Array<{ category: string; count: number }>;
  channelStats: Array<{ channel: string; delivered: number; failed: number; total: number }>;
  dailyTrend: Array<{ date: string; uploaded: number; delivered: number }>;
}

interface ReportSummary {
  id: number;
  reportRefNumber: string;
  title: string;
  category: string;
  hospitalName: string;
  departmentName: string;
  doctorName: string;
  examinationDate: string;
  uploadDate: string;
  status: string;
  clinicalNotes: string;
}

interface NotificationRow {
  id: number;
  reportId: number;
  channel: string;
  recipient: string;
  status: string;
  createdAt: string;
  patientAccessedAt: string | null;
  patientDownloadedAt: string | null;
}

export const DashboardView: React.FC<{
  onNavigate: (tab: string) => void;
}> = ({ onNavigate }) => {
  const { user, hospital, patientProfile, preferences, language, apiFetch, token, refreshProfile } =
    useAuth();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [patientReports, setPatientReports] = useState<ReportSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  // Patient filters
  const [filterCat, setFilterCat] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // Patient notification preference toggles
  const [prefState, setPrefState] = useState({
    emailEnabled: preferences?.emailEnabled ?? true,
    whatsappEnabled: preferences?.whatsappEnabled ?? true,
    smsEnabled: preferences?.smsEnabled ?? false,
    preferredChannel: preferences?.preferredChannel ?? 'email',
    preferredLanguage: preferences?.preferredLanguage ?? 'en',
  });

  useEffect(() => {
    if (preferences) {
      setPrefState({
        emailEnabled: preferences.emailEnabled,
        whatsappEnabled: preferences.whatsappEnabled,
        smsEnabled: preferences.smsEnabled,
        preferredChannel: preferences.preferredChannel,
        preferredLanguage: preferences.preferredLanguage,
      });
    }
  }, [preferences]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      if (user?.role === 'patient') {
        const [repRes, notifRes] = await Promise.all([
          apiFetch<{ reports: ReportSummary[]; pendingCount: number }>('/api/reports'),
          apiFetch<NotificationRow[]>('/api/notifications'),
        ]);
        setPatientReports(repRes.reports);
        setPendingCount(repRes.pendingCount);
        setNotifications(notifRes);
      } else {
        const data = await apiFetch<AnalyticsData>('/api/analytics/dashboard');
        setAnalytics(data);
      }
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Unable to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [user?.id]);

  const handleSavePatientPrefs = async () => {
    if (!patientProfile) return;
    try {
      await apiFetch(`/api/patients/${patientProfile.id}/preferences`, {
        method: 'PUT',
        body: JSON.stringify(prefState),
      });
      await refreshProfile();
      setBanner('Communication channel preferences updated.');
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to save preferences.');
    }
  };

  const handleSendReminders = async () => {
    try {
      const res = await apiFetch<{ remindedCount: number }>('/api/reports/send-reminders', {
        method: 'POST',
      });
      setBanner(`Dispatched physician verification reminders for ${res.remindedCount} pending reports.`);
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to send reminders.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-200/70 rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-slate-200/70 rounded-xl" />
      </div>
    );
  }

  // ==================== PATIENT DASHBOARD ====================
  if (user?.role === 'patient') {
    const viewedCount = notifications.filter((n) => n.patientAccessedAt).length;
    const downloadCount = notifications.filter((n) => n.patientDownloadedAt).length;
    const newCount = Math.max(0, patientReports.length - viewedCount);

    const filteredReports = patientReports.filter((r) => {
      if (filterCat && r.category !== filterCat) return false;
      if (filterDate && r.examinationDate !== filterDate) return false;
      return true;
    });

    const categories = Array.from(new Set(patientReports.map((r) => r.category)));

    return (
      <div className="space-y-6">
        {banner && (
          <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900 flex items-center justify-between">
            <span>{banner}</span>
            <button onClick={() => setBanner(null)} className="font-semibold">
              Dismiss
            </button>
          </div>
        )}

        {/* Patient Profile + Hospital Header */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <p className="text-xs font-mono text-teal-700">
              {patientProfile?.patientRefNumber || 'PATIENT PORTAL'} ·{' '}
              {patientProfile?.hospitalRegNumber || ''}
            </p>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              {patientProfile?.fullName || user.fullName}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              DOB: <span className="font-mono">{patientProfile?.dateOfBirth || 'N/A'}</span> ·{' '}
              {patientProfile?.mobileCountryCode} {patientProfile?.mobileNumber} ·{' '}
              {patientProfile?.email}
            </p>
          </div>
          <div className="text-left md:text-right border-t md:border-t-0 pt-4 md:pt-0 border-slate-100">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Building2 className="w-4 h-4 text-sky-600" />
              <span>{hospital?.name || 'Al Noor Specialist Hospital'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {hospital?.city || 'Abu Dhabi'} · {hospital?.licenseNumber || ''}
            </p>
          </div>
        </div>

        {/* 5 Patient Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Total Verified Reports</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {patientReports.length}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">New Unopened Reports</div>
            <div className="text-2xl font-bold font-mono text-teal-700 mt-1 tabular-nums">
              {newCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Previously Viewed</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {viewedCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">Pending Physician Review</div>
            <div className="text-2xl font-bold font-mono text-amber-700 mt-1 tabular-nums">
              {pendingCount}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs text-slate-500">PDF Downloads</div>
            <div className="text-2xl font-bold font-mono text-sky-700 mt-1 tabular-nums">
              {downloadCount}
            </div>
          </div>
        </div>

        {/* Verified Reports & Filters */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Released Medical Reports
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {t(language, 'noUnverifiedNotice')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
              {(filterCat || filterDate) && (
                <button
                  onClick={() => {
                    setFilterCat('');
                    setFilterDate('');
                  }}
                  className="text-xs text-sky-700 hover:underline px-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No released reports match the selected filters.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredReports.map((rep) => (
                <div
                  key={rep.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div>
                    <div className="text-xs font-mono text-slate-500">
                      {rep.reportRefNumber} · {rep.category} · Examined {rep.examinationDate}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">
                      {rep.title}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {rep.hospitalName} · {rep.doctorName || 'Verified Physician'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onNavigate('reports')}
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      View & Share
                    </button>
                    <a
                      href={`/api/reports/${rep.id}/download?auth=${encodeURIComponent(token || '')}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Communication Channel Preferences & Notification History */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Communication Preferences
            </h3>
            <p className="text-xs text-slate-500">
              Select how you receive secure expiring access links when a doctor approves your report.
            </p>
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between p-3 border border-slate-200 rounded-lg cursor-pointer">
                <span>Email Notifications</span>
                <input
                  type="checkbox"
                  checked={prefState.emailEnabled}
                  onChange={(e) =>
                    setPrefState({ ...prefState, emailEnabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
              <label className="flex items-center justify-between p-3 border border-slate-200 rounded-lg cursor-pointer">
                <span>WhatsApp Cloud Alerts (Link Only)</span>
                <input
                  type="checkbox"
                  checked={prefState.whatsappEnabled}
                  onChange={(e) =>
                    setPrefState({ ...prefState, whatsappEnabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
              <label className="flex items-center justify-between p-3 border border-slate-200 rounded-lg cursor-pointer">
                <span>SMS Gateway Alerts (Link Only)</span>
                <input
                  type="checkbox"
                  checked={prefState.smsEnabled}
                  onChange={(e) =>
                    setPrefState({ ...prefState, smsEnabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-teal-600"
                />
              </label>
            </div>
            <button
              onClick={handleSavePatientPrefs}
              className="w-full py-2 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Save Communication Preferences
            </button>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900">
                Recent Delivery Notifications
              </h3>
              <Bell className="w-4 h-4 text-slate-400" />
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-slate-500">No notifications dispatched yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.slice(0, 5).map((n) => (
                  <div key={n.id} className="py-3 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <div className="font-medium text-slate-900 capitalize">
                        {n.channel} · {n.recipient}
                      </div>
                      <div className="text-slate-500 font-mono mt-0.5">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`font-medium capitalize ${
                        n.status === 'delivered'
                          ? 'text-teal-700'
                          : n.status === 'failed'
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {n.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==================== CLINICAL / ADMIN DASHBOARD ====================
  const kpis = analytics?.kpis;

  return (
    <div className="space-y-6">
      {banner && (
        <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900 flex items-center justify-between">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {user?.role === 'super_admin'
              ? 'Platform Clinical Operations Overview'
              : `${hospital?.name || 'Hospital'} Operations Overview`}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {hospital
              ? `${hospital.emiratesJurisdiction} · License ${hospital.licenseNumber} · Duplicate rule: ${hospital.duplicateMatchRule}`
              : 'Multi-hospital network analytics and verification throughput'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadDashboard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {(user?.role === 'super_admin' || user?.role === 'hospital_admin') && (
            <>
              <button
                onClick={handleSendReminders}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                {t(language, 'sendReminders')}
              </button>
              <a
                href={`/api/analytics/export?format=csv&auth=${encodeURIComponent(token || '')}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {t(language, 'exportCsv')}
              </a>
              <a
                href={`/api/analytics/export?format=pdf&auth=${encodeURIComponent(token || '')}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                {t(language, 'exportPdf')}
              </a>
            </>
          )}
        </div>
      </div>

      {/* 8 Hospital Admin KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'totalPatients')}</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {kpis.totalPatients}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Active hospital profiles</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'totalReports')}</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {kpis.totalReports}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {kpis.uploadedToday} today · {kpis.uploadedThisMonth} this month
            </div>
          </div>

          <button
            onClick={() => onNavigate('reports')}
            className="text-left bg-white border border-slate-200 hover:border-amber-400 rounded-xl p-5 transition-colors"
          >
            <div className="text-xs text-slate-500">{t(language, 'awaitingVerification')}</div>
            <div className="text-2xl font-bold font-mono text-amber-700 mt-1 tabular-nums">
              {kpis.awaitingVerification}
            </div>
            <div className="text-[11px] text-amber-700 mt-1">
              +{kpis.manualMatching} awaiting patient match
            </div>
          </button>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'deliveredReports')}</div>
            <div className="text-2xl font-bold font-mono text-teal-700 mt-1 tabular-nums">
              {kpis.deliveredReports}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {kpis.approvedReports} physician-approved total
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'approvedReports')}</div>
            <div className="text-2xl font-bold font-mono text-sky-700 mt-1 tabular-nums">
              {kpis.approvedReports}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Released to patient portal</div>
          </div>

          <button
            onClick={() => onNavigate('notifications')}
            className="text-left bg-white border border-slate-200 hover:border-rose-400 rounded-xl p-5 transition-colors"
          >
            <div className="text-xs text-slate-500">{t(language, 'failedNotifications')}</div>
            <div className="text-2xl font-bold font-mono text-rose-700 mt-1 tabular-nums">
              {kpis.failedNotifications}
            </div>
            <div className="text-[11px] text-rose-700 mt-1 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              Click to inspect & retry
            </div>
          </button>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'uploadedToday')}</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {kpis.uploadedToday}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">PDF, scans & LIMS feeds</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{t(language, 'uploadedMonth')}</div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
              {kpis.uploadedThisMonth}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Current billing cycle</div>
          </div>
        </div>
      )}

      {/* Interactive Analytics Charts */}
      {analytics && (
        <AnalyticsCharts
          dailyTrend={analytics.dailyTrend}
          categoryBreakdown={analytics.categoryBreakdown}
          channelStats={analytics.channelStats}
        />
      )}
    </div>
  );
};
