import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Banknote,
  Bell,
  Briefcase,
  Calendar,
  Clock,
  FileCheck2,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldAlert,
  Sliders,
  User,
  UserCheck,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { getDashboardPathForRole, hasPermission, ROLE_LABELS } from '../shared/rbac.ts';
import { AppModule, PermissionAction } from '../shared/types.ts';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  module?: AppModule;
  action?: PermissionAction;
  hideForEmployee?: boolean;
  employeeOnly?: boolean;
  badge?: number;
}

export function AppLayout({
  title,
  breadcrumb,
  primaryAction,
  children,
}: {
  title: string;
  breadcrumb?: string;
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    apiRequest<{ unreadCount: number }>('/api/notifications')
      .then((res) => {
        if (active) setUnreadCount(res.unreadCount);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [location.pathname]);

  const dashboardPath = getDashboardPathForRole(user?.role);

  const navItems: NavItem[] = [
    {
      to: dashboardPath,
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
      module: 'dashboard',
    },
    {
      to: '/candidates',
      label: 'Candidates',
      icon: <Users className="w-4 h-4 shrink-0" />,
      module: 'candidates',
    },
    {
      to: '/documents',
      label: 'Document Verification',
      icon: <FileCheck2 className="w-4 h-4 shrink-0" />,
      module: 'documents',
    },
    {
      to: '/employees',
      label: 'Employees',
      icon: <Briefcase className="w-4 h-4 shrink-0" />,
      module: 'employees',
      hideForEmployee: true,
    },
    {
      to: '/my-profile',
      label: 'My Profile',
      icon: <User className="w-4 h-4 shrink-0" />,
      module: 'employees',
      employeeOnly: true,
    },
    {
      to: '/attendance',
      label: 'Attendance',
      icon: <Clock className="w-4 h-4 shrink-0" />,
      module: 'attendance',
    },
    {
      to: '/leave',
      label: 'Leave Requests',
      icon: <Calendar className="w-4 h-4 shrink-0" />,
      module: 'leave',
    },
    {
      to: '/payroll',
      label: user?.role === 'EMPLOYEE' ? 'My Payslips' : 'Payroll',
      icon: <Banknote className="w-4 h-4 shrink-0" />,
      module: 'payroll',
    },
    {
      to: '/finance',
      label: 'Finance & Payouts',
      icon: <Landmark className="w-4 h-4 shrink-0" />,
      module: 'finance',
    },
    {
      to: '/meetings',
      label: 'Meetings',
      icon: <Video className="w-4 h-4 shrink-0" />,
      module: 'meetings',
    },
    {
      to: '/communications',
      label: 'Messages',
      icon: <MessageSquare className="w-4 h-4 shrink-0" />,
      module: 'communications',
    },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: <Bell className="w-4 h-4 shrink-0" />,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    {
      to: '/team',
      label: 'Team & Roles',
      icon: <UserCheck className="w-4 h-4 shrink-0" />,
      module: 'users',
    },
    {
      to: '/audit-logs',
      label: 'Audit & Security',
      icon: <ShieldAlert className="w-4 h-4 shrink-0" />,
      module: 'audit_logs',
    },
    {
      to: '/settings',
      label: 'Account Security',
      icon: <Settings className="w-4 h-4 shrink-0" />,
    },
    {
      to: '/system-config',
      label: 'System Config',
      icon: <Sliders className="w-4 h-4 shrink-0" />,
      module: 'settings',
      action: 'edit',
    },
  ];

  const visibleItems = navItems.filter((item) => {
    if (!user) return false;
    if (item.hideForEmployee && user.role === 'EMPLOYEE') return false;
    if (item.employeeOnly && user.role !== 'EMPLOYEE') return false;
    if (!item.module) return true;
    return hasPermission(user.effectivePermissions, item.module, item.action || 'view');
  });

  const roleLabel = user ? ROLE_LABELS[user.role] || user.role.replace('_', ' ') : 'Staff';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0B192C] text-slate-200 select-none">
      {/* Brand Zone */}
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between gap-3">
        <Link to={dashboardPath} className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-white p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
            <img
              src="/assets/aistudio/image_0ecd2493.png"
              alt="9HR India Pvt. Ltd. Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <span className="block font-display text-base font-bold text-white tracking-tight truncate">
              9HR India
            </span>
            <span className="block text-[11px] text-slate-400 truncate">
              Onboarding Portal
            </span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              }`
            }
          >
            <span className="flex items-center gap-3 min-w-0">
              {item.icon}
              <span className="truncate">{item.label}</span>
            </span>
            {item.badge !== undefined && (
              <span className="font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Signed-in User Footer */}
      <div className="p-4 border-t border-white/10 bg-[#081322]">
        <div className="mb-3 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{user?.fullName}</p>
          <p className="text-xs text-slate-400 truncate">
            {roleLabel} · <span className="font-mono">{user?.loginId}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 bg-white/8 hover:bg-white/15 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              {breadcrumb && (
                <p className="text-xs text-slate-500 truncate">{breadcrumb}</p>
              )}
              <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900 truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {primaryAction}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
