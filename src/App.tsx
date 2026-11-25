import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ToastViewport } from './components/ui/Primitives.tsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import ActivateAccountPage from './pages/ActivateAccountPage.tsx';
import AuditLogsPage from './pages/AuditLogsPage.tsx';
import CandidateDetailPage from './pages/CandidateDetailPage.tsx';
import CandidateOnboardingPage from './pages/CandidateOnboardingPage.tsx';
import CandidatesPage from './pages/CandidatesPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import DocumentVerificationPage from './pages/DocumentVerificationPage.tsx';
import EmployeesPage from './pages/EmployeesPage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import NotificationsPage from './pages/NotificationsPage.tsx';
import {
  AttendanceLeavePage,
  EmployeeProfilePage,
  MeetingsCommsPage,
  PayrollFinancePage,
} from './pages/OperationsPages.tsx';
import { AccountSecurityPage, SystemConfigPage } from './pages/SettingsPage.tsx';
import TeamManagementPage from './pages/TeamManagementPage.tsx';
import { getDashboardPathForRole, hasPermission } from './shared/rbac.ts';
import { AppModule, PermissionAction, StaffRole } from './shared/types.ts';

function RequireStaff({
  children,
  roles,
  module,
  action = 'view',
}: {
  children: React.ReactNode;
  roles?: StaffRole[];
  module?: AppModule;
  action?: PermissionAction;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Loading 9HR India Portal...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.mustChangePassword) {
    return <Navigate to="/login" replace />;
  }

  const roleHome = getDashboardPathForRole(user.role);

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={roleHome} replace />;
  }

  if (module && !hasPermission(user.effectivePermissions, module, action)) {
    return <Navigate to={roleHome} replace />;
  }

  return <>{children}</>;
}

function DashboardRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/login" replace />;
  return <Navigate to={getDashboardPathForRole(user.role)} replace />;
}

function AppRoutes() {
  const { user, toasts, dismissToast } = useAuth();
  const homePath = user
    ? user.mustChangePassword
      ? '/login'
      : getDashboardPathForRole(user.role)
    : '/login';

  return (
    <>
      <Routes>
        {/* Public Token-Gated Candidate Onboarding & Account Activation */}
        <Route path="/onboard/:token" element={<CandidateOnboardingPage />} />
        <Route path="/activate/:token" element={<ActivateAccountPage />} />

        {/* Staff Login */}
        <Route
          path="/login"
          element={
            user && !user.mustChangePassword ? (
              <Navigate to={getDashboardPathForRole(user.role)} replace />
            ) : (
              <LoginPage />
            )
          }
        />

        {/* Role-Specific Dashboard Routes (Reusing 3D UI Dashboard) */}
        <Route
          path="/super-admin/dashboard"
          element={
            <RequireStaff roles={['SUPER_ADMIN']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <RequireStaff roles={['ADMIN']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/hr/dashboard"
          element={
            <RequireStaff roles={['HR']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/recruiter/dashboard"
          element={
            <RequireStaff roles={['RECRUITER']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/payroll/dashboard"
          element={
            <RequireStaff roles={['PAYROLL']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/manager/dashboard"
          element={
            <RequireStaff roles={['MANAGER']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/finance/dashboard"
          element={
            <RequireStaff roles={['FINANCE']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />
        <Route
          path="/employee/dashboard"
          element={
            <RequireStaff roles={['EMPLOYEE']} module="dashboard">
              <DashboardPage />
            </RequireStaff>
          }
        />

        {/* Backward-compatible /dashboard redirect */}
        <Route path="/dashboard" element={<DashboardRedirect />} />

        {/* Onboarding & Directory Routes */}
        <Route
          path="/candidates"
          element={
            <RequireStaff module="candidates" action="view">
              <CandidatesPage />
            </RequireStaff>
          }
        />
        <Route
          path="/candidates/:id"
          element={
            <RequireStaff module="candidates" action="view">
              <CandidateDetailPage />
            </RequireStaff>
          }
        />
        <Route
          path="/documents"
          element={
            <RequireStaff module="documents" action="view">
              <DocumentVerificationPage />
            </RequireStaff>
          }
        />
        <Route
          path="/employees"
          element={
            <RequireStaff module="employees" action="view">
              {user?.role === 'EMPLOYEE' ? <EmployeeProfilePage /> : <EmployeesPage />}
            </RequireStaff>
          }
        />
        <Route
          path="/my-profile"
          element={
            <RequireStaff module="employees" action="view">
              <EmployeeProfilePage />
            </RequireStaff>
          }
        />

        {/* Operational Modules */}
        <Route
          path="/attendance"
          element={
            <RequireStaff module="attendance" action="view">
              <AttendanceLeavePage defaultTab="attendance" />
            </RequireStaff>
          }
        />
        <Route
          path="/leave"
          element={
            <RequireStaff module="leave" action="view">
              <AttendanceLeavePage defaultTab="leave" />
            </RequireStaff>
          }
        />
        <Route
          path="/payroll"
          element={
            <RequireStaff module="payroll" action="view">
              <PayrollFinancePage mode="payroll" />
            </RequireStaff>
          }
        />
        <Route
          path="/finance"
          element={
            <RequireStaff module="finance" action="view">
              <PayrollFinancePage mode="finance" />
            </RequireStaff>
          }
        />
        <Route
          path="/meetings"
          element={
            <RequireStaff module="meetings" action="view">
              <MeetingsCommsPage defaultTab="meetings" />
            </RequireStaff>
          }
        />
        <Route
          path="/communications"
          element={
            <RequireStaff module="communications" action="view">
              <MeetingsCommsPage defaultTab="messages" />
            </RequireStaff>
          }
        />

        {/* Notifications, Team, Audit, Security & Config */}
        <Route
          path="/notifications"
          element={
            <RequireStaff>
              <NotificationsPage />
            </RequireStaff>
          }
        />
        <Route
          path="/team"
          element={
            <RequireStaff module="users" action="view">
              <TeamManagementPage />
            </RequireStaff>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <RequireStaff module="audit_logs" action="view">
              <AuditLogsPage />
            </RequireStaff>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireStaff>
              <AccountSecurityPage />
            </RequireStaff>
          }
        />
        <Route
          path="/system-config"
          element={
            <RequireStaff module="settings" action="edit">
              <SystemConfigPage />
            </RequireStaff>
          }
        />

        {/* Default & Catch-all */}
        <Route path="/" element={<Navigate to={homePath} replace />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
