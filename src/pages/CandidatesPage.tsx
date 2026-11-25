import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import {
  EmptyState,
  Modal,
  StatusIndicator,
  TableSkeleton,
} from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, getStoredToken } from '../lib/api.ts';
import { hasPermission } from '../shared/rbac.ts';
import {
  Candidate,
  ONBOARDING_STATUSES,
  StaffUser,
} from '../shared/types.ts';

interface CandidateListItem extends Candidate {
  hasActiveLink: boolean;
  tokenPrefix?: string;
  tokenExpiresAt?: string;
  documentCount: number;
  verifiedDocCount: number;
}

export default function CandidatesPage() {
  const { user, addToast } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canCreateCandidate = hasPermission(user?.effectivePermissions, 'candidates', 'create');
  const canEditCandidate = hasPermission(user?.effectivePermissions, 'candidates', 'edit');
  const canExportCandidates = hasPermission(user?.effectivePermissions, 'candidates', 'export');

  const [items, setItems] = useState<CandidateListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [recruiterFilter, setRecruiterFilter] = useState('ALL');
  const [scope, setScope] = useState<'all' | 'live' | 'demo'>('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [recruiters, setRecruiters] = useState<StaffUser[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Register Modal
  const [registerOpen, setRegisterOpen] = useState(searchParams.get('new') === '1');
  const [regForm, setRegForm] = useState({
    fullName: '',
    email: '',
    mobile: '',
    position: '',
    department: 'Engineering',
    joiningDate: '',
    assignedRecruiterId: '',
  });
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState('');

  // Generated Link Modal
  const [linkModal, setLinkModal] = useState<{
    candidateName: string;
    onboardingUrl: string;
    expiresAt: string;
    deliveryNote: string;
    emailSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ recruiters: StaffUser[] }>('/api/staff/recruiters'),
      apiRequest<{ config: { departments: string[] } }>('/api/config'),
    ])
      .then(([recRes, cfgRes]) => {
        setRecruiters(recRes.recruiters);
        setDepartments(cfgRes.config.departments);
        setRegForm((prev) => ({
          ...prev,
          department: cfgRes.config.departments[0] || 'Engineering',
          assignedRecruiterId:
            prev.assignedRecruiterId ||
            user?.id ||
            recRes.recruiters[0]?.id ||
            '',
        }));
      })
      .catch(() => {});
  }, [user?.id]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        search,
        status: statusFilter,
        department: deptFilter,
        recruiterId: recruiterFilter,
        scope,
        sortBy,
        sortDir,
        page: String(page),
        pageSize: String(pageSize),
      });
      const res = await apiRequest<{
        items: CandidateListItem[];
        total: number;
        totalPages: number;
      }>(`/api/candidates?${qs.toString()}`);
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, deptFilter, recruiterFilter, scope, sortBy, sortDir, page, pageSize]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    setRegBusy(true);
    try {
      const res = await apiRequest<{
        candidate: Candidate;
        token: { expiresAt: string };
        onboardingUrl: string;
        emailDispatch: { deliveryStatus: string; deliveryNote: string };
      }>('/api/candidates', {
        method: 'POST',
        body: JSON.stringify(regForm),
      });

      setRegisterOpen(false);
      if (searchParams.get('new')) {
        setSearchParams({});
      }
      setRegForm({
        fullName: '',
        email: '',
        mobile: '',
        position: '',
        department: departments[0] || 'Engineering',
        joiningDate: '',
        assignedRecruiterId: user?.id || recruiters[0]?.id || '',
      });
      const emailSent = res.emailDispatch.deliveryStatus === 'SENT_SMTP';
      setLinkModal({
        candidateName: res.candidate.fullName,
        onboardingUrl: `${window.location.origin}${res.onboardingUrl}`,
        expiresAt: res.token.expiresAt,
        deliveryNote: res.emailDispatch.deliveryNote,
        emailSent,
      });
      addToast({
        title: emailSent ? 'Candidate Registered' : 'Candidate Registered — Email Not Sent',
        description: emailSent
          ? `${res.candidate.candidateCode} created and invitation emailed.`
          : `${res.candidate.candidateCode} created. Copy the invitation link to share manually.`,
        type: emailSent ? 'success' : 'warning',
      });
      loadCandidates();
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'Failed to register candidate.');
    } finally {
      setRegBusy(false);
    }
  };

  const handleGenerateLink = async (cand: CandidateListItem) => {
    try {
      const res = await apiRequest<{
        token: { expiresAt: string };
        onboardingUrl: string;
        emailDispatch: { deliveryStatus: string; deliveryNote: string };
      }>(`/api/candidates/${cand.id}/token`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setLinkModal({
        candidateName: cand.fullName,
        onboardingUrl: `${window.location.origin}${res.onboardingUrl}`,
        expiresAt: res.token.expiresAt,
        deliveryNote: res.emailDispatch.deliveryNote,
        emailSent: res.emailDispatch.deliveryStatus === 'SENT_SMTP',
      });
      loadCandidates();
    } catch (err) {
      addToast({
        title: 'Link Generation Failed',
        description: err instanceof Error ? err.message : 'Could not generate link.',
        type: 'error',
      });
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      addToast({ title: 'Onboarding link copied to clipboard', type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast({ title: 'Copy failed — select and copy manually', type: 'warning' });
    }
  };

  const handleExportCsv = async () => {
    try {
      const qs = new URLSearchParams({
        search,
        status: statusFilter,
        department: deptFilter,
        scope,
      });
      const token = getStoredToken();
      const resp = await fetch(`/api/candidates/export/csv?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `9hr-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast({ title: 'CSV Export Downloaded', type: 'success' });
    } catch {
      addToast({ title: 'Failed to export CSV', type: 'error' });
    }
  };

  return (
    <AppLayout
      title="Candidate Management"
      breadcrumb="9HR India Pvt. Ltd. · Onboarding Pipeline"
      primaryAction={
        <div className="flex items-center gap-2.5">
          {canExportCandidates && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
          {canCreateCandidate && (
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Register Candidate
            </button>
          )}
        </div>
      }
    >
      {/* Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, email, candidate ID, or role..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          >
            <option value="ALL">All Statuses</option>
            {ONBOARDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => {
              setDeptFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by department"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={recruiterFilter}
            onChange={(e) => {
              setRecruiterFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by recruiter"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
          >
            <option value="ALL">All Recruiters</option>
            {recruiters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'live', 'demo'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setScope(s);
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  scope === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {s === 'all' ? 'All Records' : s === 'live' ? 'Live Only' : 'Demo Only'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Showing {items.length} of {total} candidates
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No matching candidates found"
          description="Try clearing your active filters or register a new candidate to generate a secure onboarding link."
          action={
            canCreateCandidate ? (
              <button
                type="button"
                onClick={() => setRegisterOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Register First Candidate
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Candidate ID</th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('fullName')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Candidate
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Position · Department</th>
                  <th className="py-3 px-4">Recruiter</th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('createdAt')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Applied
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('joiningDate')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Joining Date
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('completionPct')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                    >
                      Progress
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                      <div>{c.candidateCode}</div>
                      {c.isDemo && <span className="text-[11px] font-sans text-slate-400">Demo</span>}
                    </td>
                    <td className="py-3 px-4">
                      <Link
                        to={`/candidates/${c.id}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {c.fullName}
                      </Link>
                      <div className="text-xs text-slate-500">{c.email}</div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-slate-900">{c.position}</div>
                      <div className="text-slate-500">{c.department}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {c.assignedRecruiterName}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      {c.createdAt.slice(0, 10)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      {c.joiningDate}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                      <span className="font-semibold text-slate-900">{c.completionPct}%</span>
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full ml-auto mt-1 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${c.completionPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusIndicator status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canEditCandidate &&
                          c.status !== 'Onboarding Completed' &&
                          c.status !== 'Rejected' && (
                            <button
                              type="button"
                              onClick={() => handleGenerateLink(c)}
                              title={
                                c.hasActiveLink
                                  ? `Generate new link (replaces ${c.tokenPrefix || 'active'}…)`
                                  : 'Generate new onboarding link'
                              }
                              className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        <Link
                          to={`/candidates/${c.id}`}
                          className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-emerald-700 border border-slate-200 rounded-md hover:border-emerald-300 transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="border border-slate-300 rounded px-2 py-1 bg-white text-xs"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Candidate Modal */}
      <Modal
        open={registerOpen}
        onClose={() => {
          setRegisterOpen(false);
          if (searchParams.get('new')) setSearchParams({});
        }}
        title="Register New Candidate"
        subtitle="Creates a candidate profile and generates a unique expiring onboarding link."
      >
        {regError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {regError}
          </div>
        )}
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                value={regForm.fullName}
                onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                placeholder="e.g., Ishaan Deshpande"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                required
                value={regForm.email}
                onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                placeholder="candidate@example.com"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mobile Number *
              </label>
              <input
                type="text"
                required
                value={regForm.mobile}
                onChange={(e) => setRegForm({ ...regForm, mobile: e.target.value })}
                placeholder="+91 98200 12345"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Position Applied For *
              </label>
              <input
                type="text"
                required
                value={regForm.position}
                onChange={(e) => setRegForm({ ...regForm, position: e.target.value })}
                placeholder="Software Engineer"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Department *
              </label>
              <select
                required
                value={regForm.department}
                onChange={(e) => setRegForm({ ...regForm, department: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Joining Date *
              </label>
              <input
                type="date"
                required
                value={regForm.joiningDate}
                onChange={(e) => setRegForm({ ...regForm, joiningDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Recruiter *
              </label>
              <select
                required
                value={regForm.assignedRecruiterId}
                onChange={(e) =>
                  setRegForm({ ...regForm, assignedRecruiterId: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              >
                {recruiters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName} ({r.role.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setRegisterOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={regBusy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-60"
            >
              {regBusy ? 'Registering...' : 'Create & Generate Link'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Onboarding Link Ready Modal */}
      <Modal
        open={Boolean(linkModal)}
        onClose={() => setLinkModal(null)}
        title="Secure Onboarding Link Ready"
        subtitle={linkModal ? `Share this unique URL with ${linkModal.candidateName}.` : ''}
      >
        {linkModal && (
          <div className="space-y-4">
            {!linkModal.emailSent && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Email Has Not Been Sent</p>
                  <p className="mt-0.5 text-amber-800">
                    {linkModal.deliveryNote}
                  </p>
                </div>
              </div>
            )}

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <p className="text-xs font-semibold text-slate-600 mb-1.5">
                Unique Candidate Invitation URL (No candidate PII exposed in parameters)
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={linkModal.onboardingUrl}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-800"
                />
                <button
                  type="button"
                  onClick={() => handleCopyUrl(linkModal.onboardingUrl)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0B192C] text-white text-xs font-semibold rounded-md hover:bg-[#132946] cursor-pointer whitespace-nowrap"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy Invitation Link'}
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <p>
                <span className="font-semibold text-slate-800">Expires At:</span>{' '}
                <span className="font-mono">{new Date(linkModal.expiresAt).toLocaleString()}</span>
              </p>
              <p>
                <span className="font-semibold text-slate-800">Email Delivery:</span>{' '}
                <span className={linkModal.emailSent ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-800'}>
                  {linkModal.emailSent ? 'Sent via SMTP' : 'Not Sent (Manual Share Required)'}
                </span>
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <a
                href={linkModal.onboardingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                Open Candidate Form
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setLinkModal(null)}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
