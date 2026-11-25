import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, setStoredToken } from '../lib/api.ts';
import { isFirebaseClientConfigured } from '../lib/firebase.ts';
import { Modal } from '../components/ui/Primitives.tsx';
import { OnboardingVaultScene } from '../components/three/OnboardingVaultScene.tsx';
import { getDashboardPathForRole } from '../shared/rbac.ts';
import { StaffUser } from '../shared/types.ts';

export default function LoginPage() {
  const {
    user,
    loginWithCredentials,
    commitAuthenticatedUser,
    loginWithGoogle,
    logout,
    addToast,
  } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // First-login mandatory password change state
  const [currentPwdChange, setCurrentPwdChange] = useState('');
  const [newPwdChange, setNewPwdChange] = useState('');
  const [confirmPwdChange, setConfirmPwdChange] = useState('');
  const [showNewPwdChange, setShowNewPwdChange] = useState(false);

  // Password reset modal state
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<'request' | 'confirm'>('request');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetTokenInput, setResetTokenInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await loginWithCredentials(identifier, password, rememberMe);
      if (res.user) {
        if (res.user.mustChangePassword) {
          setCurrentPwdChange(password);
        } else {
          navigate(res.dashboardPath || getDashboardPathForRole(res.user.role));
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMandatoryPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (newPwdChange !== confirmPwdChange) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: StaffUser }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: currentPwdChange,
          newPassword: newPwdChange,
        }),
      });
      setStoredToken(res.token);
      commitAuthenticatedUser(res.user, res.token);
      addToast({ title: 'Password updated securely', type: 'success' });
      navigate(getDashboardPathForRole(res.user.role));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setGoogleLoading(true);
    try {
      const res = await loginWithGoogle();
      navigate(res.dashboardPath || getDashboardPathForRole(res.user.role));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetMessage('');
    setResetBusy(true);
    try {
      const res = await apiRequest<{
        message: string;
        demoResetToken?: string;
      }>('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: resetIdentifier }),
      });
      setResetMessage(res.message);
      if (res.demoResetToken) {
        setResetTokenInput(res.demoResetToken);
      }
      setResetStep('confirm');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to request password reset.');
    } finally {
      setResetBusy(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');
    setResetBusy(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({
          token: resetTokenInput,
          newPassword: newPasswordInput,
        }),
      });
      addToast({
        title: 'Password Reset Complete',
        description: res.message,
        type: 'success',
      });
      setResetOpen(false);
      setResetStep('request');
      setResetIdentifier('');
      setResetTokenInput('');
      setNewPasswordInput('');
      setResetMessage('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setResetBusy(false);
    }
  };

  const showMandatoryPwdScreen = Boolean(user && user.mustChangePassword);

  return (
    <div className="min-h-screen bg-slate-50 grid lg:grid-cols-12">
      {/* Left Interactive 3D Onboarding Security Vault */}
      <div className="lg:col-span-6 relative min-h-[420px] lg:min-h-screen">
        <OnboardingVaultScene />
      </div>

      {/* Right Authentication Form Panel */}
      <div className="lg:col-span-6 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-7 sm:p-9">
          {showMandatoryPwdScreen ? (
            <form onSubmit={handleMandatoryPasswordChange} className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Password Update Required
                  </h2>
                  <p className="text-xs text-slate-500">
                    {user?.fullName} · {user?.loginId}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                For your security, temporary passwords must be changed on first sign-in before accessing your dashboard.
              </p>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Temporary / Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPwdChange}
                  onChange={(e) => setCurrentPwdChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password (min 8 chars, letters &amp; numbers)
                </label>
                <div className="relative">
                  <input
                    type={showNewPwdChange ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPwdChange}
                    onChange={(e) => setNewPwdChange(e.target.value)}
                    className="w-full px-3.5 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwdChange((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showNewPwdChange ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type={showNewPwdChange ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPwdChange}
                  onChange={(e) => setConfirmPwdChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => logout()}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Sign Out
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {submitting ? 'Updating...' : 'Update & Enter Portal'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  Staff Portal Sign In
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Enter your 9HR Login ID or Corporate Email and temporary/staff password.
                </p>
              </div>

              {errorMsg && (
                <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Login ID or Email Address
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="login-identifier"
                      type="text"
                      required
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Enter Login ID or corporate email"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setResetIdentifier(identifier);
                        setResetStep('request');
                        setResetError('');
                        setResetMessage('');
                        setResetOpen(true);
                      }}
                      className="text-xs font-medium text-emerald-700 hover:text-emerald-800 cursor-pointer"
                    >
                      Forgot / Reset Password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span>Remember this device for 7 days (secure HttpOnly session)</span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-[#0B192C] hover:bg-[#132946] text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {submitting ? 'Signing in...' : 'Sign In to Portal'}
                </button>
              </form>

              {isFirebaseClientConfigured() && (
                <>
                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px bg-slate-200 flex-1" />
                    <span className="text-xs text-slate-400">or</span>
                    <div className="h-px bg-slate-200 flex-1" />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={googleLoading}
                    className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                      />
                    </svg>
                    {googleLoading ? 'Connecting Google...' : 'Sign in with Google SSO'}
                  </button>
                </>
              )}

              <p className="text-xs text-slate-500 mt-5 text-center">
                Candidates do not need an internal account — open the unique onboarding URL shared by your 9HR recruiter.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Password Reset Modal */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset Staff Password"
        subtitle="Verify your Login ID or Email to issue a 15-minute reset token."
      >
        {resetError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{resetError}</span>
          </div>
        )}
        {resetMessage && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{resetMessage}</span>
          </div>
        )}

        {resetStep === 'request' ? (
          <form onSubmit={handleRequestReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Staff Login ID or Corporate Email
              </label>
              <input
                type="text"
                required
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
                placeholder="Enter Login ID or corporate email"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetBusy}
                className="px-4 py-2 text-sm font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer disabled:opacity-60"
              >
                {resetBusy ? 'Issuing Token...' : 'Request Reset Token'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleConfirmReset} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Reset Token
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={resetTokenInput}
                  onChange={(e) => setResetTokenInput(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                New Password (min 8 chars, letters &amp; numbers)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder="Enter a strong new password"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetStep('request')}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={resetBusy}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {resetBusy ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
