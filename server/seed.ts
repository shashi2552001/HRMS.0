import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/shared/rbac.ts';
import {
  AttendanceRecord,
  Candidate,
  CandidateDocument,
  Employee,
  InternalMessage,
  LeaveRequest,
  MeetingRecord,
  NotificationRecord,
  OnboardingToken,
  PayrollRun,
  StatusHistoryEntry,
} from '../src/shared/types.ts';
import { calculateCompletionPercentage } from '../src/shared/validation.ts';
import {
  assertSafeRuntimeEnvironment,
  getRuntimeSecurityConfig,
  isFirebaseConfigured,
} from './config.ts';
import { isSmtpConfigured } from './mailer.ts';
import { hashPasswordSync, hashTokenSha256, StaffUserRecord } from './security.ts';
import type { PortalDatabase } from './store.ts';

function createSamplePdfBuffer(title: string, subtitle: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, '');
  const safeSub = subtitle.replace(/[()\\]/g, '');
  const streamContent = `BT /F1 18 Tf 50 740 Td (${safeTitle}) Tj 0 -28 Td /F1 12 Tf (${safeSub}) Tj 0 -24 Td (9HR India Pvt. Ltd. - Verified Sample Document) Tj ET`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(streamContent, 'utf8')} >> stream\n${streamContent}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj + '\n';
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAADklEQVQI12NgYGBgYAAAAAUAAY3vW9QAAAAASUVORK5CYII=';

