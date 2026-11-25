import React, { useCallback, useEffect, useState } from 'react';
import { Search, ShieldAlert } from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { EmptyState, TableSkeleton } from '../components/ui/Primitives.tsx';
import { apiRequest } from '../lib/api.ts';
import { AuditLog } from '../shared/types.ts';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [targetType, setTargetType] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ search, targetType });
      const res = await apiRequest<{ items: AuditLog[] }>(`/api/audit-logs?${qs.toString()}`);
      setLogs(res.items);
    } finally {
      setLoading(false);
    }
  }, [search, targetType]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppLayout
      title="Audit & Security Logs"
      breadcrumb="9HR India Pvt. Ltd. · Immutable Compliance Trail"
    >
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, target ID, or details..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
        </div>
        <select
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="ALL">All Event Categories</option>
          <option value="AUTH">Authentication & Security</option>
          <option value="CANDIDATE">Candidates</option>
          <option value="TOKEN">Onboarding Tokens</option>
          <option value="DOCUMENT">Documents</option>
          <option value="EMPLOYEE">Employees</option>
          <option value="STAFF">Staff Accounts</option>
          <option value="SYSTEM">System Config</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton rows={7} />
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="w-6 h-6" />}
          title="No matching audit events"
          description="Security and onboarding actions are logged chronologically here."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{l.actorName}</div>
                      <div className="text-slate-500">{l.actorRole}</div>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {l.action}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {l.targetType} · {l.targetId}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
