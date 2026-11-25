export type StaffRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'HR'
  | 'RECRUITER'
  | 'PAYROLL'
  | 'MANAGER'
  | 'FINANCE'
  | 'EMPLOYEE';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'PENDING_ACTIVATION';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'export'
  | 'download'
  | 'assign'
  | 'manage';

export type AppModule =
  | 'dashboard'
  | 'users'
  | 'roles_permissions'
  | 'candidates'
  | 'documents'
  | 'employees'
  | 'departments'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'finance'
  | 'meetings'
  | 'communications'
  | 'audit_logs'
  | 'settings';

export type ModulePermissions = Partial<Record<AppModule, PermissionAction[]>>;
export type RolePermissionsMap = Record<StaffRole, ModulePermissions>;

export const ONBOARDING_STATUSES = [
  'Draft',
  'Link Sent',
  'In Progress',
  'Submitted',
  'Under Review',
  'Documents Pending',
  'Correction Required',
  'Approved',
  'Onboarding Completed',
  'Rejected',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'Passport Size Photograph',
  'Aadhaar Card',
  'PAN Card',
  'Resume',
  'Educational Certificates',
  'Experience Letter',
  'Relieving Letter',
  'Bank Proof',
  'Other Documents',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const REQUIRED_DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'Passport Size Photograph',
  'Aadhaar Card',
  'PAN Card',
  'Resume',
  'Educational Certificates',
  'Bank Proof',
];

export type DocumentVerificationStatus = 'Pending' | 'Approved' | 'Rejected';

