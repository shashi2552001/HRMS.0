import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Lock } from 'lucide-react';
import { OnboardingVaultScene } from '../components/three/OnboardingVaultScene.tsx';
import { apiRequest } from '../lib/api.ts';
import { ROLE_LABELS } from '../shared/rbac.ts';
import { StaffRole } from '../shared/types.ts';

interface ActivationPreview {
  loginId: string;
  fullName: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
}

export default function ActivateAccountPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ActivationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiRequest<ActivationPreview>(`/api/auth/activate/${encodeURIComponent(token)}`)
      .then((res) => setInfo(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Invalid activation link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(`/api/auth/activate/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 grid lg:grid-cols-12">
      <div className="lg:col-span-6 relative min-h-[420px] lg:min-h-screen">
        <OnboardingVaultScene />
      </div>

      <div className="lg:col-span-6 flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-7 sm:p-9">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Validating activation link...
            </div>
          ) : completed ? (
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Account Activated
              </h2>
              <p className="text-sm text-slate-600">
                Your 9HR India portal account (<span className="font-mono font-semibold">{info?.loginId}</span>) is now active. Sign in using your Login ID or corporate email and your new password.
              </p>
              <Link
                to="/login"
                className="block w-full text-center py-2.5 px-4 bg-[#0B192C] hover:bg-[#132946] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Continue to Sign In
              </Link>
            </div>
          ) : error && !info ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              <Link
                to="/login"
                className="inline-block text-sm font-semibold text-emerald-700 hover:underline"
              >
                Return to Staff Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleActivate} className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Activate Your 9HR Account
                  </h2>
                  <p className="text-xs text-slate-500">
                    {info?.fullName} · {info ? ROLE_LABELS[info.role] : ''}
                  </p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <p>
                  <span className="text-slate-500">Login ID:</span>{' '}
                  <strong className="font-mono text-slate-900">{info?.loginId}</strong>
                </p>
                <p>
                  <span className="text-slate-500">Email:</span>{' '}
                  <strong className="text-slate-900">{info?.email}</strong>
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Create Password (min 8 chars, letters &amp; numbers)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Choose a strong password"
                    className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirm Password
                </label>
                <input
                  type={showPwd ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {submitting ? 'Activating Account...' : 'Set Password & Activate Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
