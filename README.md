# 9HR India Employee Onboarding Portal

A full-stack Employee Onboarding Management System built for **9HR India Pvt. Ltd.**

## Implemented Modules

- **Role-Based Staff Authentication**:
  - 8 staff roles (`SUPER_ADMIN`, `ADMIN`, `HR`, `RECRUITER`, `PAYROLL`, `MANAGER`, `FINANCE`, `EMPLOYEE`) with `bcrypt` password hashing, HMAC-signed JWT / `httpOnly` cookie sessions, direct Login ID + Password sign-in, password reset tokens, account activation links, and brute-force lockout protection.
- **Candidate Onboarding Workflow**:
  - Candidate registration by HR with automatic cryptographically secure 256-bit expiring onboarding URLs.
  - Zero-login Candidate Self-Service Portal (`/onboard/:token`) with an 8-step wizard (Personal, Address, Family, Education, Employment, Banking, Private Document Upload, Declaration & Digital Signature), automatic debounced autosave, Zod validation, and HR correction/resubmission loops.
- **HR Dashboard & Analytics**:
  - 7 KPI metrics, 4 interactive Recharts visualizations (Monthly Onboarding Statistics, Department-wise Candidates, Application Status Distribution, Recruitment Conversion Funnel), Live vs. Demo record isolation, search, filtering, sorting, pagination, and CSV export.
- **Private Document Verification**:
  - Extension, MIME type, and magic-byte file signature checks (PDF, JPG, JPEG, PNG up to 5 MB), stored in a private server directory (`./private_uploads`) outside `public/`, served via authenticated preview/download routes with `X-Content-Type-Options: nosniff`.
- **Transactional Employee Conversion & Audit Logs**:
  - Approving onboarding atomically generates a unique `9HR-EMP-YYYY-XXXX` Employee ID, prevents duplicate conversion, transfers candidate records into the Employee Directory, and logs immutable audit events.

## Database Architecture

- **Persistent Local JSON Store**: Transactional atomic store (`DATA_DIR=./data`, storing `portal-db.json`) with rollback guarantees across server restarts. Runs completely without Firebase or SMTP.

## Demo Credentials

| Role | Login ID | Email | Temporary Password |
| :--- | :--- | :--- | :--- |
| Super Admin | `9HR-SA-001` | `superadmin@9hrindia.com` | `NineHR@Super2026` |
| Admin | `9HR-ADM-001` | `admin@9hrindia.com` | `NineHR@Admin2026` |
| HR / Recruiter | `9HR-HR-001` | `priya.sharma@9hrindia.com` | `NineHR@HR2026` |

## Commands

```bash
# Install dependencies
npm install

# Run full-stack development server (Express + Vite on port 3000)
npm run dev

# Run automated test suite
npm test

# Type-check and build production bundle
npm run lint
npm run build

# Start production server
npm start
```

## Key API Endpoints

- `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/auth/me`
- `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`, `POST /api/auth/change-password`
- `GET /api/analytics`
- `GET /api/candidates`, `POST /api/candidates`, `GET /api/candidates/:id`, `PATCH /api/candidates/:id`, `GET /api/candidates/export/csv`
- `POST /api/candidates/:id/token`, `POST /api/candidates/:id/token/revoke`, `PATCH /api/candidates/:id/status`, `POST /api/candidates/:id/request-correction`, `POST /api/candidates/:id/approve-and-convert`
- `GET /api/documents/queue`, `GET /api/documents/:docId/file`, `POST /api/documents/:docId/verify`
- `GET /api/employees`, `GET /api/staff`, `POST /api/staff`, `PATCH /api/staff/:id`, `GET /api/notifications`, `GET /api/audit-logs`, `GET /api/config`, `PATCH /api/config`
- `GET /api/onboard/:token`, `PATCH /api/onboard/:token`, `POST /api/onboard/:token/documents`, `DELETE /api/onboard/:token/documents/:docId`, `POST /api/onboard/:token/submit`
