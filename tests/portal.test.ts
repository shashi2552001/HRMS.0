import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { PortalStore } from '../server/store.ts';

function createValidPdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n', 'utf8');
}

describe('9HR India Employee Onboarding Portal — End-to-End API & Security Suite', () => {
  let tmpRoot: string;
  let dataDir: string;
  let uploadDir: string;
  let server: http.Server;
  let baseUrl: string;

  let superAdminToken = '';
  let adminToken = '';
  let hrToken = '';
  let createdCandidateId = '';
  let onboardingToken = '';
  let uploadedDocId = '';

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), '9hr-test-'));
    dataDir = path.join(tmpRoot, 'data');
    uploadDir = path.join(tmpRoot, 'private_uploads');

    const store = new PortalStore({ dataDir, uploadDir });
    const { app } = createApp({ store, disableRateLimit: true });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function api(p: string, init: RequestInit = {}, token?: string) {
    const headers = new Headers(init.headers || {});
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const resp = await fetch(`${baseUrl}${p}`, { ...init, headers });
    const ct = resp.headers.get('content-type') || '';
    const body = ct.includes('application/json')
      ? await resp.json()
      : await resp.text();
    return { status: resp.status, headers: resp.headers, body };
  }

  async function loginStaff(identifier: string, password: string) {
    return api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
  }

  it('1-4. Authenticates Super Admin, Admin, HR and rejects invalid login credentials', async () => {
    const bad = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '9HR-SA-001', password: 'WrongPassword!' }),
    });
    expect(bad.status).toBe(401);

    const sa = await loginStaff('9HR-SA-001', 'NineHR@Super2026');
    expect(sa.status).toBe(200);
    expect(sa.body.user.role).toBe('SUPER_ADMIN');
    superAdminToken = sa.body.token;

    const adm = await loginStaff('admin@9hrindia.com', 'NineHR@Admin2026');
    expect(adm.status).toBe(200);
    expect(adm.body.user.role).toBe('ADMIN');
    adminToken = adm.body.token;

    const hr = await loginStaff('9hr-hr-001', 'NineHR@HR2026');
    expect(hr.status).toBe(200);
    expect(hr.body.user.role).toBe('HR');
    hrToken = hr.body.token;
  });

  it('5. Enforces Role-Based Access Control (blocks unauthorized role access)', async () => {
    // Unauthenticated request blocked
    const unauth = await api('/api/candidates');
    expect(unauth.status).toBe(401);

    // HR cannot access staff management or audit logs or system config
    const hrStaff = await api('/api/staff', {}, hrToken);
    expect(hrStaff.status).toBe(403);

    const hrAudit = await api('/api/audit-logs', {}, hrToken);
    expect(hrAudit.status).toBe(403);

    const hrConfig = await api('/api/config', {
      method: 'PATCH',
      body: JSON.stringify({ defaultLinkExpiryHours: 24 }),
    }, hrToken);
    expect(hrConfig.status).toBe(403);

    // Admin cannot create an ADMIN account (only SUPER_ADMIN can)
    const admCreateAdm = await api('/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Unauthorized Admin',
        email: 'unauth.admin@9hrindia.com',
        role: 'ADMIN',
        department: 'Operations',
      }),
    }, adminToken);
    expect(admCreateAdm.status).toBe(403);
  });

  it('Temp Login ID & Password: Super Admin creates HR with temp password, HR logs in directly, changes password & resets password', async () => {
    const created = await api('/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Temp HR Tester',
        email: 'temphr@9hrindia.com',
        role: 'HR',
        department: 'Human Resources',
      }),
    }, superAdminToken);
    expect(created.status).toBe(201);
    const { loginId, temporaryPassword } = created.body.temporaryCredentials;
    expect(loginId).toMatch(/^9HR-HR-/);
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);

    // First login with temp credentials authenticates directly without 2FA
    const firstLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: loginId, password: temporaryPassword }),
    });
    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.token).toBeTruthy();
    expect(firstLogin.body.dashboardPath).toBe('/hr/dashboard');
    expect(firstLogin.body.user.mustChangePassword).toBe(true);
    const tempToken = firstLogin.body.token;

    // Portal endpoints blocked until mandatory password change completes
    const blockedBeforeChange = await api('/api/candidates', {}, tempToken);
    expect(blockedBeforeChange.status).toBe(403);
    expect(blockedBeforeChange.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // Change temporary password
    const updatedPassword = 'UpdatedHrPassword@2026';
    const pwdChanged = await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: temporaryPassword,
        newPassword: updatedPassword,
      }),
    }, tempToken);
    expect(pwdChanged.status).toBe(200);
    expect(pwdChanged.body.user.mustChangePassword).toBe(false);

    // Login again -> goes straight to authorized dashboard with token
    const directLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: loginId, password: updatedPassword }),
    });
    expect(directLogin.status).toBe(200);
    expect(directLogin.body.token).toBeTruthy();
    expect(directLogin.body.dashboardPath).toBe('/hr/dashboard');

    // Password reset request & confirm
    const resetReq = await api('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ identifier: loginId }),
    });
    expect(resetReq.status).toBe(200);
    expect(resetReq.body.demoResetToken).toBeTruthy();

    const resetConfirm = await api('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({
        token: resetReq.body.demoResetToken,
        newPassword: 'UpdatedNewPassword@2026',
      }),
    });
    expect(resetConfirm.status).toBe(200);

    const postResetLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: loginId, password: 'UpdatedNewPassword@2026' }),
    });
    expect(postResetLogin.status).toBe(200);
    expect(postResetLogin.body.dashboardPath).toBe('/hr/dashboard');
  });

  it('6-9. Candidate registration, secure link generation, candidate access & expired link handling', async () => {
    const reg = await api('/api/candidates', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Vikram Sethi',
        email: 'vikram.sethi@example.in',
        mobile: '+91 98111 22334',
        position: 'Senior Backend Engineer',
        department: 'Engineering',
        joiningDate: '2026-12-20',
        assignedRecruiterId: 'usr-hr-001',
      }),
    }, hrToken);
    expect(reg.status).toBe(201);
    createdCandidateId = reg.body.candidate.id;
    onboardingToken = reg.body.token.token;
    expect(onboardingToken).toHaveLength(64);
    expect(reg.body.candidate.isDemo).toBe(false);

    // Candidate accesses link without any staff login
    const candGet = await api(`/api/onboard/${onboardingToken}`);
    expect(candGet.status).toBe(200);
    expect(candGet.body.candidate.fullName).toBe('Vikram Sethi');

    // Expired link returns 410
    const expired = await api('/api/onboard/9hr-demo-expired-link-2026');
    expect(expired.status).toBe(410);
    expect(expired.body.expired).toBe(true);

    // Invalid link returns 404
    const invalid = await api('/api/onboard/non-existent-token-xyz');
    expect(invalid.status).toBe(404);
  });

  it('10-14. Multi-step autosave, invalid file rejection, valid private document upload, validation & submission', async () => {
    // Autosave steps 1-6
    const autosave = await api(`/api/onboard/${onboardingToken}`, {
      method: 'PATCH',
      body: JSON.stringify({
        personalInfo: {
          fullName: 'Vikram Sethi',
          dateOfBirth: '1994-08-19',
          gender: 'Male',
          mobileNumber: '+91 98111 22334',
          email: 'vikram.sethi@example.in',
          maritalStatus: 'Single',
        },
        addressInfo: {
          currentAddress: '101 Cyber Towers, Hitech City',
          permanentAddress: '101 Cyber Towers, Hitech City',
          sameAsCurrent: true,
          city: 'Hyderabad',
          state: 'Telangana',
          pinCode: '500081',
        },
        familyInfo: {
          fatherName: 'Rakesh Sethi',
          motherName: 'Pooja Sethi',
          spouseName: '',
          emergencyContactName: 'Rakesh Sethi',
          emergencyContactRelation: 'Father',
          emergencyContactPhone: '+91 98111 00001',
        },
        educationInfo: {
          highestQualification: 'B.Tech CSE',
          collegeUniversity: 'IIIT Hyderabad',
          passingYear: '2016',
          percentageOrCgpa: '8.9 CGPA',
        },
        employmentInfo: {
          isFresher: false,
          previousCompany: 'Flipkart',
          previousDesignation: 'SDE II',
          previousExperience: '6 Years',
          lastWorkingDate: '2026-12-01',
          previousSalary: '26 LPA',
        },
        bankDetails: {
          accountHolderName: 'Vikram Sethi',
          bankName: 'HDFC Bank',
          accountNumber: '50100123456789',
          confirmAccountNumber: '50100123456789',
          ifscCode: 'HDFC0000240',
        },
      }),
    });
    expect(autosave.status).toBe(200);
    expect(autosave.body.candidate.status).toBe('In Progress');

    // Reject spoofed/malicious file (executable renamed as .pdf)
    const badForm = new FormData();
    badForm.append('category', 'PAN Card');
    badForm.append(
      'file',
      new Blob([new Uint8Array(Buffer.from('MZ\x90\x00<script>alert(1)</script>'))], {
        type: 'application/pdf',
      }),
      'malware.pdf'
    );
    const badUpload = await api(`/api/onboard/${onboardingToken}/documents`, {
      method: 'POST',
      body: badForm,
    });
    expect(badUpload.status).toBe(400);

    // Reject submission with missing required documents
    const earlySubmit = await api(`/api/onboard/${onboardingToken}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        declaration: { accepted: true, digitalSignature: 'Vikram Sethi' },
      }),
    });
    expect(earlySubmit.status).toBe(400);

    // Upload all 6 required valid documents
    const reqCats = [
      'Passport Size Photograph',
      'Aadhaar Card',
      'PAN Card',
      'Resume',
      'Educational Certificates',
      'Bank Proof',
    ];
    for (const cat of reqCats) {
      const fd = new FormData();
      fd.append('category', cat);
      fd.append(
        'file',
        new Blob([new Uint8Array(createValidPdfBytes())], { type: 'application/pdf' }),
        `${cat.toLowerCase().replace(/\s+/g, '_')}.pdf`
      );
      const up = await api(`/api/onboard/${onboardingToken}/documents`, {
        method: 'POST',
        body: fd,
      });
      expect(up.status).toBe(201);
      if (cat === 'PAN Card') {
        uploadedDocId = up.body.document.id;
      }
    }

    // Final Submit
    const submitRes = await api(`/api/onboard/${onboardingToken}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        declaration: { accepted: true, digitalSignature: 'Vikram Sethi' },
      }),
    });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.candidate.status).toBe('Submitted');
    expect(submitRes.body.candidate.completionPct).toBe(100);
  });

  it('15-17. HR document verification, correction request & candidate resubmission', async () => {
    // HR downloads/previews document securely
    const fileRes = await api(`/api/documents/${uploadedDocId}/file`, {}, hrToken);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('x-content-type-options')).toBe('nosniff');

    // HR rejects PAN card
    const rej = await api(`/api/documents/${uploadedDocId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Rejected', reason: 'PAN scan cropped at corner' }),
    }, hrToken);
    expect(rej.status).toBe(200);
    expect(rej.body.document.verificationStatus).toBe('Rejected');

    // HR requests corrections -> unlocks candidate link
    const corr = await api(`/api/candidates/${createdCandidateId}/request-correction`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Please upload a full uncropped PAN Card PDF.' }),
    }, hrToken);
    expect(corr.status).toBe(200);
    expect(corr.body.candidate.status).toBe('Correction Required');

    // Candidate re-uploads PAN card & resubmits
    const fd = new FormData();
    fd.append('category', 'PAN Card');
    fd.append('file', new Blob([new Uint8Array(createValidPdfBytes())], { type: 'application/pdf' }), 'pan_clear.pdf');
    const reup = await api(`/api/onboard/${onboardingToken}/documents`, {
      method: 'POST',
      body: fd,
    });
    expect(reup.status).toBe(201);
    const newPanId = reup.body.document.id;

    const resubmit = await api(`/api/onboard/${onboardingToken}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        declaration: { accepted: true, digitalSignature: 'Vikram Sethi' },
      }),
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.candidate.status).toBe('Submitted');

    // HR approves replacement PAN card
    const approveDoc = await api(`/api/documents/${newPanId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Approved' }),
    }, hrToken);
    expect(approveDoc.status).toBe(200);
    expect(approveDoc.body.document.verificationStatus).toBe('Approved');
  });

  it('18-22. Application approval, unique Employee ID generation, duplicate prevention, search & CSV export', async () => {
    // HR cannot reassign candidate to another recruiter or set Approved status directly
    const hrReassign = await api(
      `/api/candidates/${createdCandidateId}`,
      { method: 'PATCH', body: JSON.stringify({ assignedRecruiterId: 'usr-hr-002' }) },
      hrToken
    );
    expect(hrReassign.status).toBe(403);

    const hrApproveStatus = await api(
      `/api/candidates/${createdCandidateId}/status`,
      { method: 'PATCH', body: JSON.stringify({ status: 'Approved' }) },
      hrToken
    );
    expect(hrApproveStatus.status).toBe(403);

    // HR cannot approve/convert directly (only Admin/Super Admin)
    const hrConvert = await api(
      `/api/candidates/${createdCandidateId}/approve-and-convert`,
      { method: 'POST' },
      hrToken
    );
    expect(hrConvert.status).toBe(403);

    // Admin approves & converts candidate transactionally
    const convert = await api(
      `/api/candidates/${createdCandidateId}/approve-and-convert`,
      { method: 'POST' },
      adminToken
    );
    expect(convert.status).toBe(201);
    expect(convert.body.employee.employeeCode).toMatch(/^9HR-EMP-\d{4}-\d{4}$/);
    expect(convert.body.candidate.status).toBe('Onboarding Completed');

    // Duplicate employee creation prevented
    const dupConvert = await api(
      `/api/candidates/${createdCandidateId}/approve-and-convert`,
      { method: 'POST' },
      adminToken
    );
    expect(dupConvert.status).toBe(409);

    // Search & filter
    const searchRes = await api('/api/candidates?search=Vikram&scope=live', {}, hrToken);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items.some((c: { id: string }) => c.id === createdCandidateId)).toBe(true);

    // CSV export
    const csvRes = await api('/api/candidates/export/csv?scope=live', {}, hrToken);
    expect(csvRes.status).toBe(200);
    expect(String(csvRes.body)).toContain('Vikram Sethi');
  });

  it('24. Database state persists cleanly across server/store restart', async () => {
    const restartedStore = new PortalStore({ dataDir, uploadDir });
    const { app: restartedApp } = createApp({ store: restartedStore, disableRateLimit: true });

    const restartedServer = await new Promise<http.Server>((resolve) => {
      const s = restartedApp.listen(0, '127.0.0.1', () => resolve(s));
    });

    try {
      const addr = restartedServer.address() as { port: number };
      const resp = await fetch(`http://127.0.0.1:${addr.port}/api/employees?scope=live`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as { items: Array<{ fullName: string }> };
      expect(body.items.some((e) => e.fullName === 'Vikram Sethi')).toBe(true);
    } finally {
      await new Promise<void>((resolve) => restartedServer.close(() => resolve()));
    }
  });
});
