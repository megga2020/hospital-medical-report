import React, { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

interface NotificationItem {
  id: number;
  reportId: number;
  patientId: number;
  channel: string;
  recipient: string;
  messageBody: string;
  secureAccessUrl: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  errorMessage: string;
  patientAccessedAt: string | null;
  patientDownloadedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
}

export const NotificationsModule: React.FC = () => {
  const { user, apiFetch } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<NotificationItem[]>('/api/notifications');
      setItems(data);
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const handleRetry = async (id: number) => {
    try {
      const updated = await apiFetch<NotificationItem>(`/api/notifications/${id}/retry`, {
        method: 'POST',
      });
      setBanner(
        `Notification #${updated.id} retried via ${updated.channel} — status: ${updated.status}`
      );
      await loadNotifications();
    } catch (err: unknown) {
      setBanner(err instanceof Error ? err.message : 'Retry failed.');
    }
  };

  const canRetry = ['super_admin', 'hospital_admin', 'reception_staff'].includes(
    user?.role || ''
  );

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

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Multi-Channel Notification Delivery Log
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tracks Email, WhatsApp Cloud API, and SMS gateway deliveries. Only time-limited access
            links are sent; medical attachments are never sent over SMS or WhatsApp.
          </p>
        </div>
        <button
          onClick={loadNotifications}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
              <tr>
                <th className="py-3 px-4">Channel & Recipient</th>
                <th className="py-3 px-4">Delivery Status</th>
                <th className="py-3 px-4">Retries</th>
                <th className="py-3 px-4">Patient Engagement</th>
                <th className="py-3 px-4">Error / Gateway Note</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading notification logs...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No notifications have been dispatched yet.
                  </td>
                </tr>
              ) : (
                items.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 capitalize">
                        {n.channel === 'whatsapp' ? 'WhatsApp Business' : n.channel.toUpperCase()}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">{n.recipient}</div>
                    </td>
                    <td className="py-3 px-4">
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
                      {n.deliveredAt && (
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {new Date(n.deliveredAt).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700">
                      {n.retryCount}/{n.maxRetries}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      <div>
                        Accessed:{' '}
                        <span className="font-mono">
                          {n.patientAccessedAt
                            ? new Date(n.patientAccessedAt).toLocaleDateString()
                            : 'Not yet'}
                        </span>
                      </div>
                      <div>
                        Downloaded:{' '}
                        <span className="font-mono">
                          {n.patientDownloadedAt
                            ? new Date(n.patientDownloadedAt).toLocaleDateString()
                            : 'Not yet'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      <span className="text-[11px] text-slate-600">
                        {n.errorMessage || 'Delivered with time-limited secure link'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canRetry && n.status === 'failed' && (
                        <button
                          onClick={() => handleRetry(n.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-rose-700 hover:bg-rose-800 rounded-md"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry Now
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
