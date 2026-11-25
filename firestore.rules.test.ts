import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('Firestore Security Rules Static & Structural Verification (Dirty Dozen Invariants)', () => {
  const rulesText = fs.readFileSync('firestore.rules', 'utf8');

  it('enforces rules_version 2 and default-deny global catch-all', () => {
    expect(rulesText).toContain("rules_version = '2';");
    expect(rulesText).toContain('match /{document=**}');
    expect(rulesText).toContain('allow read, write: if false;');
  });

  it('requires email_verified == true and validates document IDs via isValidId', () => {
    expect(rulesText).toContain('request.auth.token.email_verified == true');
    expect(rulesText).toContain('function isValidId(id)');
    expect(rulesText).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
  });

  it('enforces validation blueprints, affectedKeys().hasOnly, temporal integrity, and no blanket reads', () => {
    expect(rulesText).toContain('isValidStaffUser(incoming())');
    expect(rulesText).toContain('isValidCandidateSummary(incoming())');
    expect(rulesText).toContain('isValidEmployeeRecord(incoming())');
    expect(rulesText).toContain('isValidAuditLogEntry(incoming())');
    expect(rulesText).toContain('affectedKeys().hasOnly(');
    expect(rulesText).toContain('request.time');
    expect(rulesText).toContain('allow update, delete: if false;');
    expect(rulesText).not.toMatch(/allow\s+read\s*:\s*if\s+isSignedIn\(\)/);
    expect(rulesText).not.toMatch(/allow\s+list\s*:\s*if\s+isSignedIn\(\)\s*;/);
  });
});
