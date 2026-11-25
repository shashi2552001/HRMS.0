import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { StaffUser } from '../shared/types.ts';
import { apiRequest, setStoredToken } from '../lib/api.ts';
import { isFirebaseClientConfigured } from '../lib/firebase.ts';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface LoginStepResult {
  user?: StaffUser;
  dashboardPath?: string;
}

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
  loginWithCredentials: (
    identifier: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<LoginStepResult>;
  commitAuthenticatedUser: (user: StaffUser, token?: string) => void;
  loginWithGoogle: () => Promise<{ user: StaffUser; dashboardPath: string }>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      setTimeout(() => {
        dismissToast(id);
      }, 4500);
    },
    [dismissToast]
  );

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiRequest<{ user: StaffUser }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
      setStoredToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hydrate from HttpOnly session cookie if present
    refreshUser();
  }, [refreshUser]);

  const commitAuthenticatedUser = useCallback((nextUser: StaffUser, token?: string) => {
    if (token) setStoredToken(token);
    setUser(nextUser);
  }, []);

  const loginWithCredentials = async (
    identifier: string,
    password: string,
    rememberMe = false
  ): Promise<LoginStepResult> => {
    const res = await apiRequest<{
      token?: string;
      user?: StaffUser;
      dashboardPath?: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, rememberMe }),
    });

    if (res.token && res.user) {
      setStoredToken(res.token);
      setUser(res.user);
      addToast({
        title: `Welcome back, ${res.user.fullName}`,
        description: `Signed in as ${res.user.role.replace('_', ' ')} (${res.user.loginId})`,
        type: 'success',
      });
      return {
        user: res.user,
        dashboardPath: res.dashboardPath,
      };
    }
    return {};
  };

  const loginWithGoogle = async () => {
    if (!isFirebaseClientConfigured()) {
      throw new Error(
        'Google SSO is optional and not configured in this environment. Sign in using your Login ID and Password.'
      );
    }
    throw new Error(
      'Google SSO requires Firebase Web SDK client configuration. Sign in using your Login ID and Password.'
    );
  };

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local cleanup
    }
    setStoredToken(null);
    setUser(null);
    addToast({ title: 'Signed out securely', type: 'info' });
  };

  const logoutAll = async () => {
    try {
      await apiRequest('/api/auth/logout-all', { method: 'POST' });
    } catch {
      // Proceed with local cleanup
    }
    setStoredToken(null);
    setUser(null);
    addToast({ title: 'Logged out of all devices', type: 'info' });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        toasts,
        addToast,
        dismissToast,
        loginWithCredentials,
        commitAuthenticatedUser,
        loginWithGoogle,
        logout,
        logoutAll,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