export interface StaffUser {
  id: string;
  loginId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  department: string;
  status: AccountStatus;
  isActive: boolean;
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: string;
  reportingManagerId?: string;
  reportingManagerName?: string;
  employeeId?: string;
  employeeCode?: string;
  customPermissions?: ModulePermissions;
  effectivePermissions?: ModulePermissions;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface LoginHistoryEntry {
  id: string;
  userId: string;
  loginId: string;
  email: string;
  fullName: string;
  role: string;
  method: 'PASSWORD' | 'GOOGLE_SSO' | 'ACTIVATION';
  status: 'SUCCESS' | 'FAILED' | 'LOCKED';
  reason?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

export interface UserSessionInfo {
  id: string;
  userId: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface PersonalInformation {
  fullName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female' | 'Other' | 'Prefer not to say' | '';
  mobileNumber: string;
  email: string;
  maritalStatus: 'Single' | 'Married' | 'Divorced' | 'Widowed' | '';
}

export interface AddressInformation {
  currentAddress: string;
  permanentAddress: string;
  sameAsCurrent: boolean;
  city: string;
  state: string;
  pinCode: string;
}

export interface FamilyInformation {
  fatherName: string;
  motherName: string;
  spouseName?: string;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
}

export interface EducationalInformation {
  highestQualification: string;
  collegeUniversity: string;
  passingYear: string;
  percentageOrCgpa: string;
}

export interface EmploymentInformation {
  isFresher: boolean;
  previousCompany?: string;
  previousDesignation?: string;
  previousExperience?: string;
  lastWorkingDate?: string;
  previousSalary?: string;
}

export interface BankDetails {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  confirmAccountNumber?: string;
  ifscCode: string;
}

export interface DeclarationInformation {
  accepted: boolean;
  digitalSignature: string;
  submittedAt?: string;
}

export interface DocumentVerificationHistoryItem {
  id: string;
  status: DocumentVerificationStatus;
  reviewedById: string;
  reviewedByName: string;
  reason?: string;
  timestamp: string;
}

export interface CandidateDocument {
  id: string;
  candidateId: string;
  category: DocumentCategory;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  verificationStatus: DocumentVerificationStatus;
  rejectionReason?: string;
  uploadedAt: string;
  verifiedAt?: string;
  verifiedByName?: string;
  history: DocumentVerificationHistoryItem[];
}

export interface OnboardingToken {
  id: string;
  candidateId: string;
  tokenHash: string;
  tokenPrefix: string;
  expiresAt: string;
  isRevoked: boolean;
  consumedAt?: string;
  firstAccessedAt?: string;
  redemptionCount?: number;
  createdAt: string;
  createdByName: string;
  lastAccessedAt?: string;
  /** Transient raw token returned ONLY at creation/resend time; never persisted in DB. */
  token?: string;
}

export interface StatusHistoryEntry {
  id: string;
  candidateId: string;
  fromStatus: OnboardingStatus | null;
  toStatus: OnboardingStatus;
  changedById: string;
  changedByName: string;
  changedByRole: string;
  note?: string;
  timestamp: string;
}

export interface Candidate {
  id: string;
  candidateCode: string;
  fullName: string;
  email: string;
  mobile: string;
  position: string;
  department: string;
  joiningDate: string;
  assignedRecruiterId: string;
  assignedRecruiterName: string;
  status: OnboardingStatus;
  completionPct: number;
  correctionNotes?: string;
  employeeId?: string;
  employeeCode?: string;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
  updatedAt: string;
  personalInfo: PersonalInformation;
  addressInfo: AddressInformation;
  familyInfo: FamilyInformation;
  educationInfo: EducationalInformation;
  employmentInfo: EmploymentInformation;
  bankDetails: BankDetails;
  declaration: DeclarationInformation;
}

export interface Employee {
  id: string;
  employeeCode: string;
  candidateId: string;
  candidateCode: string;
  userId?: string;
  reportingManagerId?: string;
  reportingManagerName?: string;
  fullName: string;
  email: string;
  mobile: string;
  position: string;
  department: string;
  joiningDate: string;
  assignedRecruiterName: string;
  personalInfo: PersonalInformation;
  addressInfo: AddressInformation;
  familyInfo: FamilyInformation;
  educationInfo: EducationalInformation;
  employmentInfo: EmploymentInformation;
  bankDetails?: Omit<BankDetails, 'confirmAccountNumber'>;
  monthlyCtc?: number;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId: string;
  department: string;
  reportingManagerId?: string;
  date: string;
  status: 'PRESENT' | 'HALF_DAY' | 'LOP' | 'WORK_FROM_HOME' | 'LEAVE';
  checkIn?: string;
  checkOut?: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedById?: string;
  approvedByName?: string;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId: string;
  department: string;
  reportingManagerId?: string;
  leaveType: 'CASUAL' | 'SICK' | 'EARNED' | 'LOP';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedById?: string;
  reviewedByName?: string;
  reviewNote?: string;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollEntry {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId?: string;
  department: string;
  bankAccountMasked: string;
  ifscCode: string;
  basicSalary: number;
  hra: number;
  allowances: number;
  lopDays: number;
  lopDeduction: number;
  pfDeduction: number;
  esiDeduction: number;
  professionalTax: number;
  tdsDeduction: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  paymentStatus: 'PENDING' | 'PAID';
  paymentReference?: string;
  isDemo: boolean;
}

export interface PayrollRun {
  id: string;
  monthLabel: string;
  period: string; // YYYY-MM
  status: 'DRAFT' | 'SUBMITTED' | 'FINANCE_APPROVED' | 'FINAL_APPROVED' | 'PAID' | 'REJECTED';
  locked: boolean;
  totalGross: number;
  totalDeductions: number;
  totalNetPay: number;
  employeeCount: number;
  createdById: string;
  createdByName: string;
  submittedById?: string;
  submittedByName?: string;
  submittedAt?: string;
  financeReviewedById?: string;
  financeReviewedByName?: string;
  financeReviewedAt?: string;
  financeNote?: string;
  finalApprovedById?: string;
  finalApprovedByName?: string;
  finalApprovedAt?: string;
  paymentReleasedById?: string;
  paymentReleasedByName?: string;
  paymentReleasedAt?: string;
  entries: PayrollEntry[];
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRecord {
  id: string;
  title: string;
  type: 'INTERVIEW' | 'TEAM_MEETING' | 'HR_REVIEW' | 'ALL_HANDS';
  scheduledAt: string;
  durationMinutes: number;
  organizerId: string;
  organizerName: string;
  organizerRole: StaffRole;
  participantIds: string[];
  participantNames: string[];
  candidateId?: string;
  meetingLink: string;
  notes?: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
}

export interface InternalMessage {
  id: string;
  channel: 'CHAT' | 'MAIL' | 'CALL_LOG';
  senderId: string;
  senderName: string;
  senderRole: StaffRole;
  recipientId: string;
  recipientName: string;
  subject?: string;
  body: string;
  isDemo: boolean;
  createdByIsDemo?: boolean;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  type:
    | 'ONBOARDING_INVITATION'
    | 'CANDIDATE_SUBMITTED'
    | 'DOCUMENTS_PENDING'
    | 'DOCUMENT_REJECTED'
    | 'CORRECTION_REQUESTED'
    | 'FINAL_APPROVAL'
    | 'ONBOARDING_COMPLETED'
    | 'ACCOUNT_ACTIVATION'
    | 'SECURITY_ALERT';
  title: string;
  message: string;
  recipientEmail: string;
  recipientName: string;
  candidateId?: string;
  candidateCode?: string;
  onboardingUrl?: string;
  deliveryStatus: 'SENT_SMTP' | 'PENDING_MANUAL_SHARE' | 'IN_APP_ONLY';
  deliveryNote: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType:
    | 'AUTH'
    | 'STAFF'
    | 'CANDIDATE'
    | 'TOKEN'
    | 'DOCUMENT'
    | 'EMPLOYEE'
    | 'SYSTEM'
    | 'PAYROLL'
    | 'FINANCE'
    | 'ATTENDANCE'
    | 'LEAVE'
    | 'RBAC';
  targetId: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  details: string;
  ipAddress: string;
  metadata?: Record<string, string | number | boolean>;
  timestamp: string;
}

export interface SystemConfig {
  defaultLinkExpiryHours: number;
  maxUploadSizeMb: number;
  departments: string[];
  smtpConfigured: boolean;
  firebaseConfigured?: boolean;
  demoModeEnabled: boolean;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeHours: number;
  loginMaxAttempts: number;
  loginLockoutMinutes: number;
  updatedAt: string;
}

export interface AnalyticsSummary {
  kpis: {
    totalCandidates: number;
    newApplications: number;
    pendingOnboarding: number;
    documentsPending: number;
    documentsVerified: number;
    onboardingCompleted: number;
    rejectedApplications: number;
  };
  monthlyStats: Array<{ month: string; registered: number; completed: number }>;
  departmentStats: Array<{ department: string; count: number; completed: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
  conversionFunnel: Array<{ stage: string; count: number; rate: number }>;
}
