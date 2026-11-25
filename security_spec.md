# Security Specification & Payload-First TDD (`9HR India Employee Onboarding Portal`)

## 1. Data Invariants
1. **Identity & Privilege Invariant**: Non-admin users cannot self-assign `role: 'SUPER_ADMIN'` or `role: 'ADMIN'` during profile creation, and cannot escalate their own `role` during updates. Only the bootstrapped Super Admin (`itsdemoid00@gmail.com` with `email_verified == true`) or an existing verified admin in `/admins/{uid}` can manage `/admins/{uid}` or assign elevated roles.
2. **PII Isolation Invariant**: Staff profiles (`/users/{userId}`), candidate records (`/candidates/{candidateId}`), and employee records (`/employees/{employeeId}`) contain PII (`email`, `mobile`, `fullName`) and MUST never be readable by arbitrary signed-in users. Reads/lists are restricted to the record owner (`ownerId == request.auth.uid`) or verified admins (`isAdmin()`).
3. **Referential Integrity & Atomicity Invariant**: An `/employees/{employeeId}` document cannot be created unless its referenced `/candidates/{candidateId}` exists.
4. **Temporal & Immutability Invariant**: `createdAt` MUST equal `request.time` on create and remain immutable on update; `updatedAt` MUST equal `request.time` on create and update. `ownerId` and `uid` are immutable after creation.
5. **Terminal State & Audit Immutability**: `/audit_logs/{logId}` entries are append-only (`update` and `delete` are permanently denied). Once a candidate reaches `Onboarding Completed`, non-admin edits are blocked.
6. **Path & Volumetric Guards**: Every document ID matches `^[a-zA-Z0-9_\-]+$` with length `<= 128`, and every string field enforces explicit `.size()` upper bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation on `/users/{uid}` Create**: Authenticated non-admin sets `role: "SUPER_ADMIN"` on own profile. -> `PERMISSION_DENIED`.
2. **Shadow Field Injection on `/users/{uid}` Update**: Authenticated owner attempts to inject `"isSuperAdmin": true` alongside `fullName`. -> `PERMISSION_DENIED`.
3. **Unverified Email Spoofing**: Request with `request.auth.token.email == "itsdemoid00@gmail.com"` and `email_verified == false` attempts admin read/write. -> `PERMISSION_DENIED`.
4. **PII Blanket Read on `/users/{otherUid}`**: Signed-in non-admin attempts `get` on another user's profile. -> `PERMISSION_DENIED`.
5. **Unauthorized List Scraping on `/candidates`**: Signed-in non-admin executes unbounded `list` query without `where("ownerId", "==", uid)`. -> `PERMISSION_DENIED`.
6. **ID Poisoning on `/candidates/{id}`**: Attacker creates candidate with 500-char ID or special characters `../admin`. -> `PERMISSION_DENIED`.
7. **Owner Spoofing on `/candidates` Create**: Recruiter creates candidate with `ownerId: "victim-uid"` instead of `request.auth.uid`. -> `PERMISSION_DENIED`.
8. **Client-Spoofed Timestamp**: Create payload supplies past `createdAt` instead of `request.time`. -> `PERMISSION_DENIED`.
9. **Terminal State Bypass**: Non-admin attempts to modify candidate whose `status == "Onboarding Completed"`. -> `PERMISSION_DENIED`.
10. **Orphaned Employee Creation**: Client attempts to create `/employees/{empId}` pointing to non-existent `candidateId`. -> `PERMISSION_DENIED`.
11. **Audit Log Tampering**: Even an admin attempts `update` or `delete` on `/audit_logs/{logId}`. -> `PERMISSION_DENIED`.
12. **Denial-of-Wallet String Overflow**: Create `/candidates` with 50KB `fullName` string. -> `PERMISSION_DENIED`.
