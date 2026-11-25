import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Copy, Info } from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { EmptyState, TableSkeleton } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { NotificationRecord } from '../shared/types.ts';

export default function NotificationsPage() {
  const { addToast } = useAuth();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        items: NotificationRecord[];
        smtpConfigured: boolean;
      }>('/api/notifications');
      setItems(res.items);
      setSmtpConfigured(res.smtpConfigured);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAllRead = async () => {
    await apiRequest('/api/notifications/all/read', { method: 'PATCH' });
    addToast({ title: 'All notifications marked read', type: 'info' });
    load();
  };

  return (
    <AppLayout
      title="Notifications & Outbox"
      breadcrumb="9HR India Pvt. Ltd. · Onboarding Communication Log"
      primaryAction={
        <button
          type="button"
          onClick={markAllRead}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
        >
          <CheckCheck className="w-4 h-4" />
          Mark All Read
        </button>
      }
    >
      <div className="mb-6 p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3">
        <Info className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <strong className="text-slate-900">
            Email Delivery Status: {smtpConfigured ? 'SMTP Gateway Configured' : 'SMTP Not Configured (Emails Not Sent)'}
          </strong>
          <p className="mt-0.5">
            {smtpConfigured
              ? 'Outbound onboarding emails are dispatched via your configured SMTP relay.'
              : 'SMTP credentials are optional and not configured in this environment. Invitations and notifications have NOT been emailed — use Copy Invitation Link below to share onboarding URLs directly with candidates.'}
          </p>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-6 h-6" />}
          title="No notifications logged yet"
          description="Candidate invitations, submissions, document rejections, and employee conversions will appear here."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {items.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                n.isRead ? 'bg-white' : 'bg-emerald-50/30'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-slate-900 text-sm">{n.title}</span>
                  <span className="text-slate-300">·</span>
                  <span
                    className={`font-semibold ${
                      n.deliveryStatus === 'SENT_SMTP'
                        ? 'text-emerald-700'
                        : n.deliveryStatus === 'PENDING_MANUAL_SHARE'
                          ? 'text-amber-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {n.deliveryStatus === 'SENT_SMTP'
                      ? 'Sent via SMTP'
                      : n.deliveryStatus === 'PENDING_MANUAL_SHARE'
                        ? 'Email Not Sent'
                        : 'In-App Log'}
                  </span>
                </div>
                <p className="text-xs text-slate-600">{n.message}</p>
                <p className="text-[11px] text-slate-500">
                  Recipient: {n.recipientName} ({n.recipientEmail}) · {n.deliveryNote} ·{' '}
                  <span className="font-mono">{new Date(n.createdAt).toLocaleString()}</span>
                </p>
              </div>

              {n.onboardingUrl && (
                <button
                  type="button"
                  onClick={async () => {
                    const full = `${window.location.origin}${n.onboardingUrl}`;
                    await navigator.clipboard.writeText(full);
                    addToast({ title: 'Invitation link copied', type: 'success' });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Invitation Link
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
