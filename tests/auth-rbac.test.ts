import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { assertSafeRuntimeEnvironment, getRuntimeSecurityConfig } from '../server/config.ts';
import {
  dispatchNotificationEmail,
  EmailMessage,
  getOptionalSmtpConfig,
  setTestEmailTransport,
} from '../server/mailer.ts';
import { seedDemoAccounts } from '../server/seed.ts';
import { PortalStore } from '../server/store.ts';

describe('9HR Auth, Session Security, RBAC & Record Isolation Suite', () => {
  let tmpRoot: string;
  let dataDir: string;
  let uploadDir: string;
  let store: PortalStore;
  let server: http.Server;
  let baseUrl: string;

  const sessions: Record<
    string,
    { token: string; cookies: string; userId: string }
  > = {};

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), '9hr-auth-rbac-'));
    dataDir = path.join(tmpRoot, 'data');
    uploadDir = path.join(tmpRoot, 'private_uploads');
    store = new PortalStore({ dataDir, uploadDir });
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
    setTestEmailTransport(null);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function api(p: string, init: RequestInit = {}, token?: string, cookieHeader?: string) {
    const headers = new Headers(init.headers || {});
    if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (cookieHeader) headers.set('Cookie', cookieHeader);
    const resp = await fetch(`${baseUrl}${p}`, { ...init, headers });
    const ct = resp.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await resp.json() : await resp.text();
    const setCookies =
      typeof (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
    const cookieJar = setCookies.map((c) => c.split(';')[0]).join('; ');
    return { status: resp.status, headers: resp.headers, body, cookies: cookieJar };
  }

  async function signInRole(key: string, identifier: string, password: string, rememberMe = false) {
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, rememberMe }),
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.requires2FA).toBeUndefined();
    expect(login.body.requires2FAEnrollment).toBeUndefined();
    expect(login.body.user.twoFactorEnabled).toBeUndefined();

    sessions[key] = {
      token: login.body.token,
      cookies: login.cookies,
      userId: login.body.user.id,
    };
    return login;
  }

  it('1. Idempotent seeding creates all role accounts and direct login redirects to role-specific dashboards', async () => {
    const snapshot = store.getSnapshot();
    const secondRun = await store.withTransaction((tx) => seedDemoAccounts(tx, uploadDir));
    expect(secondRun.seededUsers).toBe(0);

    const accounts = [
      ['SUPER_ADMIN', '9HR-SA-001', 'NineHR@Super2026', '/super-admin/dashboard'],
      ['ADMIN', '9HR-ADM-001', 'NineHR@Admin2026', '/admin/dashboard'],
      ['HR', '9HR-HR-001', 'NineHR@HR2026', '/hr/dashboard'],
      ['HR2', '9HR-HR-002', 'NineHR@HR2026', '/hr/dashboard'],
      ['RECRUITER', '9HR-REC-001', 'NineHR@Rec2026', '/recruiter/dashboard'],
      ['PAYROLL', '9HR-PAY-001', 'NineHR@Pay2026', '/payroll/dashboard'],
      ['MANAGER', '9HR-MGR-001', 'NineHR@Mgr2026', '/manager/dashboard'],
      ['FINANCE', '9HR-FIN-001', 'NineHR@Fin2026', '/finance/dashboard'],
      ['EMP1', '9HR-EMP-001', 'NineHR@Emp2026', '/employee/dashboard'],
      ['EMP2', '9HR-EMP-002', 'NineHR@Emp2026#2', '/employee/dashboard'],
    ] as const;

    for (const [key, loginId, pwd, expectedPath] of accounts) {
      expect(snapshot.users.some((u) => u.loginId === loginId && !u.passwordHash.includes(pwd))).toBe(true);
      const res = await signInRole(key, loginId, pwd, key === 'EMP1');
      expect(res.body.dashboardPath).toBe(expectedPath);
    }
  });

  it('2. Production safety guard blocks demo mode and demo account logins', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDemoMode = process.env.DEMO_MODE;
    try {
      process.env.NODE_ENV = 'production';
      process.env.DEMO_MODE = 'true';
      expect(() => assertSafeRuntimeEnvironment()).toThrow(/FATAL SECURITY ERROR/);

      process.env.DEMO_MODE = 'false';
      process.env.DEMO_SEED_ENABLED = 'false';
      const prodLogin = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: '9HR-REC-001', password: 'NineHR@Rec2026' }),
      });
      expect(prodLogin.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.DEMO_MODE = prevDemoMode;
      delete process.env.DEMO_SEED_ENABLED;
    }
  });

  it('3. Brute-force lockout, legacy 2FA record migration, and removed 2FA endpoints', async () => {
    // 4 failed attempts return 401, 5th triggers 429 lockout
    for (let i = 0; i < 4; i++) {
      const bad = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: '9HR-EMP-002', password: 'WrongPassword123' }),
      });
      expect(bad.status).toBe(401);
    }
    const fifthBad = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '9HR-EMP-002', password: 'WrongPassword123' }),
    });
    expect(fifthBad.status).toBe(429);

    const locked = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '9HR-EMP-002', password: 'NineHR@Emp2026#2' }),
    });
    expect(locked.status).toBe(429);

    // Removed 2FA endpoints are no longer active
    expect((await api('/api/auth/verify-2fa', { method: 'POST', body: JSON.stringify({}) })).status).toBe(404);
    expect((await api('/api/auth/2fa/enroll-verify', { method: 'POST', body: JSON.stringify({}) })).status).toBe(404);
    expect((await api('/api/auth/2fa/email-otp/send', { method: 'POST', body: JSON.stringify({}) })).status).toBe(404);
    expect((await api('/api/auth/2fa/setup', { method: 'POST' }, sessions.SUPER_ADMIN.token)).status).toBe(404);

    // Existing DB records with legacy twoFactorEnabled/secret are safely migrated and never block login
    const dbPath = path.join(dataDir, 'portal-db.json');
    const rawDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    rawDb.twoFactorChallenges = [{ id: 'old-ch' }];
    const legacyPay = rawDb.users.find((u: { loginId: string }) => u.loginId === '9HR-PAY-001');
    legacyPay.twoFactorEnabled = true;
    legacyPay.twoFactorSecret = 'JBSWY3DPEHPK3PXP';
    legacyPay.recoveryCodeHashes = ['deadbeef'];
    fs.writeFileSync(dbPath, JSON.stringify(rawDb, null, 2), 'utf8');

    store.reloadFromDisk();
    const migratedPayLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '9HR-PAY-001', password: 'NineHR@Pay2026' }),
    });
    expect(migratedPayLogin.status).toBe(200);
    expect(migratedPayLogin.body.token).toBeTruthy();
    expect(migratedPayLogin.body.dashboardPath).toBe('/payroll/dashboard');
  });

  it('4. Firebase & SMTP are optional: app runs on local JSON (DATA_DIR=./data) and candidate invitations report Email Not Sent without SMTP', async () => {
    const rtCfg = getRuntimeSecurityConfig();
    expect(rtCfg.dataDir).toBe('./data');

    const health = await api('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.storageEngine).toBe('local-json');
    expect(health.body.firebaseConfigured).toBe(false);
    expect(health.body.smtpConfigured).toBe(false);

    const googleDisabled = await api('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: 'unused-token' }),
    });
    expect(googleDisabled.status).toBe(503);

    const finLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '9HR-FIN-001', password: 'NineHR@Fin2026' }),
    });
    expect(finLogin.status).toBe(200);
    expect(finLogin.body.token).toBeTruthy();
    expect(finLogin.body.dashboardPath).toBe('/finance/dashboard');

    // Internal mail, chat, payroll, and employee modules function without SMTP
    const mailRes = await api(
      '/api/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          channel: 'MAIL',
          recipientId: sessions.HR.userId,
          subject: 'No-SMTP Internal Mail Check',
          body: 'Internal mail works seamlessly without SMTP configuration.',
        }),
      },
      sessions.RECRUITER.token
    );
    expect(mailRes.status).toBe(201);
    expect(mailRes.body.message.channel).toBe('MAIL');

    const chatRes = await api(
      '/api/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          channel: 'CHAT',
          recipientId: sessions.EMP1.userId,
          body: 'Internal chat works seamlessly without SMTP configuration.',
        }),
      },
      sessions.MANAGER.token
    );
    expect(chatRes.status).toBe(201);
    expect(chatRes.body.message.channel).toBe('CHAT');

    expect((await api('/api/payroll', {}, sessions.PAYROLL.token)).status).toBe(200);
    expect((await api('/api/payroll', {}, sessions.EMP1.token)).status).toBe(200);

    // Candidate invitation succeeds without SMTP and clearly indicates email has NOT been sent
    const candCreate = await api(
      '/api/candidates',
      {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Meera Nair',
          email: 'meera.nair@example.in',
          mobile: '+91 98201 55443',
          position: 'Product Analyst',
          department: 'Product',
          joiningDate: '2026-12-22',
          assignedRecruiterId: sessions.RECRUITER.userId,
        }),
      },
      sessions.RECRUITER.token
    );
    expect(candCreate.status).toBe(201);
    expect(candCreate.body.onboardingUrl).toMatch(/^\/onboard\/[a-f0-9]{64}$/);
    expect(candCreate.body.emailDispatch.deliveryStatus).toBe('PENDING_MANUAL_SHARE');
    expect(candCreate.body.emailDispatch.deliveryNote).toMatch(/NOT been sent/i);

    const candTokenRegen = await api(
      `/api/candidates/${candCreate.body.candidate.id}/token`,
      { method: 'POST', body: JSON.stringify({}) },
      sessions.RECRUITER.token
    );
    expect(candTokenRegen.status).toBe(200);
    expect(candTokenRegen.body.onboardingUrl).toMatch(/^\/onboard\/[a-f0-9]{64}$/);
    expect(candTokenRegen.body.emailDispatch.deliveryStatus).toBe('PENDING_MANUAL_SHARE');
    expect(candTokenRegen.body.emailDispatch.deliveryNote).toMatch(/NOT been sent/i);

    // Mailer returns SENT_SMTP when transport is configured and PENDING_MANUAL_SHARE when absent
    const sentEmails: EmailMessage[] = [];
    setTestEmailTransport(async (msg) => {
      sentEmails.push(msg);
    });
    const sentRes = await dispatchNotificationEmail({
      to: 'test@9hrindia.com',
      subject: 'SMTP Active Check',
      body: 'Delivered via transport',
    });
    expect(sentRes.deliveryStatus).toBe('SENT_SMTP');
    expect(sentEmails.length).toBe(1);
    setTestEmailTransport(null);

    const unsentRes = await dispatchNotificationEmail({
      to: 'test@9hrindia.com',
      subject: 'SMTP Absent Check',
      body: 'Not sent',
    });
    expect(unsentRes.deliveryStatus).toBe('PENDING_MANUAL_SHARE');
    expect(unsentRes.deliveryNote).toMatch(/NOT been sent/i);

    // Partial or invalid SMTP env vars leave SMTP optional and external email delivery disabled
    const prevHost = process.env.SMTP_HOST;
    const prevPort = process.env.SMTP_PORT;
    try {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = 'invalid-port';
      const partialCfg = getOptionalSmtpConfig();
      expect(partialCfg.configured).toBe(false);
      expect(partialCfg.port).toBe(587);
      const partialRes = await dispatchNotificationEmail({
        to: 'test@9hrindia.com',
        subject: 'Partial SMTP Check',
        body: 'Should not attempt network send',
      });
      expect(partialRes.deliveryStatus).toBe('PENDING_MANUAL_SHARE');
    } finally {
      if (prevHost === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = prevHost;
      if (prevPort === undefined) delete process.env.SMTP_PORT;
      else process.env.SMTP_PORT = prevPort;
    }
  });

  it('5. Account lifecycle (Pending Activation single-use, Suspend/Deactivate immediate session revocation) & Refresh/Logout-All', async () => {
    const created = await api(
      '/api/staff',
      {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Pending Recruiter',
          email: 'pending.rec@9hrindia.com',
          role: 'RECRUITER',
          department: 'Talent Acquisition',
          sendActivationLink: true,
        }),
      },
      sessions.SUPER_ADMIN.token
    );
    expect(created.status).toBe(201);
    expect(created.body.user.status).toBe('PENDING_ACTIVATION');
    const actToken = String(created.body.activationUrl).split('/activate/')[1];

    // Activate via single-use link
    const actRes = await api(`/api/auth/activate/${actToken}`, {
      method: 'POST',
      body: JSON.stringify({ password: 'ActivatedRecruiter@2026' }),
    });
    expect(actRes.status).toBe(200);

    // Reusing activation link fails
    const reuseAct = await api(`/api/auth/activate/${actToken}`, {
      method: 'POST',
      body: JSON.stringify({ password: 'AnotherPassword@2026' }),
    });
    expect(reuseAct.status).toBe(400);

    // Login, check CSRF check + refresh token rotation & logout-all, then suspend & verify immediate 401
    const recLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: created.body.user.loginId, password: 'ActivatedRecruiter@2026' }),
    });
    expect(recLogin.status).toBe(200);
    const rToken1 = recLogin.body.token;

    // Cookie-authenticated mutation without X-Requested-With / Origin fails CSRF (403)
    const csrfBlocked = await api('/api/auth/refresh', { method: 'POST' }, undefined, recLogin.cookies);
    expect(csrfBlocked.status).toBe(403);

    // With X-Requested-With, refresh rotates access & refresh tokens
    const refreshed = await api(
      '/api/auth/refresh',
      { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } },
      undefined,
      recLogin.cookies
    );
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.token).not.toBe(rToken1);

    // Logout all devices invalidates rotated token
    const logoutAllRes = await api('/api/auth/logout-all', { method: 'POST' }, refreshed.body.token);
    expect(logoutAllRes.status).toBe(200);
    expect((await api('/api/candidates', {}, refreshed.body.token)).status).toBe(401);

    // Re-login, test idle timeout expiration, then suspend & verify immediate 401
    const recLogin2 = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: created.body.user.loginId, password: 'ActivatedRecruiter@2026' }),
    });
    expect(recLogin2.status).toBe(200);

    // Test idle session expiration
    const recLoginIdle = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: created.body.user.loginId, password: 'ActivatedRecruiter@2026' }),
    });
    await store.withTransaction((tx) => {
      const s = tx.sessions.find((item) => item.userId === created.body.user.id && !item.revokedAt);
      if (s) s.lastActivityAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    });
    expect((await api('/api/candidates', {}, recLoginIdle.body.token)).status).toBe(401);

    const suspendRes = await api(
      `/api/staff/${created.body.user.id}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'SUSPENDED' }) },
      sessions.SUPER_ADMIN.token
    );
    expect(suspendRes.status).toBe(200);

    const demoBlockedRealUser = await api(
      '/api/staff/usr-sa-google',
      { method: 'PATCH', body: JSON.stringify({ department: 'Security' }) },
      sessions.SUPER_ADMIN.token
    );
    expect(demoBlockedRealUser.status).toBe(403);

    const revokedCall = await api('/api/candidates', {}, recLogin2.body.token);
    expect(revokedCall.status).toBe(401);

    const suspendedLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: created.body.user.loginId, password: 'ActivatedRecruiter@2026' }),
    });
    expect(suspendedLogin.status).toBe(403);
  });

  it('6. Enforce deny-by-default RBAC, segregation of duties, manager direct-report scope & employee isolation', async () => {
    // Admin blocked from Payroll, Finance, System Config update, and RBAC matrix
    expect((await api('/api/payroll', {}, sessions.ADMIN.token)).status).toBe(403);
    expect((await api('/api/rbac/permissions', {}, sessions.ADMIN.token)).status).toBe(403);
    expect(
      (
        await api(
          '/api/config',
          { method: 'PATCH', body: JSON.stringify({ defaultLinkExpiryHours: 48 }) },
          sessions.ADMIN.token
        )
      ).status
    ).toBe(403);

    // Recruiter sees redacted bank details and cannot view employees or documents approve
    const recCands = await api('/api/candidates?pageSize=50', {}, sessions.RECRUITER.token);
    expect(recCands.status).toBe(200);
    const candWithBank = recCands.body.items.find((c: { id: string }) => c.id === 'cand-001');
    expect(candWithBank.bankDetails.accountNumber).toBe('');
    expect(candWithBank.bankDetails.bankName).toBe('[Restricted]');
    expect((await api('/api/employees', {}, sessions.RECRUITER.token)).status).toBe(403);
    expect(
      (
        await api(
          '/api/documents/doc-c4-1/verify',
          { method: 'POST', body: JSON.stringify({ status: 'Approved' }) },
          sessions.RECRUITER.token
        )
      ).status
    ).toBe(403);

    // Manager sees only direct report emp-001 (blocked on emp-002), bank details omitted
    const mgrEmps = await api('/api/employees', {}, sessions.MANAGER.token);
    expect(mgrEmps.status).toBe(200);
    expect(mgrEmps.body.items.some((e: { id: string }) => e.id === 'emp-001')).toBe(true);
    expect(mgrEmps.body.items.some((e: { id: string }) => e.id === 'emp-002')).toBe(false);
    expect(mgrEmps.body.items[0].bankDetails).toBeUndefined();
    expect((await api('/api/employees/emp-002', {}, sessions.MANAGER.token)).status).toBe(403);

    // Employee 1 cannot access Employee 2 profile, payslip, or approve leave
    expect((await api('/api/employees/emp-001', {}, sessions.EMP1.token)).status).toBe(200);
    expect((await api('/api/employees/emp-002', {}, sessions.EMP1.token)).status).toBe(403);
    expect((await api('/api/payroll/payslips/pe-10-2', {}, sessions.EMP1.token)).status).toBe(403);
    expect(
      (
        await api(
          '/api/leave/lv-001/decision',
          { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) },
          sessions.EMP1.token
        )
      ).status
    ).toBe(403);

    // Manager cannot approve own leave or leave for emp-002 (not their report)
    expect(
      (
        await api(
          '/api/leave/lv-002/decision',
          { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) },
          sessions.MANAGER.token
        )
      ).status
    ).toBe(403);

    // Payroll segregation of duties: Payroll drafts & submits, cannot approve or release; Finance cannot edit
    const draft = await api(
      '/api/payroll',
      { method: 'POST', body: JSON.stringify({ period: '2026-12', monthLabel: 'December 2026', scope: 'demo' }) },
      sessions.PAYROLL.token
    );
    expect(draft.status).toBe(201);
    const runId = draft.body.run.id;
    expect(
      (
        await api(
          `/api/payroll/${runId}/entries/${draft.body.run.entries[0].id}`,
          { method: 'PATCH', body: JSON.stringify({ allowances: 20000 }) },
          sessions.FINANCE.token
        )
      ).status
    ).toBe(403);

    expect((await api(`/api/payroll/${runId}/submit`, { method: 'POST' }, sessions.PAYROLL.token)).status).toBe(200);
    expect((await api(`/api/payroll/${runId}/final-approve`, { method: 'POST' }, sessions.PAYROLL.token)).status).toBe(403);
    expect(
      (
        await api(
          `/api/payroll/${runId}/finance-review`,
          { method: 'POST', body: JSON.stringify({ decision: 'APPROVE' }) },
          sessions.FINANCE.token
        )
      ).status
    ).toBe(200);
    expect((await api(`/api/payroll/${runId}/final-approve`, { method: 'POST' }, sessions.SUPER_ADMIN.token)).status).toBe(200);
    expect((await api(`/api/payroll/${runId}/release-payment`, { method: 'POST' }, sessions.FINANCE.token)).status).toBe(200);

    // Demo-to-real isolation: non-demo user record inaccessible to 9HR-SA-001 (demo Super Admin)
    const realCand = await api(
      '/api/candidates',
      {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Real Live Candidate',
          email: 'real.candidate@example.in',
          mobile: '+91 99887 76655',
          position: 'Architect',
          department: 'Engineering',
          joiningDate: '2026-12-28',
          assignedRecruiterId: 'usr-sa-google',
          isDemo: false,
        }),
      },
      sessions.SUPER_ADMIN.token
    );
    // Note: SUPER_ADMIN 9HR-SA-001 is isDemo=true, so createdByIsDemo=true; test true non-demo isolation via store record
    expect(realCand.status).toBe(201);
    await store.withTransaction((tx) => {
      const c = tx.candidates.find((item) => item.id === realCand.body.candidate.id);
      if (c) {
        c.isDemo = false;
        c.createdByIsDemo = false;
      }
    });
    const blockedDemo = await api(`/api/candidates/${realCand.body.candidate.id}`, {}, sessions.HR.token);
    expect(blockedDemo.status).toBe(403);

    // Dynamic RBAC update revokes active sessions for modified role
    const rbacUpdate = await api(
      '/api/rbac/permissions',
      {
        method: 'PATCH',
        body: JSON.stringify({
          role: 'RECRUITER',
          permissions: { dashboard: ['view'], candidates: ['view'], communications: ['view'] },
        }),
      },
      sessions.SUPER_ADMIN.token
    );
    expect(rbacUpdate.status).toBe(200);
    expect((await api('/api/candidates', {}, sessions.RECRUITER.token)).status).toBe(401);

    // Onboarding tokens are stored hashed in DB JSON (never plaintext)
    const dbRaw = fs.readFileSync(path.join(dataDir, 'portal-db.json'), 'utf8');
    const parsedDb = JSON.parse(dbRaw) as { tokens: Array<{ token?: string; tokenHash: string }> };
    expect(parsedDb.tokens.every((t) => typeof t.tokenHash === 'string' && !('token' in t))).toBe(true);
  });
});
