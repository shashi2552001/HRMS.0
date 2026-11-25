import {
  AppModule,
  ModulePermissions,
  PermissionAction,
  RolePermissionsMap,
  StaffRole,
} from './types.ts';

export const ALL_STAFF_ROLES: StaffRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR',
  'RECRUITER',
  'PAYROLL',
  'MANAGER',
  'FINANCE',
  'EMPLOYEE',
];

export const ALL_MODULES: AppModule[] = [
  'dashboard',
  'users',
  'roles_permissions',
  'candidates',
  'documents',
  'employees',
  'departments',
  'attendance',
  'leave',
  'payroll',
  'finance',
  'meetings',
  'communications',
  'audit_logs',
  'settings',
];

export const ALL_PERMISSION_ACTIONS: PermissionAction[] = [
  'view',
  'create',
  'edit',
  'delete',
  'approve',
  'reject',
  'export',
  'download',
  'assign',
  'manage',
];

export const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  HR: 'HR Executive',
  RECRUITER: 'Recruiter',
  PAYROLL: 'Payroll Executive',
  MANAGER: 'Reporting Manager',
  FINANCE: 'Finance Executive',
  EMPLOYEE: 'Employee',
};

export const ROLE_DASHBOARD_PATHS: Record<StaffRole, string> = {
  SUPER_ADMIN: '/super-admin/dashboard',
  ADMIN: '/admin/dashboard',
  HR: '/hr/dashboard',
  RECRUITER: '/recruiter/dashboard',
  PAYROLL: '/payroll/dashboard',
  MANAGER: '/manager/dashboard',
  FINANCE: '/finance/dashboard',
  EMPLOYEE: '/employee/dashboard',
};

export function getDashboardPathForRole(role?: StaffRole | null): string {
  if (!role || !(role in ROLE_DASHBOARD_PATHS)) return '/login';
  return ROLE_DASHBOARD_PATHS[role];
}

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMap = {
  SUPER_ADMIN: {
    dashboard: ['view'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    roles_permissions: ['view', 'edit', 'manage'],
    candidates: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'assign', 'manage'],
    documents: ['view', 'create', 'approve', 'reject', 'download', 'manage'],
    employees: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
    departments: ['view', 'create', 'edit', 'delete', 'manage'],
    attendance: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'manage'],
    leave: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'manage'],
    payroll: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'download', 'manage'],
    finance: ['view', 'approve', 'reject', 'export', 'download', 'manage'],
    meetings: ['view', 'create', 'edit', 'delete', 'manage'],
    communications: ['view', 'create'],
    audit_logs: ['view', 'export'],
    settings: ['view', 'edit', 'manage'],
  },
  ADMIN: {
    dashboard: ['view'],
    users: ['view', 'create', 'edit', 'assign'],
    candidates: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'assign'],
    documents: ['view', 'approve', 'reject', 'download'],
    employees: ['view', 'create', 'edit', 'export'],
    departments: ['view', 'create', 'edit', 'delete', 'manage'],
    attendance: ['view', 'create', 'edit', 'approve', 'reject', 'manage'],
    leave: ['view', 'create', 'edit', 'approve', 'reject', 'manage'],
    meetings: ['view', 'create', 'edit', 'delete', 'manage'],
    communications: ['view', 'create'],
    audit_logs: ['view'],
    settings: ['view'],
  },
  HR: {
    dashboard: ['view'],
    candidates: ['view', 'create', 'edit', 'export'],
    documents: ['view', 'approve', 'reject', 'download'],
    employees: ['view', 'create', 'edit', 'export'],
    departments: ['view'],
    attendance: ['view', 'create', 'edit', 'manage'],
    leave: ['view', 'create', 'edit', 'approve', 'reject', 'manage'],
    meetings: ['view', 'create', 'edit'],
    communications: ['view', 'create'],
  },
  RECRUITER: {
    dashboard: ['view'],
    candidates: ['view', 'create', 'edit', 'export'],
    documents: ['view', 'download'],
    meetings: ['view', 'create', 'edit'],
    communications: ['view', 'create'],
  },
  PAYROLL: {
    dashboard: ['view'],
    employees: ['view'],
    attendance: ['view'],
    leave: ['view'],
    payroll: ['view', 'create', 'edit', 'export', 'download'],
    communications: ['view', 'create'],
  },
  MANAGER: {
    dashboard: ['view'],
    employees: ['view'],
    attendance: ['view', 'approve', 'reject'],
    leave: ['view', 'create', 'approve', 'reject'],
    meetings: ['view', 'create', 'edit', 'manage'],
    communications: ['view', 'create'],
  },
  FINANCE: {
    dashboard: ['view'],
    payroll: ['view', 'export', 'download'],
    finance: ['view', 'approve', 'reject', 'export', 'download', 'manage'],
    communications: ['view', 'create'],
  },
  EMPLOYEE: {
    dashboard: ['view'],
    employees: ['view', 'edit'],
    documents: ['view', 'download'],
    attendance: ['view', 'create'],
    leave: ['view', 'create'],
    payroll: ['view', 'download'],
    meetings: ['view'],
    communications: ['view', 'create'],
  },
};

