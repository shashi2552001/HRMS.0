import React, { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  History,
  KeyRound,
  LogOut,
  Monitor,
  RefreshCw,
  Sliders,
  Trash2,
} from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { ConfirmDialog } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, setStoredToken } from '../lib/api.ts';
import { LoginHistoryEntry, StaffUser, SystemConfig, UserSessionInfo } from '../shared/types.ts';

export function AccountSecurityPage() {
  const { user, commitAuthenticatedUser, logoutAll, addToast } = useAuth();

  // Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);

  // Sessions & Login History
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([]);

  const loadSecurityData = useCallback(async () => {
    try {
      const [sesRes, histRes] = await Promise.all([
        apiRequest<{ sessions: UserSessionInfo[] }>('/api/auth/sessions'),
        apiRequest<{ items: LoginHistoryEntry[] }>('/api/auth/login-history'),
      ]);
      setSessions(sesRes.sessions);
      setLoginHistory(histRes.items);
    } catch {
      // Ignore transient load error
    }
  }, []);

  useEffect(() => {
    loadSecurityData();
  }, [loadSecurityData]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdBusy(true);
    try {
      const res = await apiRequest<{ token: string; user: StaffUser }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setStoredToken(res.token);
      commitAuthenticatedUser(res.user, res.token);
      setCurrentPassword('');
      setNewPassword('');
      addToast({
        title: 'Password Updated',
        description: 'Other device sessions were revoked automatically.',
        type: 'success',
      });
      loadSecurityData();
    } catch (err) {
      addToast({
        title: 'Password Change Failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setPwdBusy(false);
    }
  };

  const handleRevokeSession = async (sid: string) => {
    try {
      await apiRequest(`/api/auth/sessions/${sid}`, { method: 'DELETE' });
      addToast({ title: 'Session revoked', type: 'info' });
      loadSecurityData();
    } catch (err) {
      addToast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  return (
    <AppLayout
      title="Account Security"
      breadcrumb={`${user?.loginId || ''} · Security Preferences, Active Sessions & Login History`}
      primaryAction={
        <button
          type="button"
          onClick={logoutAll}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-4 h-4" />
          Logout All Devices
        </button>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6">
          {/* Change Password */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <KeyRound className="w-4 h-4 text-slate-700" />
              <h2 className="text-base font-bold text-slate-900">Change Password</h2>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password (min 8 chars, letters &amp; numbers)
                </label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 pr-10 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={pwdBusy}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer"
              >
                {pwdBusy ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Active Sessions ({sessions.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Client / IP</th>
                  <th className="py-2.5 px-4">Remember Me</th>
                  <th className="py-2.5 px-4">Last Activity</th>
                  <th className="py-2.5 px-4">Expires</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-800">{s.ipAddress}</div>
                      <div className="text-slate-500 truncate max-w-xs">{s.userAgent}</div>
                    </td>
                    <td className="py-2.5 px-4">{s.rememberMe ? '7 Days' : 'Standard (8h)'}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{new Date(s.lastActivityAt).toLocaleString()}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{new Date(s.expiresAt).toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-right">
                      {s.isCurrent ? (
                        <span className="text-emerald-700 font-semibold">Current Session</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id)}
                          className="inline-flex items-center gap-1 text-red-700 hover:underline cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Personal Login History */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Recent Login History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Method</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">IP Address</th>
                  <th className="py-2.5 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loginHistory.slice(0, 15).map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(h.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 font-mono">{h.method}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          h.status === 'SUCCESS' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{h.ipAddress}</td>
                    <td className="py-2.5 px-4 text-slate-600">{h.reason || 'Authenticated'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export function SystemConfigPage() {
  const { addToast } = useAuth();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [expiryHours, setExpiryHours] = useState(72);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [departmentsText, setDepartmentsText] = useState('');
  const [demoMode, setDemoMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    apiRequest<{ config: SystemConfig }>('/api/config')
      .then((res) => {
        setConfig(res.config);
        setExpiryHours(res.config.defaultLinkExpiryHours);
        setIdleMinutes(res.config.sessionIdleTimeoutMinutes || 30);
        setDepartmentsText(res.config.departments.join('\n'));
        setDemoMode(res.config.demoModeEnabled);
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const departments = departmentsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest<{ config: SystemConfig }>('/api/config', {
        method: 'PATCH',
        body: JSON.stringify({
          defaultLinkExpiryHours: expiryHours,
          sessionIdleTimeoutMinutes: idleMinutes,
          departments,
          demoModeEnabled: demoMode,
        }),
      });
      setConfig(res.config);
      addToast({ title: 'System configuration saved', type: 'success' });
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

  const handleResetDemo = async () => {
    setBusy(true);
    try {
      await apiRequest('/api/demo/reset', { method: 'POST' });
      addToast({
        title: 'Demo dataset restored',
        description: 'Live employee and candidate records were preserved.',
        type: 'success',
      });
      setResetConfirm(false);
    } catch (err) {
      addToast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      title="System Configuration"
      breadcrumb="Super Admin · Portal Policies & Demo Environment"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Sliders className="w-4 h-4 text-slate-700" />
            <h2 className="text-base font-bold text-slate-900">Onboarding &amp; Security Policy Settings</h2>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Onboarding Link Expiry (Hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Session Idle Timeout (Minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={idleMinutes}
                  onChange={(e) => setIdleMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Active Departments (One per line)
              </label>
              <textarea
                rows={6}
                value={departmentsText}
                onChange={(e) => setDepartmentsText(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={demoMode}
                onChange={(e) => setDemoMode(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>Enable Controlled Demonstration Dataset</span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
            >
              {busy ? 'Saving...' : 'Save Configuration'}
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 h-fit">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Environment Diagnostics</h3>
            <p className="text-xs text-slate-500">
              Database Store: <strong>Local JSON (DATA_DIR=./data)</strong>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Authentication: <strong>Local Credentials &amp; Sessions (RBAC)</strong>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              SMTP Relay: <strong>{config?.smtpConfigured ? 'Configured' : 'Optional (Not Configured — Emails Not Sent)'}</strong>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Max Upload Size: <strong>{config?.maxUploadSizeMb ?? 5} MB</strong> (PDF, JPG, PNG)
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Brute-Force Lockout: <strong>{config?.loginMaxAttempts ?? 5} failures / {config?.loginLockoutMinutes ?? 15}m</strong>
            </p>
          </div>
          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Restore Demo Dataset</h3>
            <p className="text-xs text-slate-500 mb-3">
              Resets sample demo candidates and demo employees without affecting live records.
            </p>
            <button
              type="button"
              onClick={() => setResetConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Demo Data
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={resetConfirm}
        onClose={() => setResetConfirm(false)}
        onConfirm={handleResetDemo}
        loading={busy}
        title="Restore Demo Dataset"
        message="Sample demo candidates and demo employees will be restored to their default showcase state. Any live candidates or employees you registered will remain untouched."
        confirmLabel="Restore Demo Data"
      />
    </AppLayout>
  );
}
