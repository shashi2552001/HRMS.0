import React, { useCallback, useEffect, useState } from 'react';
import {
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Plus,
  Send,
  User,
  Video,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { EmptyState, Modal, TableSkeleton } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, getStoredToken } from '../lib/api.ts';
import { hasPermission } from '../shared/rbac.ts';
import {
  AttendanceRecord,
  Employee,
  InternalMessage,
  LeaveRequest,
  MeetingRecord,
  PayrollEntry,
  PayrollRun,
} from '../shared/types.ts';

// ---------------------------------------------------------------------------
// Attendance & Leave Management Page
// ---------------------------------------------------------------------------
export function AttendanceLeavePage({ defaultTab = 'leave' }: { defaultTab?: 'attendance' | 'leave' }) {
  const { user, addToast } = useAuth();
  const [tab, setTab] = useState<'attendance' | 'leave'>(defaultTab);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Apply Leave Modal
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: 'CASUAL' as 'CASUAL' | 'SICK' | 'EARNED' | 'LOP',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    days: 1,
    reason: '',
  });

  // Log Attendance Modal
  const [attOpen, setAttOpen] = useState(false);
  const [attForm, setAttForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    status: 'PRESENT' as AttendanceRecord['status'],
  });

  const canViewAttendance = hasPermission(user?.effectivePermissions, 'attendance', 'view');
  const canCreateAttendance = hasPermission(user?.effectivePermissions, 'attendance', 'create');
  const canViewLeave = hasPermission(user?.effectivePermissions, 'leave', 'view');
  const canCreateLeave = hasPermission(user?.effectivePermissions, 'leave', 'create');
  const canApproveLeave = hasPermission(user?.effectivePermissions, 'leave', 'approve');

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [attRes, lvRes] = await Promise.all([
        canViewAttendance
          ? apiRequest<{ items: AttendanceRecord[] }>('/api/attendance')
          : Promise.resolve({ items: [] }),
        canViewLeave
          ? apiRequest<{ items: LeaveRequest[] }>('/api/leave')
          : Promise.resolve({ items: [] }),
      ]);
      setAttendance(attRes.items);
      setLeaves(lvRes.items);
    } catch (err) {
      addToast({
        title: 'Unable to load records',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [canViewAttendance, canViewLeave, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/leave', {
        method: 'POST',
        body: JSON.stringify(leaveForm),
      });
      setLeaveOpen(false);
      setLeaveForm((f) => ({ ...f, reason: '' }));
      addToast({ title: 'Leave request submitted', type: 'success' });
      loadData();
    } catch (err) {
      addToast({
        title: 'Leave request failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveDecision = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusy(true);
    try {
      await apiRequest(`/api/leave/${id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      addToast({
        title: `Leave ${status.toLowerCase()}`,
        type: status === 'APPROVED' ? 'success' : 'warning',
      });
      loadData();
    } catch (err) {
      addToast({
        title: 'Decision failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLogAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/attendance', {
        method: 'POST',
        body: JSON.stringify(attForm),
      });
      setAttOpen(false);
      addToast({ title: 'Attendance logged', type: 'success' });
      loadData();
    } catch (err) {
      addToast({
        title: 'Failed to log attendance',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      title={tab === 'leave' ? 'Leave Management' : 'Attendance & Work Logs'}
      breadcrumb="9HR India Pvt. Ltd. · Workforce Attendance & Leave"
      primaryAction={
        <div className="flex items-center gap-2">
          {canCreateAttendance && (
            <button
              type="button"
              onClick={() => setAttOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Clock className="w-4 h-4" />
              Log Attendance
            </button>
          )}
          {canCreateLeave && (
            <button
              type="button"
              onClick={() => setLeaveOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Apply Leave
            </button>
          )}
        </div>
      }
    >
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit mb-6">
        {canViewLeave && (
          <button
            type="button"
            onClick={() => setTab('leave')}
            className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'leave' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Leave Requests ({leaves.length})
          </button>
        )}
        {canViewAttendance && (
          <button
            type="button"
            onClick={() => setTab('attendance')}
            className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
              tab === 'attendance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Attendance Records ({attendance.length})
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : tab === 'leave' ? (
        leaves.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-6 h-6" />}
            title="No leave requests found"
            description="Submitted leave requests for your scope appear here."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Employee</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Dates</th>
                    <th className="py-3 px-4 text-right">Days</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {leaves.map((l) => {
                    const isSelf = l.userId === user?.id || (user?.employeeId && l.employeeId === user.employeeId);
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 text-sm">{l.employeeName}</div>
                          <div className="font-mono text-slate-500">
                            {l.employeeCode} · {l.department}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-700">{l.leaveType}</td>
                        <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                          {l.startDate} to {l.endDate}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold">{l.days}</td>
                        <td className="py-3 px-4 text-slate-600 max-w-xs">{l.reason}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`font-semibold ${
                              l.status === 'APPROVED'
                                ? 'text-emerald-700'
                                : l.status === 'REJECTED'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canApproveLeave && l.status === 'PENDING' && !isSelf ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleLeaveDecision(l.id, 'APPROVED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded cursor-pointer"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleLeaveDecision(l.id, 'REJECTED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-semibold rounded cursor-pointer"
                              >
                                <XCircle className="w-3 h-3" />
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              {l.reviewedByName ? `By ${l.reviewedByName}` : isSelf ? 'Self Request' : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : attendance.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-6 h-6" />}
          title="No attendance logs recorded"
          description="Logged attendance entries for your authorized scope appear here."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Work Status</th>
                  <th className="py-3 px-4">Check-In</th>
                  <th className="py-3 px-4">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {attendance.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-slate-700">{a.date}</td>
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900">{a.employeeName}</span>{' '}
                      <span className="font-mono text-slate-500">({a.employeeCode})</span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{a.department}</td>
                    <td className="py-3 px-4 font-semibold text-slate-800">{a.status}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{a.checkIn || '—'}</td>
                    <td className="py-3 px-4 font-semibold text-emerald-700">{a.approvalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Apply for Leave">
        <form onSubmit={handleApplyLeave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Type</label>
              <select
                value={leaveForm.leaveType}
                onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value as LeaveRequest['leaveType'] })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="CASUAL">Casual Leave</option>
                <option value="SICK">Sick Leave</option>
                <option value="EARNED">Earned Leave</option>
                <option value="LOP">Loss of Pay (LOP)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Days</label>
              <input
                type="number"
                min={0.5}
                max={60}
                step={0.5}
                value={leaveForm.days}
                onChange={(e) => setLeaveForm({ ...leaveForm, days: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
              <input
                type="date"
                required
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
              <input
                type="date"
                required
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason *</label>
            <textarea
              rows={3}
              required
              minLength={3}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setLeaveOpen(false)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {busy ? 'Submitting...' : 'Submit Leave'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={attOpen} onClose={() => setAttOpen(false)} title="Log Daily Attendance">
        <form onSubmit={handleLogAttendance} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
            <input
              type="date"
              required
              value={attForm.date}
              onChange={(e) => setAttForm({ ...attForm, date: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
            <select
              value={attForm.status}
              onChange={(e) => setAttForm({ ...attForm, status: e.target.value as AttendanceRecord['status'] })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="PRESENT">Present (Office)</option>
              <option value="WORK_FROM_HOME">Work From Home</option>
              <option value="HALF_DAY">Half Day</option>
              <option value="LOP">Loss of Pay (LOP)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAttOpen(false)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0B192C] rounded-lg cursor-pointer"
            >
              {busy ? 'Saving...' : 'Save Attendance'}
            </button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Payroll & Finance Disbursement Page
// ---------------------------------------------------------------------------
export function PayrollFinancePage({ mode = 'payroll' }: { mode?: 'payroll' | 'finance' }) {
  const { user, addToast } = useAuth();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [monthLabel, setMonthLabel] = useState(
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );
  const [selectedPayslip, setSelectedPayslip] = useState<(PayrollEntry & { monthLabel: string; period: string }) | null>(null);

  const canCreate = hasPermission(user?.effectivePermissions, 'payroll', 'create');
  const canEdit = hasPermission(user?.effectivePermissions, 'payroll', 'edit');
  const canFinalApprove = hasPermission(user?.effectivePermissions, 'payroll', 'approve');
  const canExport = hasPermission(user?.effectivePermissions, 'payroll', 'export') && user?.role !== 'EMPLOYEE';
  const canFinanceApprove = hasPermission(user?.effectivePermissions, 'finance', 'approve');
  const canReleasePayment = hasPermission(user?.effectivePermissions, 'finance', 'manage');

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ runs: PayrollRun[] }>('/api/payroll');
      setRuns(res.runs);
    } catch (err) {
      addToast({
        title: 'Unable to load payroll runs',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/payroll', {
        method: 'POST',
        body: JSON.stringify({ period, monthLabel }),
      });
      setCreateOpen(false);
      addToast({ title: `Created draft payroll for ${monthLabel}`, type: 'success' });
      loadRuns();
    } catch (err) {
      addToast({
        title: 'Create run failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const triggerPayrollAction = async (runId: string, endpoint: string, body?: Record<string, unknown>, label = 'Updated') => {
    setBusy(true);
    try {
      await apiRequest(`/api/payroll/${runId}/${endpoint}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : JSON.stringify({}),
      });
      addToast({ title: label, type: 'success' });
      loadRuns();
    } catch (err) {
      addToast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadBankCsv = async (run: PayrollRun) => {
    try {
      const token = getStoredToken();
      const resp = await fetch(`/api/payroll/${run.id}/bank-export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!resp.ok) throw new Error('Bank export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `9hr-bank-transfer-${run.period}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast({ title: 'Bank CSV exported', type: 'success' });
    } catch (err) {
      addToast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleViewPayslip = async (entryId: string) => {
    try {
      const res = await apiRequest<{ payslip: PayrollEntry & { monthLabel: string; period: string } }>(
        `/api/payroll/payslips/${entryId}`
      );
      setSelectedPayslip(res.payslip);
    } catch (err) {
      addToast({
        title: 'Unable to load payslip',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  return (
    <AppLayout
      title={
        user?.role === 'EMPLOYEE'
          ? 'My Payslips'
          : mode === 'finance'
            ? 'Finance & Salary Disbursement'
            : 'Payroll Management'
      }
      breadcrumb="9HR India Pvt. Ltd. · Compensation, Statutory Deductions & Segregation of Duties"
      primaryAction={
        canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Payroll Draft
          </button>
        )
      }
    >
      {loading ? (
        <TableSkeleton rows={5} />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={<Banknote className="w-6 h-6" />}
          title="No payroll runs available"
          description="Payroll runs and salary statements appear here once generated."
        />
      ) : (
        <div className="space-y-6">
          {runs.map((run) => (
            <div key={run.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50/70">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-base font-bold text-slate-900">{run.monthLabel}</h2>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                      {run.period}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        run.status === 'PAID' || run.status === 'FINAL_APPROVED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : run.status === 'REJECTED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {run.status.replace('_', ' ')}
                    </span>
                    {run.locked && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </div>
                  {user?.role !== 'EMPLOYEE' && (
                    <p className="text-xs text-slate-500 mt-1 font-mono">
                      Gross: ₹{run.totalGross.toLocaleString('en-IN')} · Deductions: ₹
                      {run.totalDeductions.toLocaleString('en-IN')} · Net Payout: ₹
                      {run.totalNetPay.toLocaleString('en-IN')}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && run.status === 'DRAFT' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => triggerPayrollAction(run.id, 'submit', {}, 'Payroll submitted & locked')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer"
                    >
                      Submit for Approval
                    </button>
                  )}
                  {canFinanceApprove && run.status === 'SUBMITTED' && run.submittedById !== user?.id && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerPayrollAction(run.id, 'finance-review', { decision: 'APPROVE' }, 'Finance approved')
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                      >
                        Finance Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          triggerPayrollAction(run.id, 'finance-review', { decision: 'REJECT' }, 'Returned to Draft')
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {canFinalApprove && ['SUBMITTED', 'FINANCE_APPROVED'].includes(run.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => triggerPayrollAction(run.id, 'final-approve', {}, 'Final approval granted')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                    >
                      Super Admin Final Approve
                    </button>
                  )}
                  {canReleasePayment && ['FINAL_APPROVED', 'FINANCE_APPROVED'].includes(run.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => triggerPayrollAction(run.id, 'release-payment', {}, 'Bank payment released')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                    >
                      Release Bank Payout
                    </button>
                  )}
                  {canExport && (
                    <button
                      type="button"
                      onClick={() => handleDownloadBankCsv(run)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Bank CSV
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Employee</th>
                      <th className="py-2.5 px-4">Bank Account</th>
                      <th className="py-2.5 px-4 text-right">Gross (₹)</th>
                      <th className="py-2.5 px-4 text-right">PF / Tax / LOP (₹)</th>
                      <th className="py-2.5 px-4 text-right">Net Pay (₹)</th>
                      <th className="py-2.5 px-4">Payment</th>
                      <th className="py-2.5 px-4 text-right">Payslip</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {run.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{entry.employeeName}</div>
                          <div className="font-mono text-slate-500">
                            {entry.employeeCode} · {entry.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          {entry.bankAccountMasked} ({entry.ifscCode})
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          ₹{entry.grossEarnings.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">
                          -₹{entry.totalDeductions.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold tabular-nums text-emerald-700">
                          ₹{entry.netPay.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={entry.paymentStatus === 'PAID' ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                            {entry.paymentStatus}
                          </span>
                          {entry.paymentReference && (
                            <div className="font-mono text-[10px] text-slate-400">{entry.paymentReference}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleViewPayslip(entry.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200 rounded hover:border-emerald-300 hover:text-emerald-700 cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            View Payslip
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Monthly Payroll Draft">
        <form onSubmit={handleCreateRun} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Period (YYYY-MM)</label>
            <input
              type="text"
              required
              pattern="\d{4}-\d{2}"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Month Label</label>
            <input
              type="text"
              required
              value={monthLabel}
              onChange={(e) => setMonthLabel(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {busy ? 'Generating...' : 'Generate Draft'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(selectedPayslip)}
        onClose={() => setSelectedPayslip(null)}
        title={selectedPayslip ? `Payslip · ${selectedPayslip.monthLabel}` : 'Payslip'}
        subtitle={selectedPayslip ? `${selectedPayslip.employeeName} (${selectedPayslip.employeeCode})` : ''}
      >
        {selectedPayslip && (
          <div className="space-y-3 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <div className="flex justify-between"><span>Basic Salary</span><span className="font-mono">₹{selectedPayslip.basicSalary.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>HRA</span><span className="font-mono">₹{selectedPayslip.hra.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>Allowances</span><span className="font-mono">₹{selectedPayslip.allowances.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between font-semibold border-t border-slate-200 pt-1.5">
                <span>Gross Earnings</span>
                <span className="font-mono">₹{selectedPayslip.grossEarnings.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <div className="flex justify-between"><span>PF Deduction</span><span className="font-mono">₹{selectedPayslip.pfDeduction.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>Professional Tax</span><span className="font-mono">₹{selectedPayslip.professionalTax.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>TDS</span><span className="font-mono">₹{selectedPayslip.tdsDeduction.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span>LOP ({selectedPayslip.lopDays}d)</span><span className="font-mono">₹{selectedPayslip.lopDeduction.toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between font-bold text-emerald-700 border-t border-slate-200 pt-1.5 text-sm">
                <span>Net Salary Credited</span>
                <span className="font-mono">₹{selectedPayslip.netPay.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Meetings & Internal Communications Page
// ---------------------------------------------------------------------------
export function MeetingsCommsPage({ defaultTab = 'meetings' }: { defaultTab?: 'meetings' | 'messages' }) {
  const { user, addToast } = useAuth();
  const [tab, setTab] = useState<'meetings' | 'messages'>(defaultTab);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [directory, setDirectory] = useState<Array<{ id: string; loginId: string; fullName: string; role: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [meetingOpen, setMeetingOpen] = useState(false);
  const [mtgForm, setMtgForm] = useState({
    title: '',
    type: 'TEAM_MEETING' as MeetingRecord['type'],
    scheduledAt: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    durationMinutes: 30,
    participantId: '',
    notes: '',
  });

  const [msgForm, setMsgForm] = useState({
    channel: 'CHAT' as InternalMessage['channel'],
    recipientId: '',
    subject: '',
    body: '',
  });

  const canCreateMeeting = hasPermission(user?.effectivePermissions, 'meetings', 'create');
  const canCreateMessage = hasPermission(user?.effectivePermissions, 'communications', 'create');

  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, msgRes, dirRes] = await Promise.all([
        hasPermission(user?.effectivePermissions, 'meetings', 'view')
          ? apiRequest<{ items: MeetingRecord[] }>('/api/meetings')
          : Promise.resolve({ items: [] }),
        hasPermission(user?.effectivePermissions, 'communications', 'view')
          ? apiRequest<{ items: InternalMessage[] }>('/api/messages')
          : Promise.resolve({ items: [] }),
        apiRequest<{ directory: Array<{ id: string; loginId: string; fullName: string; role: string }> }>('/api/staff/directory'),
      ]);
      setMeetings(mRes.items);
      setMessages(msgRes.items);
      setDirectory(dirRes.directory);
      const firstOther = dirRes.directory.find((d) => d.id !== user?.id)?.id || '';
      setMtgForm((f) => ({ ...f, participantId: f.participantId || firstOther }));
      setMsgForm((f) => ({ ...f, recipientId: f.recipientId || firstOther }));
    } finally {
      setLoading(false);
    }
  }, [user?.effectivePermissions, user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleScheduleMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title: mtgForm.title,
          type: mtgForm.type,
          scheduledAt: new Date(mtgForm.scheduledAt).toISOString(),
          durationMinutes: mtgForm.durationMinutes,
          participantIds: mtgForm.participantId ? [mtgForm.participantId] : [],
          notes: mtgForm.notes,
        }),
      });
      setMeetingOpen(false);
      setMtgForm((f) => ({ ...f, title: '', notes: '' }));
      addToast({ title: 'Meeting scheduled', type: 'success' });
      loadData();
    } catch (err) {
      addToast({
        title: 'Scheduling failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest('/api/messages', {
        method: 'POST',
        body: JSON.stringify(msgForm),
      });
      setMsgForm((f) => ({ ...f, subject: '', body: '' }));
      addToast({ title: 'Message sent', type: 'success' });
      loadData();
    } catch (err) {
      addToast({
        title: 'Send failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      title={tab === 'meetings' ? 'Meetings & Interviews' : 'Internal Communications'}
      breadcrumb="9HR India Pvt. Ltd. · Team Coordination"
      primaryAction={
        canCreateMeeting && (
          <button
            type="button"
            onClick={() => setMeetingOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Video className="w-4 h-4" />
            Schedule Meeting
          </button>
        )
      }
    >
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit mb-6">
        <button
          type="button"
          onClick={() => setTab('meetings')}
          className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
            tab === 'meetings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Meetings ({meetings.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('messages')}
          className={`px-4 py-2 text-xs font-semibold rounded-md cursor-pointer ${
            tab === 'messages' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
          }`}
        >
          Messages &amp; Mail ({messages.length})
        </button>
      </div>

      {loading ? (
        <TableSkeleton rows={4} />
      ) : tab === 'meetings' ? (
        meetings.length === 0 ? (
          <EmptyState
            icon={<Video className="w-6 h-6" />}
            title="No scheduled meetings"
            description="Upcoming interviews, HR reviews, and team meetings appear here."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {meetings.map((m) => (
              <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold text-emerald-700">{m.type.replace('_', ' ')}</span>
                  <span className="text-xs font-mono text-slate-500">{m.durationMinutes} min</span>
                </div>
                <h3 className="text-base font-bold text-slate-900">{m.title}</h3>
                <p className="text-xs text-slate-600">
                  Organizer: <strong>{m.organizerName}</strong> · When:{' '}
                  <span className="font-mono">{new Date(m.scheduledAt).toLocaleString()}</span>
                </p>
                <p className="text-xs text-slate-500">Participants: {m.participantNames.join(', ')}</p>
                {m.notes && <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg">{m.notes}</p>}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {canCreateMessage && (
            <form onSubmit={handleSendMessage} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                New Message
              </h3>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Channel</label>
                <select
                  value={msgForm.channel}
                  onChange={(e) => setMsgForm({ ...msgForm, channel: e.target.value as InternalMessage['channel'] })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="CHAT">Internal Chat</option>
                  <option value="MAIL">Internal Mail</option>
                  <option value="CALL_LOG">Call Note</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Recipient</label>
                <select
                  required
                  value={msgForm.recipientId}
                  onChange={(e) => setMsgForm({ ...msgForm, recipientId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {directory.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.loginId})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={msgForm.subject}
                  onChange={(e) => setMsgForm({ ...msgForm, subject: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Message *</label>
                <textarea
                  rows={3}
                  required
                  value={msgForm.body}
                  onChange={(e) => setMsgForm({ ...msgForm, body: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send Message
              </button>
            </form>
          )}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {messages.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No messages yet.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900">
                      {m.senderName} → {m.recipientName}
                    </span>
                    <span className="font-mono text-slate-400">
                      {m.channel} · {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {m.subject && <p className="text-xs font-semibold text-slate-700">{m.subject}</p>}
                  <p className="text-xs text-slate-600">{m.body}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <Modal open={meetingOpen} onClose={() => setMeetingOpen(false)} title="Schedule Meeting">
        <form onSubmit={handleScheduleMeeting} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
            <input
              type="text"
              required
              minLength={3}
              value={mtgForm.title}
              onChange={(e) => setMtgForm({ ...mtgForm, title: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={mtgForm.type}
                onChange={(e) => setMtgForm({ ...mtgForm, type: e.target.value as MeetingRecord['type'] })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="TEAM_MEETING">Team Meeting</option>
                <option value="INTERVIEW">Interview</option>
                <option value="HR_REVIEW">HR Review</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Duration (Min)</label>
              <input
                type="number"
                min={15}
                max={240}
                value={mtgForm.durationMinutes}
                onChange={(e) => setMtgForm({ ...mtgForm, durationMinutes: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Date &amp; Time</label>
            <input
              type="datetime-local"
              required
              value={mtgForm.scheduledAt}
              onChange={(e) => setMtgForm({ ...mtgForm, scheduledAt: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Participant</label>
            <select
              value={mtgForm.participantId}
              onChange={(e) => setMtgForm({ ...mtgForm, participantId: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {directory.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName} ({d.role.replace('_', ' ')})
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMeetingOpen(false)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {busy ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// Employee Self-Service Profile Page
// ---------------------------------------------------------------------------
export function EmployeeProfilePage() {
  const { user, addToast } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    mobile: '',
    currentAddress: '',
    city: '',
    state: '',
    pinCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: Employee[] }>('/api/employees')
      .then((res) => {
        const own = res.items[0] || null;
        setEmployee(own);
        if (own) {
          setForm({
            mobile: own.mobile,
            currentAddress: own.addressInfo.currentAddress,
            city: own.addressInfo.city,
            state: own.addressInfo.state,
            pinCode: own.addressInfo.pinCode,
            emergencyContactName: own.familyInfo.emergencyContactName,
            emergencyContactPhone: own.familyInfo.emergencyContactPhone,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ employee: Employee }>(`/api/employees/${employee.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setEmployee(res.employee);
      addToast({ title: 'Personal contact details updated', type: 'success' });
    } catch (err) {
      addToast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout
      title="My Employee Profile"
      breadcrumb={`${user?.loginId || ''} · Self-Service Directory`}
    >
      {loading ? (
        <TableSkeleton rows={4} />
      ) : !employee ? (
        <EmptyState
          icon={<User className="w-6 h-6" />}
          title="Employee profile unavailable"
          description="Your employee directory record has not been linked yet."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 text-xs">
            <h2 className="text-base font-bold text-slate-900">Employment &amp; Payroll Details</h2>
            <p><strong>Employee Code:</strong> <span className="font-mono text-emerald-700 font-bold">{employee.employeeCode}</span></p>
            <p><strong>Full Name:</strong> {employee.fullName}</p>
            <p><strong>Corporate Email:</strong> {employee.email}</p>
            <p><strong>Designation:</strong> {employee.position}</p>
            <p><strong>Department:</strong> {employee.department}</p>
            <p><strong>Reporting Manager:</strong> {employee.reportingManagerName || 'Assigned by Admin'}</p>
            <p><strong>Joining Date:</strong> <span className="font-mono">{employee.joiningDate}</span></p>
            {employee.bankDetails && (
              <div className="pt-3 border-t border-slate-100 space-y-1">
                <p className="font-bold text-slate-800">Salary Bank Account</p>
                <p>{employee.bankDetails.bankName} · <span className="font-mono">{employee.bankDetails.accountNumber}</span></p>
                <p>IFSC: <span className="font-mono">{employee.bankDetails.ifscCode}</span></p>
              </div>
            )}
          </div>

          <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Update Personal Contact &amp; Emergency Info</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Number</label>
                <input
                  type="text"
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Current Address</label>
                <input
                  type="text"
                  value={form.currentAddress}
                  onChange={(e) => setForm({ ...form, currentAddress: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">PIN Code</label>
                <input
                  type="text"
                  value={form.pinCode}
                  onChange={(e) => setForm({ ...form, pinCode: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Contact Name</label>
                <input
                  type="text"
                  value={form.emergencyContactName}
                  onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone</label>
                <input
                  type="text"
                  value={form.emergencyContactPhone}
                  onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      )}
    </AppLayout>
  );
}