/**
 * Hard security invariants that cannot be overridden even via dynamic role config.
 */
const DISALLOWED_BY_ROLE: Partial<Record<StaffRole, Partial<Record<AppModule, PermissionAction[]>>>> = {
  ADMIN: {
    roles_permissions: ['view', 'edit', 'manage'],
    payroll: ['approve', 'manage'],
    finance: ['approve', 'manage'],
    settings: ['edit', 'manage'],
  },
  HR: {
    payroll: ['view', 'create', 'edit', 'approve', 'reject', 'manage'],
    finance: ['view', 'approve', 'reject', 'manage'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    roles_permissions: ['view', 'edit', 'manage'],
  },
  RECRUITER: {
    payroll: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'download', 'manage'],
    finance: ['view', 'approve', 'reject', 'export', 'download', 'manage'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    audit_logs: ['view', 'export'],
  },
  PAYROLL: {
    payroll: ['approve', 'reject'],
    finance: ['approve', 'reject', 'manage'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    audit_logs: ['view', 'export'],
  },
  MANAGER: {
    payroll: ['view', 'create', 'edit', 'approve', 'reject', 'export', 'download', 'manage'],
    finance: ['view', 'approve', 'reject', 'export', 'download', 'manage'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    audit_logs: ['view', 'export'],
  },
  FINANCE: {
    payroll: ['create', 'edit', 'delete', 'manage'],
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    audit_logs: ['view', 'export'],
  },
  EMPLOYEE: {
    users: ['view', 'create', 'edit', 'delete', 'assign', 'manage'],
    roles_permissions: ['view', 'edit', 'manage'],
    candidates: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'export', 'assign', 'manage'],
    finance: ['view', 'approve', 'reject', 'export', 'download', 'manage'],
    audit_logs: ['view', 'export'],
    settings: ['view', 'edit', 'manage'],
    payroll: ['create', 'edit', 'delete', 'approve', 'reject', 'manage'],
  },
};

export function computeEffectivePermissions(
  role: StaffRole,
  rolePermissions: RolePermissionsMap = DEFAULT_ROLE_PERMISSIONS,
  customPermissions?: ModulePermissions
): ModulePermissions {
  const base = rolePermissions[role] || DEFAULT_ROLE_PERMISSIONS[role] || {};
  const merged: ModulePermissions = {};

  for (const mod of ALL_MODULES) {
    const roleActs = base[mod] || [];
    const customActs = customPermissions?.[mod];
    const combined = customActs !== undefined ? Array.from(new Set(customActs)) : [...roleActs];
    const blocked = DISALLOWED_BY_ROLE[role]?.[mod] || [];
    const filtered = combined.filter((act) => !blocked.includes(act));
    if (filtered.length > 0) {
      merged[mod] = filtered;
    }
  }
  return merged;
}

export function hasPermission(
  permissions: ModulePermissions | undefined,
  module: AppModule,
  action: PermissionAction = 'view'
): boolean {
  if (!permissions) return false;
  const acts = permissions[module];
  if (!acts || acts.length === 0) return false;
  return acts.includes(action) || acts.includes('manage');
}
