import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  History,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  Shield,
} from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { Modal, TableSkeleton } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { ALL_STAFF_ROLES, hasPermission, ROLE_LABELS } from '../shared/rbac.ts';
import {
  AccountStatus,
  AppModule,
  LoginHistoryEntry,
  PermissionAction,
  RolePermissionsMap,
  StaffRole,
  StaffUser,
} from '../shared/types.ts';

export default function TeamManagementPage() {
  const { user, addToast } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    role: 'HR' as StaffRole,
    department: 'Human Resources',
    loginId: '',
    password: '',
    reportingManagerId: '',
    sendActivationLink: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issuedCreds, setIssuedCreds] = useState<{
    loginId: string;
    email: string;
    temporaryPassword?: string;
    activationUrl?: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Login History Modal
  const [historyTarget, setHistoryTarget] = useState<StaffUser | null>(null);
  const [historyItems, setHistoryItems] = useState<LoginHistoryEntry[]>([]);

  // RBAC Matrix Modal (Super Admin)
  const [rbacOpen, setRbacOpen] = useState(false);
  const [rbacData, setRbacData] = useState<{
    rolePermissions: RolePermissionsMap;
    modules: AppModule[];
    actions: PermissionAction[];
  } | null>(null);
  const [selectedRbacRole, setSelectedRbacRole] = useState<StaffRole>('HR');

  const canCreateUser = hasPermission(user?.effectivePermissions, 'users', 'create');
  const canEditUser = hasPermission(user?.effectivePermissions, 'users', 'edit');
  const canManageSessions = hasPermission(user?.effectivePermissions, 'users', 'manage');
  const canConfigRbac = hasPermission(user?.effectivePermissions, 'roles_permissions', 'edit');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ users: StaffUser[] }>('/api/staff');
      setUsers(res.users);
    } catch (err) {
      addToast({
        title: 'Access Error',
        description: err instanceof Error ? err.message : 'Unable to load staff.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        fullName: form.fullName,
        email: form.email,
        role: form.role,
        department: form.department,
        sendActivationLink: form.sendActivationLink,
        ...(form.reportingManagerId ? { reportingManagerId: form.reportingManagerId } : {}),
        ...(form.loginId.trim() ? { loginId: form.loginId.trim() } : {}),
        ...(form.password.trim() && !form.sendActivationLink ? { password: form.password } : {}),
      };
      const res = await apiRequest<{
        user: StaffUser;
        activationUrl?: string;
        temporaryCredentials?: {
          loginId: string;
          email: string;
          temporaryPassword: string;
        };
      }>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setCreateOpen(false);
      setForm({
        fullName: '',
        email: '',
        role: 'HR',
        department: 'Human Resources',
        loginId: '',
        password: '',
        reportingManagerId: '',
        sendActivationLink: false,
      });
      setIssuedCreds({
        loginId: res.user.loginId,
        email: res.user.email,
        temporaryPassword: res.temporaryCredentials?.temporaryPassword,
        activationUrl: res.activationUrl ? `${window.location.origin}${res.activationUrl}` : undefined,
      });
      addToast({ title: `Created ${res.user.loginId}`, type: 'success' });
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create staff account.');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (target: StaffUser, status: AccountStatus) => {
    try {
      await apiRequest(`/api/staff/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      addToast({ title: `${target.loginId} set to ${status}`, type: 'info' });
      loadUsers();
    } catch (err) {
      addToast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleRoleChange = async (target: StaffUser, role: StaffRole) => {
    try {
      await apiRequest(`/api/staff/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      addToast({ title: `Role updated for ${target.loginId}`, type: 'success' });
      loadUsers();
    } catch (err) {
      addToast({
        title: 'Role update failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleResetPassword = async (target: StaffUser) => {
    try {
      const res = await apiRequest<{ user: StaffUser; temporaryPassword?: string }>(
        `/api/staff/${target.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resetPassword: true }),
        }
      );
      if (res.temporaryPassword) {
        setIssuedCreds({
          loginId: res.user.loginId,
          email: res.user.email,
          temporaryPassword: res.temporaryPassword,
        });
      }
      addToast({ title: `Temporary password regenerated for ${target.loginId}`, type: 'success' });
    } catch (err) {
      addToast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleIssueActivationLink = async (target: StaffUser) => {
    try {
      const res = await apiRequest<{ activationUrl: string }>(`/api/staff/${target.id}/activation-link`, {
        method: 'POST',
      });
      setIssuedCreds({
        loginId: target.loginId,
        email: target.email,
        activationUrl: `${window.location.origin}${res.activationUrl}`,
      });
      addToast({ title: `Activation link generated for ${target.loginId}`, type: 'success' });
    } catch (err) {
      addToast({
        title: 'Activation link failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleRevokeSessions = async (target: StaffUser) => {
    try {
      const res = await apiRequest<{ revokedCount: number }>(`/api/staff/${target.id}/revoke-sessions`, {
        method: 'POST',
      });
      addToast({
        title: `Revoked ${res.revokedCount} session(s) for ${target.loginId}`,
        type: 'info',
      });
    } catch (err) {
      addToast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const openLoginHistory = async (target: StaffUser) => {
    setHistoryTarget(target);
    try {
      const res = await apiRequest<{ items: LoginHistoryEntry[] }>(`/api/staff/${target.id}/login-history`);
      setHistoryItems(res.items);
    } catch {
      setHistoryItems([]);
    }
  };

  const openRbacMatrix = async () => {
    setRbacOpen(true);
    try {
      const res = await apiRequest<{
        rolePermissions: RolePermissionsMap;
        modules: AppModule[];
        actions: PermissionAction[];
      }>('/api/rbac/permissions');
      setRbacData(res);
    } catch (err) {
      addToast({
        title: 'Unable to load permissions matrix',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const togglePermissionCell = (mod: AppModule, act: PermissionAction) => {
    if (!rbacData || selectedRbacRole === 'SUPER_ADMIN') return;
    const roleMap = { ...(rbacData.rolePermissions[selectedRbacRole] || {}) };
    const currentActs = roleMap[mod] || [];
    const nextActs = currentActs.includes(act)
      ? currentActs.filter((a) => a !== act)
      : [...currentActs, act];
    if (nextActs.length === 0) {
      delete roleMap[mod];
    } else {
      roleMap[mod] = nextActs;
    }
    setRbacData({
      ...rbacData,
      rolePermissions: {
        ...rbacData.rolePermissions,
        [selectedRbacRole]: roleMap,
      },
    });
  };

  const saveRbacRole = async () => {
    if (!rbacData) return;
    setBusy(true);
    try {
      await apiRequest('/api/rbac/permissions', {
        method: 'PATCH',
        body: JSON.stringify({
          role: selectedRbacRole,
          permissions: rbacData.rolePermissions[selectedRbacRole] || {},
        }),
      });
      addToast({
        title: `Permissions updated for ${ROLE_LABELS[selectedRbacRole]}`,
        description: 'Active sessions for this role were refreshed.',
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const managers = users.filter((u) => ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(u.role));
  const creatableRoles =
    user?.role === 'SUPER_ADMIN'
      ? ALL_STAFF_ROLES
      : ALL_STAFF_ROLES.filter((r) => !['SUPER_ADMIN', 'ADMIN'].includes(r));

  return (
    <AppLayout
      title="Team & Role Management"
      breadcrumb="9HR India Pvt. Ltd. · Staff Accounts, RBAC & Account Lifecycle"
      primaryAction={
        <div className="flex items-center gap-2">
          {canConfigRbac && (
            <button
              type="button"
              onClick={openRbacMatrix}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Shield className="w-4 h-4 text-emerald-600" />
              Role Permissions
            </button>
          )}
          {canCreateUser && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add Staff Account
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <TableSkeleton rows={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Login ID</th>
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {users.map((u) => {
                  const canManage =
                    canEditUser &&
                    (user?.role === 'SUPER_ADMIN' ||
                      (user?.role === 'ADMIN' && !['SUPER_ADMIN', 'ADMIN'].includes(u.role)));
                  const acctStatus = u.status || (u.isActive ? 'ACTIVE' : 'DEACTIVATED');
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-bold text-slate-800 whitespace-nowrap">
                        {u.loginId}
                        {u.isDemo && <div className="text-[10px] font-sans font-normal text-slate-400">Demo Seed</div>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{u.fullName}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                        {user?.role === 'SUPER_ADMIN' && u.id !== user?.id ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u, e.target.value as StaffRole)}
                            className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                          >
                            {ALL_STAFF_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          ROLE_LABELS[u.role] || u.role.replace('_', ' ')
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">{u.department}</td>
                      <td className="py-3 px-4 text-xs">
                        <span
                          className={`font-semibold ${
                            acctStatus === 'ACTIVE'
                              ? 'text-emerald-700'
                              : acctStatus === 'SUSPENDED' || acctStatus === 'PENDING_ACTIVATION'
                                ? 'text-amber-700'
                                : 'text-red-600'
                          }`}
                        >
                          {acctStatus.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openLoginHistory(u)}
                            title="View Login History"
                            className="p-1.5 text-slate-600 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {canManage && u.id !== user?.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleResetPassword(u)}
                                title="Issue new temporary password"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                              >
                                <KeyRound className="w-3 h-3" />
                                Temp Pwd
                              </button>
                              <button
                                type="button"
                                onClick={() => handleIssueActivationLink(u)}
                                title="Generate Single-Use Activation Link"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                              >
                                <Link2 className="w-3 h-3" />
                                Activate Link
                              </button>
                              {canManageSessions && (
                                <button
                                  type="button"
                                  onClick={() => handleRevokeSessions(u)}
                                  title="Revoke All Active Sessions"
                                  className="p-1.5 text-slate-600 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                                >
                                  <LogOut className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <select
                                aria-label={`Account status for ${u.loginId}`}
                                value={acctStatus}
                                onChange={(e) => handleStatusChange(u, e.target.value as AccountStatus)}
                                className="px-2 py-1 text-xs font-semibold border border-slate-300 rounded bg-white"
                              >
                                <option value="ACTIVE">Active</option>
                                <option value="SUSPENDED">Suspended</option>
                                <option value="DEACTIVATED">Deactivated</option>
                              </select>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {u.id === user?.id ? 'Current User' : 'Restricted'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Staff Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Staff Account"
        subtitle="Generates a unique Login ID and temporary credentials or single-use activation link."
      >
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="e.g., Neha Kapoor"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Corporate Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="neha.kapoor@9hrindia.com"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Role *</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {creatableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Department *</label>
              <input
                type="text"
                required
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Reporting Manager</label>
              <select
                value={form.reportingManagerId}
                onChange={(e) => setForm({ ...form, reportingManagerId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">None / Direct Executive</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName} ({ROLE_LABELS[m.role]})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Custom Login ID (optional)
              </label>
              <input
                type="text"
                value={form.loginId}
                onChange={(e) => setForm({ ...form, loginId: e.target.value })}
                placeholder="Auto-generated if blank"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sendActivationLink}
                  onChange={(e) => setForm({ ...form, sendActivationLink: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Issue Single-Use Activation Link</span>
              </label>
            </div>
            {!form.sendActivationLink && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Temporary Password (optional — auto-generated if blank)
                </label>
                <input
                  type="text"
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Leave blank to generate secure temporary password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {busy ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* One-Time Temporary Credentials / Activation Link Modal */}
      <Modal
        open={Boolean(issuedCreds)}
        onClose={() => {
          setIssuedCreds(null);
          setCopied(false);
        }}
        title={issuedCreds?.activationUrl ? 'Single-Use Activation Link Issued' : 'Temporary Login Credentials Issued'}
        subtitle="Share securely. Secrets and tokens are stored hashed and cannot be viewed again."
      >
        {issuedCreds && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs space-y-2 break-all">
              <p>
                <span className="text-slate-500">Login ID:</span>{' '}
                <strong className="text-slate-900">{issuedCreds.loginId}</strong>
              </p>
              <p>
                <span className="text-slate-500">Email:</span>{' '}
                <strong className="text-slate-900">{issuedCreds.email}</strong>
              </p>
              {issuedCreds.temporaryPassword && (
                <p>
                  <span className="text-slate-500">Temporary Password:</span>{' '}
                  <strong className="text-emerald-700">{issuedCreds.temporaryPassword}</strong>
                </p>
              )}
              {issuedCreds.activationUrl && (
                <p>
                  <span className="text-slate-500">Activation URL:</span>{' '}
                  <strong className="text-emerald-700">{issuedCreds.activationUrl}</strong>
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={async () => {
                  const text = issuedCreds.activationUrl
                    ? `9HR India Account Activation\nLogin ID: ${issuedCreds.loginId}\nActivation Link: ${issuedCreds.activationUrl}`
                    : `9HR India Portal Login\nLogin ID: ${issuedCreds.loginId}\nEmail: ${issuedCreds.email}\nTemporary Password: ${issuedCreds.temporaryPassword}`;
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                  addToast({ title: 'Copied to clipboard', type: 'success' });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-lg cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setIssuedCreds(null)}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Staff Login History Modal */}
      <Modal
        open={Boolean(historyTarget)}
        onClose={() => setHistoryTarget(null)}
        title={`Login History · ${historyTarget?.fullName || ''}`}
        subtitle={historyTarget?.loginId}
        maxWidth="max-w-2xl"
      >
        {historyItems.length === 0 ? (
          <p className="text-xs text-slate-500">No login events recorded for this user yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
            {historyItems.map((h) => (
              <div key={h.id} className="py-2.5 flex items-center justify-between gap-4">
                <div>
                  <span className="font-mono font-semibold text-slate-800">{h.status}</span>{' '}
                  <span className="text-slate-500">via {h.method}</span>
                  {h.reason && <div className="text-slate-600">{h.reason}</div>}
                </div>
                <div className="text-right font-mono text-slate-500 shrink-0">
                  <div>{h.ipAddress}</div>
                  <div>{new Date(h.timestamp).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Role Permissions Matrix Modal (Super Admin) */}
      <Modal
        open={rbacOpen}
        onClose={() => setRbacOpen(false)}
        title="Role-Based Access Control (RBAC) Matrix"
        subtitle="Configure module-level permissions per role. Updating permissions revokes active sessions for that role."
        maxWidth="max-w-4xl"
      >
        {rbacData && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {ALL_STAFF_ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRbacRole(r)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                      selectedRbacRole === r
                        ? 'bg-[#0B192C] text-white border-[#0B192C]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
              {selectedRbacRole !== 'SUPER_ADMIN' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveRbacRole}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                >
                  Save {ROLE_LABELS[selectedRbacRole]}
                </button>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[420px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b border-slate-200">
                    <th className="py-2 px-3 font-semibold text-slate-700">Module</th>
                    {rbacData.actions.map((a) => (
                      <th key={a} className="py-2 px-2 text-center font-semibold text-slate-600 capitalize">
                        {a}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rbacData.modules.map((mod) => {
                    const acts = rbacData.rolePermissions[selectedRbacRole]?.[mod] || [];
                    return (
                      <tr key={mod}>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-800">{mod}</td>
                        {rbacData.actions.map((act) => (
                          <td key={act} className="py-2 px-2 text-center">
                            <input
                              type="checkbox"
                              disabled={selectedRbacRole === 'SUPER_ADMIN'}
                              checked={acts.includes(act)}
                              onChange={() => togglePermissionCell(mod, act)}
                              className="rounded border-slate-300 text-emerald-600"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