export function buildEmptyDatabase(): PortalDatabase {
  const rt = getRuntimeSecurityConfig();
  const nowIso = new Date().toISOString();
  return {
    users: [
      {
        id: 'usr-sa-google',
        loginId: '9HR-SA-002',
        email: 'itsdemoid00@gmail.com',
        fullName: '9HR Portal Owner',
        role: 'SUPER_ADMIN',
        department: 'Executive Management',
        status: 'ACTIVE',
        isActive: true,
        mustChangePassword: false,
        isDemo: false,
        passwordHash: hashPasswordSync(crypto.randomBytes(24).toString('hex')),
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    candidates: [],
    tokens: [],
    documents: [],
    statusHistory: [],
    employees: [],
    notifications: [],
    auditLogs: [],
    sessions: [],
    loginAttempts: {},
    loginHistory: [],
    activationTokens: [],
    rolePermissions: structuredClone(DEFAULT_ROLE_PERMISSIONS),
    attendance: [],
    leaveRequests: [],
    payrollRuns: [],
    meetings: [],
    messages: [],
    config: {
      defaultLinkExpiryHours: 72,
      maxUploadSizeMb: 5,
      departments: [
        'Engineering',
        'Human Resources',
        'Talent Acquisition',
        'Payroll & Compliance',
        'Finance & Accounts',
        'Operations',
        'Sales & Growth',
        'Quality Assurance',
        'Product Design',
      ],
      smtpConfigured: isSmtpConfigured(),
      firebaseConfigured: isFirebaseConfigured(),
      demoModeEnabled: rt.demoModeEnabled,
      sessionIdleTimeoutMinutes: rt.sessionIdleTimeoutMinutes,
      sessionMaxLifetimeHours: rt.sessionMaxLifetimeHours,
      loginMaxAttempts: rt.loginMaxAttempts,
      loginLockoutMinutes: rt.loginLockoutMinutes,
      updatedAt: nowIso,
    },
    counters: {
      candidateSeq: 1000,
      employeeSeq: 0,
      staffSeq: 2,
    },
  };
}

/**
 * Idempotent demo account & showcase dataset seeder.
 * - Never overwrites existing accounts.
 * - Only runs when DEMO_SEED_ENABLED is active in non-production environments.
 */
export function seedDemoAccounts(db: PortalDatabase, uploadDir: string): { seededUsers: number } {
  const rt = getRuntimeSecurityConfig();
  if (!rt.demoSeedEnabled || rt.isProduction) {
    return { seededUsers: 0 };
  }

  fs.mkdirSync(uploadDir, { recursive: true });
  const now = new Date();
  const iso = (daysOffset = 0, hoursOffset = 0) =>
    new Date(now.getTime() + daysOffset * 86400000 + hoursOffset * 3600000).toISOString();

  const demoAccounts: StaffUserRecord[] = [
    {
      id: 'usr-sa-001',
      loginId: '9HR-SA-001',
      email: 'superadmin@9hrindia.com',
      fullName: 'Vikramaditya Rao',
      role: 'SUPER_ADMIN',
      department: 'Executive Management',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Super2026'),
      createdAt: iso(-90),
      updatedAt: iso(-10),
      lastLoginAt: iso(-1),
    },
    {
      id: 'usr-adm-001',
      loginId: '9HR-ADM-001',
      email: 'admin@9hrindia.com',
      fullName: 'Ananya Deshmukh',
      role: 'ADMIN',
      department: 'People Operations',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Admin2026'),
      createdAt: iso(-60),
      updatedAt: iso(-5),
      lastLoginAt: iso(-1),
    },
    {
      id: 'usr-hr-001',
      loginId: '9HR-HR-001',
      email: 'priya.sharma@9hrindia.com',
      fullName: 'Priya Sharma',
      role: 'HR',
      department: 'Human Resources',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@HR2026'),
      createdAt: iso(-45),
      updatedAt: iso(-2),
      lastLoginAt: iso(0, -3),
    },
    {
      id: 'usr-hr-002',
      loginId: '9HR-HR-002',
      email: 'rohit.verma@9hrindia.com',
      fullName: 'Rohit Verma',
      role: 'HR',
      department: 'Human Resources',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@HR2026'),
      createdAt: iso(-40),
      updatedAt: iso(-3),
    },
    {
      id: 'usr-rec-001',
      loginId: '9HR-REC-001',
      email: 'recruiter@9hrindia.com',
      fullName: 'Kavya Menon',
      role: 'RECRUITER',
      department: 'Talent Acquisition',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Rec2026'),
      createdAt: iso(-35),
      updatedAt: iso(-2),
    },
    {
      id: 'usr-pay-001',
      loginId: '9HR-PAY-001',
      email: 'payroll@9hrindia.com',
      fullName: 'Rajeshwari Iyer',
      role: 'PAYROLL',
      department: 'Payroll & Compliance',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Pay2026'),
      createdAt: iso(-35),
      updatedAt: iso(-2),
    },
    {
      id: 'usr-mgr-001',
      loginId: '9HR-MGR-001',
      email: 'manager@9hrindia.com',
      fullName: 'Arvind Subramanian',
      role: 'MANAGER',
      department: 'Engineering',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Mgr2026'),
      createdAt: iso(-35),
      updatedAt: iso(-2),
    },
    {
      id: 'usr-fin-001',
      loginId: '9HR-FIN-001',
      email: 'finance@9hrindia.com',
      fullName: 'Siddharth Bansal',
      role: 'FINANCE',
      department: 'Finance & Accounts',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Fin2026'),
      createdAt: iso(-35),
      updatedAt: iso(-2),
    },
    {
      id: 'usr-emp-001',
      loginId: '9HR-EMP-001',
      email: 'aarav.kulkarni@example.in',
      fullName: 'Aarav Kulkarni',
      role: 'EMPLOYEE',
      department: 'Engineering',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      reportingManagerId: 'usr-mgr-001',
      reportingManagerName: 'Arvind Subramanian',
      employeeId: 'emp-001',
      employeeCode: '9HR-EMP-2026-0001',
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Emp2026'),
      createdAt: iso(-20),
      updatedAt: iso(-5),
    },
    {
      id: 'usr-emp-002',
      loginId: '9HR-EMP-002',
      email: 'sneha.nair@example.in',
      fullName: 'Sneha Nair',
      role: 'EMPLOYEE',
      department: 'Finance & Accounts',
      status: 'ACTIVE',
      isActive: true,
      mustChangePassword: false,
      reportingManagerId: 'usr-adm-001',
      reportingManagerName: 'Ananya Deshmukh',
      employeeId: 'emp-002',
      employeeCode: '9HR-EMP-2026-0002',
      isDemo: true,
      passwordHash: hashPasswordSync('NineHR@Emp2026#2'),
      createdAt: iso(-15),
      updatedAt: iso(-4),
    },
  ];

  let seededUsers = 0;
  for (const acct of demoAccounts) {
    const exists = db.users.some(
      (u) =>
        u.id === acct.id ||
        u.loginId.toLowerCase() === acct.loginId.toLowerCase() ||
        u.email.toLowerCase() === acct.email.toLowerCase()
    );
    if (!exists) {
      db.users.push(acct);
      seededUsers += 1;
    }
  }

  return { seededUsers };
}

export function buildSeedDatabase(uploadDir: string): PortalDatabase {
  const rt = getRuntimeSecurityConfig();
  fs.mkdirSync(uploadDir, { recursive: true });

  const db = buildEmptyDatabase();
  if (!rt.demoSeedEnabled) {
    return db;
  }

  seedDemoAccounts(db, uploadDir);

  const now = new Date();
  const iso = (daysOffset = 0, hoursOffset = 0) =>
    new Date(now.getTime() + daysOffset * 86400000 + hoursOffset * 3600000).toISOString();

  const writeSampleFile = (key: string, title: string, sub: string, isPng = false) => {
    const filePath = path.join(uploadDir, key);
    if (!fs.existsSync(filePath)) {
      if (isPng) {
        fs.writeFileSync(filePath, Buffer.from(SAMPLE_PNG_BASE64, 'base64'));
      } else {
        fs.writeFileSync(filePath, createSamplePdfBuffer(title, sub));
      }
    }
  };

  const makeBlankCandidate = (
    id: string,
    code: string,
    fullName: string,
    email: string,
    mobile: string,
    position: string,
    department: string,
    joiningDate: string,
    recruiterId: string,
    recruiterName: string,
    status: Candidate['status'],
    createdDaysAgo: number
  ): Candidate => ({
    id,
    candidateCode: code,
    fullName,
    email,
    mobile,
    position,
    department,
    joiningDate,
    assignedRecruiterId: recruiterId,
    assignedRecruiterName: recruiterName,
    status,
    completionPct: 0,
    isDemo: true,
    createdByIsDemo: true,
    createdAt: iso(-createdDaysAgo),
    updatedAt: iso(-Math.max(0, createdDaysAgo - 1)),
    personalInfo: {
      fullName,
      dateOfBirth: '',
      gender: '',
      mobileNumber: mobile,
      email,
      maritalStatus: '',
    },
    addressInfo: {
      currentAddress: '',
      permanentAddress: '',
      sameAsCurrent: false,
      city: '',
      state: '',
      pinCode: '',
    },
    familyInfo: {
      fatherName: '',
      motherName: '',
      spouseName: '',
      emergencyContactName: '',
      emergencyContactRelation: '',
      emergencyContactPhone: '',
    },
    educationInfo: {
      highestQualification: '',
      collegeUniversity: '',
      passingYear: '',
      percentageOrCgpa: '',
    },
    employmentInfo: {
      isFresher: false,
      previousCompany: '',
      previousDesignation: '',
      previousExperience: '',
      lastWorkingDate: '',
      previousSalary: '',
    },
    bankDetails: {
      accountHolderName: '',
      bankName: '',
      accountNumber: '',
      ifscCode: '',
    },
    declaration: {
      accepted: false,
      digitalSignature: '',
    },
  });

  const c1 = makeBlankCandidate(
    'cand-001',
    '9HR-CND-1001',
    'Aarav Kulkarni',
    'aarav.kulkarni@example.in',
    '+91 98201 44510',
    'Senior Full-Stack Engineer',
    'Engineering',
    '2026-12-01',
    'usr-hr-001',
    'Priya Sharma',
    'Onboarding Completed',
    35
  );
  c1.personalInfo = {
    fullName: 'Aarav Kulkarni',
    dateOfBirth: '1995-04-14',
    gender: 'Male',
    mobileNumber: '+91 98201 44510',
    email: 'aarav.kulkarni@example.in',
    maritalStatus: 'Married',
  };
  c1.addressInfo = {
    currentAddress: '402 Emerald Heights, Baner Road',
    permanentAddress: '402 Emerald Heights, Baner Road',
    sameAsCurrent: true,
    city: 'Pune',
    state: 'Maharashtra',
    pinCode: '411045',
  };
  c1.familyInfo = {
    fatherName: 'Suresh Kulkarni',
    motherName: 'Meera Kulkarni',
    spouseName: 'Neha Kulkarni',
    emergencyContactName: 'Neha Kulkarni',
    emergencyContactRelation: 'Spouse',
    emergencyContactPhone: '+91 98201 44511',
  };
  c1.educationInfo = {
    highestQualification: 'B.Tech Computer Science',
    collegeUniversity: 'COEP Technological University, Pune',
    passingYear: '2017',
    percentageOrCgpa: '8.7 CGPA',
  };
  c1.employmentInfo = {
    isFresher: false,
    previousCompany: 'Infosys Finacle',
    previousDesignation: 'Technology Lead',
    previousExperience: '6.5 Years',
    lastWorkingDate: '2026-11-15',
    previousSalary: '22 LPA',
  };
  c1.bankDetails = {
    accountHolderName: 'Aarav Kulkarni',
    bankName: 'HDFC Bank',
    accountNumber: '50100456789123',
    ifscCode: 'HDFC0000104',
  };
  c1.declaration = {
    accepted: true,
    digitalSignature: 'Aarav Kulkarni',
    submittedAt: iso(-28),
  };
  c1.employeeId = 'emp-001';
  c1.employeeCode = '9HR-EMP-2026-0001';

  const c2 = makeBlankCandidate(
    'cand-002',
    '9HR-CND-1002',
    'Sneha Nair',
    'sneha.nair@example.in',
    '+91 98450 77812',
    'Financial Controller',
    'Finance & Accounts',
    '2026-12-01',
    'usr-hr-001',
    'Priya Sharma',
    'Onboarding Completed',
    28
  );
  c2.personalInfo = {
    fullName: 'Sneha Nair',
    dateOfBirth: '1993-09-22',
    gender: 'Female',
    mobileNumber: '+91 98450 77812',
    email: 'sneha.nair@example.in',
    maritalStatus: 'Single',
  };
  c2.addressInfo = {
    currentAddress: '18 Indiranagar 2nd Stage',
    permanentAddress: '12 MG Road, Kochi',
    sameAsCurrent: false,
    city: 'Bengaluru',
    state: 'Karnataka',
    pinCode: '560038',
  };
  c2.familyInfo = {
    fatherName: 'Rajesh Nair',
    motherName: 'Lakshmi Nair',
    spouseName: '',
    emergencyContactName: 'Rajesh Nair',
    emergencyContactRelation: 'Father',
    emergencyContactPhone: '+91 94470 22310',
  };
  c2.educationInfo = {
    highestQualification: 'Chartered Accountant (CA)',
    collegeUniversity: 'ICAI',
    passingYear: '2018',
    percentageOrCgpa: '68%',
  };
  c2.employmentInfo = {
    isFresher: false,
    previousCompany: 'Deloitte India',
    previousDesignation: 'Audit Manager',
    previousExperience: '6 Years',
    lastWorkingDate: '2026-11-10',
    previousSalary: '24 LPA',
  };
  c2.bankDetails = {
    accountHolderName: 'Sneha Nair',
    bankName: 'ICICI Bank',
    accountNumber: '00090155667788',
    ifscCode: 'ICIC0000009',
  };
  c2.declaration = {
    accepted: true,
    digitalSignature: 'Sneha Nair',
    submittedAt: iso(-22),
  };
  c2.employeeId = 'emp-002';
  c2.employeeCode = '9HR-EMP-2026-0002';

  const c3 = makeBlankCandidate(
    'cand-003',
    '9HR-CND-1003',
    'Rohan Malhotra',
    'rohan.malhotra@example.in',
    '+91 98112 33490',
    'DevOps Architect',
    'Engineering',
    '2026-12-08',
    'usr-rec-001',
    'Kavya Menon',
    'Approved',
    14
  );
  c3.personalInfo = {
    fullName: 'Rohan Malhotra',
    dateOfBirth: '1994-02-11',
    gender: 'Male',
    mobileNumber: '+91 98112 33490',
    email: 'rohan.malhotra@example.in',
    maritalStatus: 'Single',
  };
  c3.addressInfo = {
    currentAddress: 'Tower B-1102, DLF Cyber City Phase 3',
    permanentAddress: 'Tower B-1102, DLF Cyber City Phase 3',
    sameAsCurrent: true,
    city: 'Gurugram',
    state: 'Haryana',
    pinCode: '122002',
  };
  c3.familyInfo = {
    fatherName: 'Anil Malhotra',
    motherName: 'Sunita Malhotra',
    spouseName: '',
    emergencyContactName: 'Anil Malhotra',
    emergencyContactRelation: 'Father',
    emergencyContactPhone: '+91 98112 00112',
  };
  c3.educationInfo = {
    highestQualification: 'B.E. Information Technology',
    collegeUniversity: 'Delhi Technological University',
    passingYear: '2016',
    percentageOrCgpa: '8.4 CGPA',
  };
  c3.employmentInfo = {
    isFresher: false,
    previousCompany: 'Razorpay',
    previousDesignation: 'Senior Site Reliability Engineer',
    previousExperience: '7 Years',
    lastWorkingDate: '2026-11-30',
    previousSalary: '28 LPA',
  };
  c3.bankDetails = {
    accountHolderName: 'Rohan Malhotra',
    bankName: 'Axis Bank',
    accountNumber: '918010023456789',
    ifscCode: 'UTIB0000131',
  };
  c3.declaration = {
    accepted: true,
    digitalSignature: 'Rohan Malhotra',
    submittedAt: iso(-5),
  };

  const c4 = makeBlankCandidate(
    'cand-004',
    '9HR-CND-1004',
    'Meera Krishnan',
    'meera.krishnan@example.in',
    '+91 97909 55123',
    'Product Designer',
    'Product Design',
    '2026-12-15',
    'usr-rec-001',
    'Kavya Menon',
    'Submitted',
    9
  );
  c4.personalInfo = {
    fullName: 'Meera Krishnan',
    dateOfBirth: '1997-11-05',
    gender: 'Female',
    mobileNumber: '+91 97909 55123',
    email: 'meera.krishnan@example.in',
    maritalStatus: 'Single',
  };
  c4.addressInfo = {
    currentAddress: '24 Adyar Boat Club Road',
    permanentAddress: '24 Adyar Boat Club Road',
    sameAsCurrent: true,
    city: 'Chennai',
    state: 'Tamil Nadu',
    pinCode: '600028',
  };
  c4.familyInfo = {
    fatherName: 'Venkat Krishnan',
    motherName: 'Radha Krishnan',
    spouseName: '',
    emergencyContactName: 'Venkat Krishnan',
    emergencyContactRelation: 'Father',
    emergencyContactPhone: '+91 97909 11220',
  };
  c4.educationInfo = {
    highestQualification: 'M.Des Interaction Design',
    collegeUniversity: 'IIT Bombay',
    passingYear: '2021',
    percentageOrCgpa: '9.1 CGPA',
  };
  c4.employmentInfo = {
    isFresher: false,
    previousCompany: 'Freshworks',
    previousDesignation: 'UX Designer II',
    previousExperience: '4 Years',
    lastWorkingDate: '2026-12-05',
    previousSalary: '18 LPA',
  };
  c4.bankDetails = {
    accountHolderName: 'Meera Krishnan',
    bankName: 'State Bank of India',
    accountNumber: '309812345678',
    ifscCode: 'SBIN0000800',
  };
  c4.declaration = {
    accepted: true,
    digitalSignature: 'Meera Krishnan',
    submittedAt: iso(-2),
  };

  const c5 = makeBlankCandidate(
    'cand-005',
    '9HR-CND-1005',
    'Siddharth Joshi',
    'siddharth.joshi@example.in',
    '+91 99224 88109',
    'Enterprise Account Executive',
    'Sales & Growth',
    '2026-12-10',
    'usr-hr-001',
    'Priya Sharma',
    'Correction Required',
    11
  );
  c5.correctionNotes =
    'Your uploaded PAN Card scan was blurred and IFSC code needs verification against your cancelled cheque. Please re-upload a clear PAN Card scan and resubmit.';
  c5.personalInfo = {
    fullName: 'Siddharth Joshi',
    dateOfBirth: '1996-07-19',
    gender: 'Male',
    mobileNumber: '+91 99224 88109',
    email: 'siddharth.joshi@example.in',
    maritalStatus: 'Single',
  };
  c5.addressInfo = {
    currentAddress: '705 Koregaon Park Annexe',
    permanentAddress: '705 Koregaon Park Annexe',
    sameAsCurrent: true,
    city: 'Pune',
    state: 'Maharashtra',
    pinCode: '411001',
  };
  c5.familyInfo = {
    fatherName: 'Prakash Joshi',
    motherName: 'Kavita Joshi',
    spouseName: '',
    emergencyContactName: 'Prakash Joshi',
    emergencyContactRelation: 'Father',
    emergencyContactPhone: '+91 99224 10001',
  };
  c5.educationInfo = {
    highestQualification: 'MBA Marketing',
    collegeUniversity: 'Symbiosis Institute of Business Management',
    passingYear: '2020',
    percentageOrCgpa: '8.2 CGPA',
  };
  c5.employmentInfo = {
    isFresher: false,
    previousCompany: 'Zoho Corp',
    previousDesignation: 'Account Executive',
    previousExperience: '4.5 Years',
    lastWorkingDate: '2026-11-28',
    previousSalary: '15 LPA',
  };
  c5.bankDetails = {
    accountHolderName: 'Siddharth Joshi',
    bankName: 'Kotak Mahindra Bank',
    accountNumber: '112233445566',
    ifscCode: 'KKBK0000721',
  };
  c5.declaration = {
    accepted: true,
    digitalSignature: 'Siddharth Joshi',
    submittedAt: iso(-4),
  };

  const c6 = makeBlankCandidate(
    'cand-006',
    '9HR-CND-1006',
    'Divya Bansal',
    'divya.bansal@example.in',
    '+91 98711 60432',
    'QA Automation Lead',
    'Quality Assurance',
    '2026-12-18',
    'usr-hr-002',
    'Rohit Verma',
    'Documents Pending',
    7
  );
  c6.personalInfo = {
    fullName: 'Divya Bansal',
    dateOfBirth: '1995-12-03',
    gender: 'Female',
    mobileNumber: '+91 98711 60432',
    email: 'divya.bansal@example.in',
    maritalStatus: 'Married',
  };
  c6.addressInfo = {
    currentAddress: 'Sector 62, Noida',
    permanentAddress: 'Sector 62, Noida',
    sameAsCurrent: true,
    city: 'Noida',
    state: 'Uttar Pradesh',
    pinCode: '201309',
  };
  c6.familyInfo = {
    fatherName: 'Harish Bansal',
    motherName: 'Rekha Bansal',
    spouseName: 'Gaurav Agarwal',
    emergencyContactName: 'Gaurav Agarwal',
    emergencyContactRelation: 'Spouse',
    emergencyContactPhone: '+91 98711 60433',
  };
  c6.educationInfo = {
    highestQualification: 'B.Tech Electronics',
    collegeUniversity: 'NIT Kurukshetra',
    passingYear: '2017',
    percentageOrCgpa: '8.5 CGPA',
  };
  c6.employmentInfo = {
    isFresher: false,
    previousCompany: 'BrowserStack',
    previousDesignation: 'Senior SDET',
    previousExperience: '6 Years',
    lastWorkingDate: '2026-12-05',
    previousSalary: '20 LPA',
  };
  c6.bankDetails = {
    accountHolderName: 'Divya Bansal',
    bankName: 'HDFC Bank',
    accountNumber: '50100998877665',
    ifscCode: 'HDFC0001204',
  };

  const c7 = makeBlankCandidate(
    'cand-007',
    '9HR-CND-1007',
    'Kabir Chatterjee',
    'kabir.chatterjee@example.in',
    '+91 98300 41298',
    'Operations Specialist',
    'Operations',
    '2026-12-20',
    'usr-rec-001',
    'Kavya Menon',
    'In Progress',
    4
  );
  c7.personalInfo = {
    fullName: 'Kabir Chatterjee',
    dateOfBirth: '1999-05-27',
    gender: 'Male',
    mobileNumber: '+91 98300 41298',
    email: 'kabir.chatterjee@example.in',
    maritalStatus: 'Single',
  };
  c7.addressInfo = {
    currentAddress: 'Salt Lake Sector V',
    permanentAddress: 'Salt Lake Sector V',
    sameAsCurrent: true,
    city: 'Kolkata',
    state: 'West Bengal',
    pinCode: '700091',
  };

  const c8 = makeBlankCandidate(
    'cand-008',
    '9HR-CND-1008',
    'Nandini Reddy',
    'nandini.reddy@example.in',
    '+91 90001 77421',
    'HR Business Partner',
    'Human Resources',
    '2026-12-22',
    'usr-hr-001',
    'Priya Sharma',
    'Link Sent',
    2
  );

  const c9 = makeBlankCandidate(
    'cand-009',
    '9HR-CND-1009',
    'Arjun Mehta',
    'arjun.mehta@example.in',
    '+91 98250 19822',
    'Backend Software Engineer',
    'Engineering',
    '2026-12-28',
    'usr-hr-002',
    'Rohit Verma',
    'Draft',
    1
  );

  const c10 = makeBlankCandidate(
    'cand-010',
    '9HR-CND-1010',
    'Farhan Qureshi',
    'farhan.qureshi@example.in',
    '+91 98920 33114',
    'Operations Coordinator',
    'Operations',
    '2026-11-25',
    'usr-hr-002',
    'Rohit Verma',
    'Rejected',
    20
  );

  db.candidates = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10];

  const documents: CandidateDocument[] = [];
  const addDemoDoc = (
    id: string,
    cand: Candidate,
    category: CandidateDocument['category'],
    filename: string,
    status: CandidateDocument['verificationStatus'],
    reason?: string
  ) => {
    const isPng = filename.endsWith('.png');
    const storageKey = `demo_${cand.id}_${id}_${filename}`;
    writeSampleFile(storageKey, `${cand.fullName} - ${category}`, `Candidate ${cand.candidateCode}`, isPng);
    documents.push({
      id,
      candidateId: cand.id,
      category,
      originalName: filename,
      mimeType: isPng ? 'image/png' : 'application/pdf',
      sizeBytes: isPng ? 14280 : 48200,
      storageKey,
      verificationStatus: status,
      rejectionReason: reason,
      uploadedAt: iso(-5),
      verifiedAt: status !== 'Pending' ? iso(-2) : undefined,
      verifiedByName: status !== 'Pending' ? 'Priya Sharma' : undefined,
      history:
        status !== 'Pending'
          ? [
              {
                id: `vh-${id}`,
                status,
                reviewedById: 'usr-hr-001',
                reviewedByName: 'Priya Sharma',
                reason,
                timestamp: iso(-2),
              },
            ]
          : [],
    });
  };

  const reqCats: CandidateDocument['category'][] = [
    'Passport Size Photograph',
    'Aadhaar Card',
    'PAN Card',
    'Resume',
    'Educational Certificates',
    'Bank Proof',
  ];

  reqCats.forEach((cat, idx) => {
    const ext = cat === 'Passport Size Photograph' ? 'png' : 'pdf';
    addDemoDoc(`doc-c1-${idx}`, c1, cat, `${cat.toLowerCase().replace(/\s+/g, '_')}.${ext}`, 'Approved');
    addDemoDoc(`doc-c2-${idx}`, c2, cat, `${cat.toLowerCase().replace(/\s+/g, '_')}.${ext}`, 'Approved');
    addDemoDoc(`doc-c3-${idx}`, c3, cat, `${cat.toLowerCase().replace(/\s+/g, '_')}.${ext}`, 'Approved');
    addDemoDoc(`doc-c4-${idx}`, c4, cat, `${cat.toLowerCase().replace(/\s+/g, '_')}.${ext}`, 'Pending');
  });

  addDemoDoc('doc-c5-1', c5, 'Passport Size Photograph', 'photo.png', 'Approved');
  addDemoDoc('doc-c5-2', c5, 'Aadhaar Card', 'aadhaar.pdf', 'Approved');
  addDemoDoc(
    'doc-c5-3',
    c5,
    'PAN Card',
    'pan_scan.pdf',
    'Rejected',
    'PAN number is blurred and unreadable. Please upload a high-resolution scan.'
  );
  addDemoDoc('doc-c5-4', c5, 'Resume', 'resume.pdf', 'Approved');
  addDemoDoc('doc-c5-5', c5, 'Educational Certificates', 'degree.pdf', 'Approved');
  addDemoDoc('doc-c5-6', c5, 'Bank Proof', 'cheque.pdf', 'Pending');

  addDemoDoc('doc-c6-1', c6, 'Passport Size Photograph', 'photo.png', 'Approved');
  addDemoDoc('doc-c6-2', c6, 'Resume', 'divya_resume.pdf', 'Pending');

  db.documents = documents;

  for (const c of db.candidates) {
    const cDocs = db.documents.filter((d) => d.candidateId === c.id);
    c.completionPct = calculateCompletionPercentage(c, cDocs);
  }

  // Tokens stored strictly as SHA-256 hashes (never plaintext in DB!)
  const makeHashedToken = (
    id: string,
    candidateId: string,
    rawToken: string,
    expiresDays: number,
    createdDaysAgo: number,
    createdByName: string,
    lastAccessedDaysAgo?: number
  ): OnboardingToken => ({
    id,
    candidateId,
    tokenHash: hashTokenSha256(rawToken),
    tokenPrefix: rawToken.slice(0, 10),
    expiresAt: iso(expiresDays),
    isRevoked: false,
    createdAt: iso(createdDaysAgo),
    createdByName,
    ...(lastAccessedDaysAgo !== undefined ? { lastAccessedAt: iso(lastAccessedDaysAgo) } : {}),
  });

  db.tokens = [
    makeHashedToken('tok-c4', 'cand-004', '9hr-demo-submitted-meera-2026', 14, -9, 'Rohit Verma', -2),
    makeHashedToken('tok-c5', 'cand-005', '9hr-demo-correction-siddharth-2026', 14, -11, 'Priya Sharma', -1),
    makeHashedToken('tok-c7', 'cand-007', '9hr-demo-inprogress-kabir-2026', 14, -4, 'Priya Sharma', -1),
    makeHashedToken('tok-c8', 'cand-008', '9hr-demo-linksent-nandini-2026', 14, -2, 'Priya Sharma'),
    makeHashedToken('tok-expired', 'cand-009', '9hr-demo-expired-link-2026', -3, -10, 'Rohit Verma'),
  ];

  const employees: Employee[] = [
    {
      id: 'emp-001',
      employeeCode: '9HR-EMP-2026-0001',
      candidateId: 'cand-001',
      candidateCode: '9HR-CND-1001',
      userId: 'usr-emp-001',
      reportingManagerId: 'usr-mgr-001',
      reportingManagerName: 'Arvind Subramanian',
      fullName: c1.fullName,
      email: c1.email,
      mobile: c1.mobile,
      position: c1.position,
      department: c1.department,
      joiningDate: c1.joiningDate,
      assignedRecruiterName: c1.assignedRecruiterName,
      personalInfo: c1.personalInfo,
      addressInfo: c1.addressInfo,
      familyInfo: c1.familyInfo,
      educationInfo: c1.educationInfo,
      employmentInfo: c1.employmentInfo,
      bankDetails: c1.bankDetails,
      monthlyCtc: 165000,
      isDemo: true,
      createdByIsDemo: true,
      createdById: 'usr-adm-001',
      createdByName: 'Ananya Deshmukh',
      createdAt: iso(-20),
      updatedAt: iso(-20),
    },
    {
      id: 'emp-002',
      employeeCode: '9HR-EMP-2026-0002',
      candidateId: 'cand-002',
      candidateCode: '9HR-CND-1002',
      userId: 'usr-emp-002',
      reportingManagerId: 'usr-adm-001',
      reportingManagerName: 'Ananya Deshmukh',
      fullName: c2.fullName,
      email: c2.email,
      mobile: c2.mobile,
      position: c2.position,
      department: c2.department,
      joiningDate: c2.joiningDate,
      assignedRecruiterName: c2.assignedRecruiterName,
      personalInfo: c2.personalInfo,
      addressInfo: c2.addressInfo,
      familyInfo: c2.familyInfo,
      educationInfo: c2.educationInfo,
      employmentInfo: c2.employmentInfo,
      bankDetails: c2.bankDetails,
      monthlyCtc: 185000,
      isDemo: true,
      createdByIsDemo: true,
      createdById: 'usr-adm-001',
      createdByName: 'Ananya Deshmukh',
      createdAt: iso(-15),
      updatedAt: iso(-15),
    },
  ];
  db.employees = employees;

  const attendance: AttendanceRecord[] = [
    {
      id: 'att-001',
      employeeId: 'emp-001',
      employeeCode: '9HR-EMP-2026-0001',
      employeeName: 'Aarav Kulkarni',
      userId: 'usr-emp-001',
      department: 'Engineering',
      reportingManagerId: 'usr-mgr-001',
      date: iso(-1).slice(0, 10),
      status: 'PRESENT',
      checkIn: '09:18',
      checkOut: '18:22',
      approvalStatus: 'APPROVED',
      approvedById: 'usr-mgr-001',
      approvedByName: 'Arvind Subramanian',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-1),
    },
    {
      id: 'att-002',
      employeeId: 'emp-002',
      employeeCode: '9HR-EMP-2026-0002',
      employeeName: 'Sneha Nair',
      userId: 'usr-emp-002',
      department: 'Finance & Accounts',
      reportingManagerId: 'usr-adm-001',
      date: iso(-1).slice(0, 10),
      status: 'PRESENT',
      checkIn: '09:30',
      checkOut: '18:35',
      approvalStatus: 'APPROVED',
      approvedById: 'usr-adm-001',
      approvedByName: 'Ananya Deshmukh',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-1),
    },
  ];
  db.attendance = attendance;

  const leaveRequests: LeaveRequest[] = [
    {
      id: 'lv-001',
      employeeId: 'emp-001',
      employeeCode: '9HR-EMP-2026-0001',
      employeeName: 'Aarav Kulkarni',
      userId: 'usr-emp-001',
      department: 'Engineering',
      reportingManagerId: 'usr-mgr-001',
      leaveType: 'CASUAL',
      startDate: '2026-12-04',
      endDate: '2026-12-05',
      days: 2,
      reason: 'Family travel to Mumbai',
      status: 'PENDING',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-2),
      updatedAt: iso(-2),
    },
    {
      id: 'lv-002',
      employeeId: 'emp-002',
      employeeCode: '9HR-EMP-2026-0002',
      employeeName: 'Sneha Nair',
      userId: 'usr-emp-002',
      department: 'Finance & Accounts',
      reportingManagerId: 'usr-adm-001',
      leaveType: 'EARNED',
      startDate: '2026-12-10',
      endDate: '2026-12-11',
      days: 2,
      reason: 'Personal appointment',
      status: 'APPROVED',
      reviewedById: 'usr-adm-001',
      reviewedByName: 'Ananya Deshmukh',
      reviewNote: 'Approved by People Operations.',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-4),
      updatedAt: iso(-3),
    },
  ];
  db.leaveRequests = leaveRequests;

  const payrollRuns: PayrollRun[] = [
    {
      id: 'pay-2026-10',
      monthLabel: 'October 2026',
      period: '2026-10',
      status: 'PAID',
      locked: true,
      totalGross: 350000,
      totalDeductions: 49200,
      totalNetPay: 300800,
      employeeCount: 2,
      createdById: 'usr-pay-001',
      createdByName: 'Rajeshwari Iyer',
      submittedById: 'usr-pay-001',
      submittedByName: 'Rajeshwari Iyer',
      submittedAt: iso(-12),
      financeReviewedById: 'usr-fin-001',
      financeReviewedByName: 'Siddharth Bansal',
      financeReviewedAt: iso(-11),
      financeNote: 'Totals reconciled against bank funding account.',
      finalApprovedById: 'usr-sa-001',
      finalApprovedByName: 'Vikramaditya Rao',
      finalApprovedAt: iso(-10),
      paymentReleasedById: 'usr-fin-001',
      paymentReleasedByName: 'Siddharth Bansal',
      paymentReleasedAt: iso(-9),
      entries: [
        {
          id: 'pe-10-1',
          payrollRunId: 'pay-2026-10',
          employeeId: 'emp-001',
          employeeCode: '9HR-EMP-2026-0001',
          employeeName: 'Aarav Kulkarni',
          userId: 'usr-emp-001',
          department: 'Engineering',
          bankAccountMasked: '••••••••9123',
          ifscCode: 'HDFC0000104',
          basicSalary: 82500,
          hra: 41250,
          allowances: 41250,
          lopDays: 0,
          lopDeduction: 0,
          pfDeduction: 9900,
          esiDeduction: 0,
          professionalTax: 200,
          tdsDeduction: 12000,
          grossEarnings: 165000,
          totalDeductions: 22100,
          netPay: 142900,
          paymentStatus: 'PAID',
          paymentReference: 'NEFT9HR2610001',
          isDemo: true,
        },
        {
          id: 'pe-10-2',
          payrollRunId: 'pay-2026-10',
          employeeId: 'emp-002',
          employeeCode: '9HR-EMP-2026-0002',
          employeeName: 'Sneha Nair',
          userId: 'usr-emp-002',
          department: 'Finance & Accounts',
          bankAccountMasked: '••••••••7788',
          ifscCode: 'ICIC0000009',
          basicSalary: 92500,
          hra: 46250,
          allowances: 46250,
          lopDays: 0,
          lopDeduction: 0,
          pfDeduction: 11100,
          esiDeduction: 0,
          professionalTax: 200,
          tdsDeduction: 15800,
          grossEarnings: 185000,
          totalDeductions: 27100,
          netPay: 157900,
          paymentStatus: 'PAID',
          paymentReference: 'NEFT9HR2610002',
          isDemo: true,
        },
      ],
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-13),
      updatedAt: iso(-9),
    },
  ];
  db.payrollRuns = payrollRuns;

  const meetings: MeetingRecord[] = [
    {
      id: 'mtg-001',
      title: 'Engineering Sprint & Onboarding Sync',
      type: 'TEAM_MEETING',
      scheduledAt: iso(1, 3),
      durationMinutes: 45,
      organizerId: 'usr-mgr-001',
      organizerName: 'Arvind Subramanian',
      organizerRole: 'MANAGER',
      participantIds: ['usr-mgr-001', 'usr-emp-001'],
      participantNames: ['Arvind Subramanian', 'Aarav Kulkarni'],
      meetingLink: '/meetings/room-eng-sync',
      notes: 'Weekly sprint handoff and architecture walkthrough.',
      status: 'SCHEDULED',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-1),
    },
    {
      id: 'mtg-002',
      title: 'Candidate Technical Debrief — Meera Krishnan',
      type: 'INTERVIEW',
      scheduledAt: iso(2, 2),
      durationMinutes: 30,
      organizerId: 'usr-rec-001',
      organizerName: 'Kavya Menon',
      organizerRole: 'RECRUITER',
      participantIds: ['usr-rec-001', 'usr-hr-001'],
      participantNames: ['Kavya Menon', 'Priya Sharma'],
      candidateId: 'cand-004',
      meetingLink: '/meetings/room-rec-debrief',
      notes: 'Confirm final joining readiness and background check items.',
      status: 'SCHEDULED',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-1),
    },
  ];
  db.meetings = meetings;

  const messages: InternalMessage[] = [
    {
      id: 'msg-001',
      channel: 'MAIL',
      senderId: 'usr-mgr-001',
      senderName: 'Arvind Subramanian',
      senderRole: 'MANAGER',
      recipientId: 'usr-emp-001',
      recipientName: 'Aarav Kulkarni',
      subject: 'Welcome to Engineering Team',
      body: 'Hi Aarav, please review your sprint tasks before tomorrow morning standup.',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(-1),
    },
    {
      id: 'msg-002',
      channel: 'CHAT',
      senderId: 'usr-emp-001',
      senderName: 'Aarav Kulkarni',
      senderRole: 'EMPLOYEE',
      recipientId: 'usr-mgr-001',
      recipientName: 'Arvind Subramanian',
      body: 'Sure Arvind, I have submitted my casual leave request for Dec 4-5 as well.',
      isDemo: true,
      createdByIsDemo: true,
      createdAt: iso(0, -4),
    },
  ];
  db.messages = messages;

  const statusHistory: StatusHistoryEntry[] = [
    {
      id: 'sh-1',
      candidateId: 'cand-001',
      fromStatus: 'Approved',
      toStatus: 'Onboarding Completed',
      changedById: 'usr-adm-001',
      changedByName: 'Ananya Deshmukh',
      changedByRole: 'ADMIN',
      note: 'Generated Employee ID 9HR-EMP-2026-0001 and activated payroll profile.',
      timestamp: iso(-20),
    },
    {
      id: 'sh-2',
      candidateId: 'cand-005',
      fromStatus: 'Submitted',
      toStatus: 'Correction Required',
      changedById: 'usr-hr-001',
      changedByName: 'Priya Sharma',
      changedByRole: 'HR',
      note: 'PAN Card scan blurred. Requested clear replacement.',
      timestamp: iso(-2),
    },
    {
      id: 'sh-3',
      candidateId: 'cand-004',
      fromStatus: 'In Progress',
      toStatus: 'Submitted',
      changedById: 'cand-004',
      changedByName: 'Meera Krishnan',
      changedByRole: 'CANDIDATE',
      note: 'Candidate completed declaration and submitted onboarding package.',
      timestamp: iso(-2),
    },
  ];
  db.statusHistory = statusHistory;

  const notifications: NotificationRecord[] = [
    {
      id: 'notif-1',
      type: 'CANDIDATE_SUBMITTED',
      title: 'Onboarding Submitted: Meera Krishnan',
      message: 'Meera Krishnan (Product Designer) has submitted all 8 steps for HR review.',
      recipientEmail: 'recruiter@9hrindia.com',
      recipientName: 'Kavya Menon',
      candidateId: 'cand-004',
      candidateCode: '9HR-CND-1004',
      deliveryStatus: 'IN_APP_ONLY',
      deliveryNote: 'Recorded in HR portal notification center.',
      isRead: false,
      createdAt: iso(-2),
    },
    {
      id: 'notif-2',
      type: 'CORRECTION_REQUESTED',
      title: 'Correction Requested: Siddharth Joshi',
      message: 'PAN Card scan rejected due to blur. Candidate notified to re-upload.',
      recipientEmail: 'siddharth.joshi@example.in',
      recipientName: 'Siddharth Joshi',
      candidateId: 'cand-005',
      candidateCode: '9HR-CND-1005',
      onboardingUrl: '/onboard/9hr-demo-correction-siddharth-2026',
      deliveryStatus: 'PENDING_MANUAL_SHARE',
      deliveryNote: 'Email has NOT been sent (SMTP is not configured) — share using Copy Invitation Link.',
      isRead: false,
      createdAt: iso(-2),
    },
  ];
  db.notifications = notifications;

  db.auditLogs = [
    {
      id: 'aud-1',
      actorId: 'usr-adm-001',
      actorName: 'Ananya Deshmukh',
      actorRole: 'ADMIN',
      action: 'EMPLOYEE_CREATED',
      targetType: 'EMPLOYEE',
      targetId: '9HR-EMP-2026-0001',
      result: 'SUCCESS',
      details: 'Converted candidate Aarav Kulkarni (9HR-CND-1001) to Employee 9HR-EMP-2026-0001.',
      ipAddress: '127.0.0.1',
      timestamp: iso(-20),
    },
    {
      id: 'aud-2',
      actorId: 'usr-hr-001',
      actorName: 'Priya Sharma',
      actorRole: 'HR',
      action: 'DOCUMENT_REJECTED',
      targetType: 'DOCUMENT',
      targetId: 'doc-c5-3',
      result: 'SUCCESS',
      details: 'Rejected PAN Card for Siddharth Joshi: PAN number is blurred.',
      ipAddress: '127.0.0.1',
      timestamp: iso(-2),
    },
    {
      id: 'aud-3',
      actorId: 'usr-sa-001',
      actorName: 'Vikramaditya Rao',
      actorRole: 'SUPER_ADMIN',
      action: 'SYSTEM_INITIALIZED',
      targetType: 'SYSTEM',
      targetId: 'config',
      result: 'SUCCESS',
      details: 'Initialized 9HR India Onboarding Portal database with controlled demo dataset.',
      ipAddress: '127.0.0.1',
      timestamp: iso(-90),
    },
  ];

  db.counters = {
    candidateSeq: 1010,
    employeeSeq: 2,
    staffSeq: 2,
  };

  return db;
}

// Standalone idempotent CLI entry point: `tsx server/seed.ts`
const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('seed.ts');

if (isMainModule) {
  const rt = assertSafeRuntimeEnvironment();
  const dataDir = path.resolve(rt.dataDir);
  const uploadDir = path.resolve(rt.uploadDir);
  const dbFilePath = path.join(dataDir, 'portal-db.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  let db: PortalDatabase;
  if (fs.existsSync(dbFilePath)) {
    db = JSON.parse(fs.readFileSync(dbFilePath, 'utf8')) as PortalDatabase;
  } else {
    db = buildSeedDatabase(uploadDir);
  }
  const { seededUsers } = seedDemoAccounts(db, uploadDir);
  const tmpPath = `${dbFilePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, dbFilePath);
  console.log(`9HR Seed complete. Added ${seededUsers} missing demo account(s). Total users: ${db.users.length}.`);
}
