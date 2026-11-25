import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Link2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import {
  ConfirmDialog,
  Modal,
  StatusIndicator,
  TableSkeleton,
} from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, fetchAuthorizedBlobUrl } from '../lib/api.ts';
import { hasPermission } from '../shared/rbac.ts';
import {
  Candidate,
  CandidateDocument,
  Employee,
  ONBOARDING_STATUSES,
  OnboardingStatus,
  OnboardingToken,
  StaffUser,
  StatusHistoryEntry,
} from '../shared/types.ts';

interface DetailPayload {
  candidate: Candidate;
  tokens: OnboardingToken[];
  documents: CandidateDocument[];
  statusHistory: StatusHistoryEntry[];
  employee: Employee | null;
  smtpConfigured?: boolean;
}

export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, addToast } = useAuth();

  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'documents' | 'history'>('profile');

  // Link & Status Actions
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<OnboardingStatus>('Under Review');
  const [statusNote, setStatusNote] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionNote, setCorrectionNote] = useState('');

  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [issuedDelivery, setIssuedDelivery] = useState<{ sent: boolean; note: string } | null>(null);
  const [activationResult, setActivationResult] = useState<{
    employeeCode: string;
    loginId: string;
    activationUrl?: string;
    emailSent?: boolean;
    deliveryNote?: string;
  } | null>(null);

  // Document Preview & Verify
  const [previewDoc, setPreviewDoc] = useState<{
    doc: CandidateDocument;
    blobUrl: string;
  } | null>(null);
  const [rejectDoc, setRejectDoc] = useState<CandidateDocument | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<DetailPayload>(`/api/candidates/${id}`);
      setData(res);
      setNextStatus(res.candidate.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidate details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleRegenerateLink = async () => {
    if (!data) return;
    setActionBusy(true);
    try {
      const res = await apiRequest<{
        onboardingUrl: string;
        emailDispatch?: { deliveryStatus: string; deliveryNote: string };
      }>(`/api/candidates/${data.candidate.id}/token`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const emailSent = res.emailDispatch?.deliveryStatus === 'SENT_SMTP';
      setIssuedUrl(`${window.location.origin}${res.onboardingUrl}`);
      setIssuedDelivery(
        res.emailDispatch
          ? { sent: emailSent, note: res.emailDispatch.deliveryNote }
          : null
      );
      addToast({
        title: emailSent ? 'New onboarding link generated & emailed' : 'Invitation link generated — Email Not Sent',
        description: emailSent ? undefined : 'Copy the invitation link to share with the candidate manually.',
        type: emailSent ? 'success' : 'warning',
      });
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Failed to generate link',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevokeLinks = async () => {
    if (!data) return;
    setActionBusy(true);
    try {
      await apiRequest(`/api/candidates/${data.candidate.id}/token/revoke`, { method: 'POST' });
      setIssuedUrl(null);
      setIssuedDelivery(null);
      addToast({ title: 'Active onboarding links revoked', type: 'info' });
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Failed to revoke links',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setActionBusy(true);
    try {
      await apiRequest(`/api/candidates/${data.candidate.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, note: statusNote }),
      });
      addToast({ title: `Status updated to ${nextStatus}`, type: 'success' });
      setStatusModalOpen(false);
      setStatusNote('');
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Status update failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleSendCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return;
    setActionBusy(true);
    try {
      await apiRequest(`/api/candidates/${data.candidate.id}/request-correction`, {
        method: 'POST',
        body: JSON.stringify({ note: correctionNote }),
      });
      addToast({
        title: 'Correction Request Sent',
        description: 'Candidate can now edit and resubmit using their onboarding link.',
        type: 'success',
      });
      setCorrectionOpen(false);
      setCorrectionNote('');
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Request failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleApproveAndCreateEmployee = async () => {
    if (!data) return;
    setActionBusy(true);
    try {
      const res = await apiRequest<{
        employee: Employee;
        employeeAccount?: StaffUser;
        activationUrl?: string;
        emailDispatch?: { deliveryStatus: string; deliveryNote: string };
      }>(`/api/candidates/${data.candidate.id}/approve-and-convert`, { method: 'POST' });
      addToast({
        title: 'Employee Record Created',
        description: `Assigned Employee ID ${res.employee.employeeCode}`,
        type: 'success',
      });
      setConvertConfirmOpen(false);
      setIssuedUrl(null);
      setIssuedDelivery(null);
      setActivationResult({
        employeeCode: res.employee.employeeCode,
        loginId: res.employeeAccount?.loginId || res.employee.employeeCode,
        activationUrl: res.activationUrl
          ? `${window.location.origin}${res.activationUrl}`
          : undefined,
        emailSent: res.emailDispatch?.deliveryStatus === 'SENT_SMTP',
        deliveryNote: res.emailDispatch?.deliveryNote,
      });
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Conversion Failed',
        description: err instanceof Error ? err.message : 'Could not create employee record.',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const openPreview = async (doc: CandidateDocument) => {
    try {
      const blobUrl = await fetchAuthorizedBlobUrl(`/api/documents/${doc.id}/file`);
      setPreviewDoc({ doc, blobUrl });
    } catch (err) {
      addToast({
        title: 'Preview Failed',
        description: err instanceof Error ? err.message : 'Unable to open document.',
        type: 'error',
      });
    }
  };

  const closePreview = () => {
    if (previewDoc) {
      URL.revokeObjectURL(previewDoc.blobUrl);
      setPreviewDoc(null);
    }
  };

  const handleDownloadDoc = async (doc: CandidateDocument) => {
    try {
      const blobUrl = await fetchAuthorizedBlobUrl(`/api/documents/${doc.id}/file?download=1`);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = doc.originalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      addToast({
        title: 'Download Failed',
        description: err instanceof Error ? err.message : 'Unable to download document.',
        type: 'error',
      });
    }
  };

  const handleVerifyDoc = async (docId: string, status: 'Approved' | 'Rejected', reason = '') => {
    setActionBusy(true);
    try {
      await apiRequest(`/api/documents/${docId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ status, reason }),
      });
      addToast({
        title: `Document ${status}`,
        type: status === 'Approved' ? 'success' : 'warning',
      });
      setRejectDoc(null);
      setRejectReason('');
      await loadDetail();
    } catch (err) {
      addToast({
        title: 'Verification Failed',
        description: err instanceof Error ? err.message : 'Could not update document status.',
        type: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const canEditCandidate = hasPermission(user?.effectivePermissions, 'candidates', 'edit');
  const canConvertToEmployee = hasPermission(user?.effectivePermissions, 'candidates', 'approve');
  const canApproveDocs = hasPermission(user?.effectivePermissions, 'documents', 'approve');

  if (loading) {
    return (
      <AppLayout title="Candidate Review" breadcrumb="Candidates · Loading...">
        <TableSkeleton rows={6} />
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout title="Candidate Review" breadcrumb="Candidates · Error">
        <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
          <p className="mb-4">{error || 'Candidate not found.'}</p>
          <Link to="/candidates" className="text-emerald-700 font-semibold hover:underline">
            Back to Candidates
          </Link>
        </div>
      </AppLayout>
    );
  }

  const { candidate, tokens, documents, statusHistory, employee } = data;
  const activeToken = tokens.find(
    (t) => !t.isRevoked && !t.consumedAt && new Date(t.expiresAt).getTime() > Date.now()
  );
  const activeUrl = issuedUrl;

  return (
    <AppLayout
      title={candidate.fullName}
      breadcrumb={`Candidates / ${candidate.candidateCode} · ${candidate.position}`}
      primaryAction={
        <div className="flex items-center gap-2">
          <Link
            to="/candidates"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          {!employee && candidate.status !== 'Rejected' && (
            <>
              {canEditCandidate && (
                <>
                  <button
                    type="button"
                    onClick={() => setCorrectionOpen(true)}
                    className="px-3 py-2 text-xs sm:text-sm font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 whitespace-nowrap cursor-pointer"
                  >
                    Request Corrections
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusModalOpen(true)}
                    className="px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
                  >
                    Update Status
                  </button>
                </>
              )}
              {canConvertToEmployee && (
                <button
                  type="button"
                  onClick={() => setConvertConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  <BadgeCheck className="w-4 h-4" />
                  Approve & Create Employee
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      {/* Top Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-7 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs font-semibold text-slate-600">
              {candidate.candidateCode}
            </span>
            <span className="text-slate-300">·</span>
            <StatusIndicator status={candidate.status} />
            {candidate.isDemo && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500">Demo Record</span>
              </>
            )}
          </div>
          <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <strong className="text-slate-800">Department:</strong> {candidate.department}
            </span>
            <span>
              <strong className="text-slate-800">Joining Date:</strong>{' '}
              <span className="font-mono">{candidate.joiningDate}</span>
            </span>
            <span>
              <strong className="text-slate-800">Recruiter:</strong> {candidate.assignedRecruiterName}
            </span>
            <span>
              <strong className="text-slate-800">Completion:</strong>{' '}
              <span className="font-mono font-semibold text-emerald-700">
                {candidate.completionPct}%
              </span>
            </span>
          </div>
          {employee && (
            <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-emerald-800 font-medium flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Converted to Employee Record{' '}
                <span className="font-mono font-bold">{employee.employeeCode}</span> on{' '}
                {employee.createdAt.slice(0, 10)}
              </span>
            </div>
          )}
          {candidate.correctionNotes && (
            <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <strong>Correction Note:</strong> {candidate.correctionNotes}
            </div>
          )}
        </div>

        {/* Onboarding Link Control Box */}
        <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-emerald-600" />
              Candidate Onboarding Link
            </span>
            {activeToken && (
              <span className="text-[11px] font-mono text-slate-500">
                Exp: {new Date(activeToken.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {activeUrl ? (
            <div className="space-y-2.5">
              {!(issuedDelivery?.sent ?? data.smtpConfigured) && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2 text-[11px] text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Email has not been sent.</strong>{' '}
                    {issuedDelivery?.note || 'SMTP is not configured — share this invitation manually.'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={activeUrl}
                  className="flex-1 px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded text-slate-700"
                />
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(activeUrl);
                    setCopiedToken(true);
                    addToast({ title: 'Invitation link copied', type: 'success' });
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                  className="px-2.5 py-1.5 bg-[#0B192C] text-white text-xs font-semibold rounded hover:bg-[#132946] cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                >
                  {copiedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedToken ? 'Copied' : 'Copy Invitation Link'}
                </button>
              </div>
              <div className="flex items-center justify-between text-xs">
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline"
                >
                  Preview Form <ExternalLink className="w-3 h-3" />
                </a>
                {canEditCandidate && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleRegenerateLink}
                      className="text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleRevokeLinks}
                      className="text-red-600 hover:text-red-700 font-medium cursor-pointer"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  {employee
                    ? 'Link closed upon completion.'
                    : activeToken
                      ? `Active link issued (${activeToken.tokenPrefix}•••• · stored hashed).`
                      : 'No active link.'}
                </span>
                {!employee && candidate.status !== 'Rejected' && canEditCandidate && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={handleRegenerateLink}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-md cursor-pointer"
                    >
                      Generate New Link
                    </button>
                    {activeToken && (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={handleRevokeLinks}
                        className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 rounded-md cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </div>
              {!employee && candidate.status !== 'Rejected' && !data.smtpConfigured && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  Email delivery is unavailable (SMTP not configured). Generate a link above to copy and share the invitation URL manually.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit mb-6">
        {(
          [
            { id: 'profile', label: 'Submitted Information' },
            { id: 'documents', label: `Documents (${documents.length})` },
            { id: 'history', label: `Status History (${statusHistory.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <InfoCard
            title="Personal Information"
            rows={[
              ['Full Name', candidate.personalInfo.fullName],
              ['Date of Birth', candidate.personalInfo.dateOfBirth],
              ['Gender', candidate.personalInfo.gender],
              ['Mobile Number', candidate.personalInfo.mobileNumber],
              ['Email Address', candidate.personalInfo.email],
              ['Marital Status', candidate.personalInfo.maritalStatus],
            ]}
          />
          <InfoCard
            title="Address Information"
            rows={[
              ['Current Address', candidate.addressInfo.currentAddress],
              ['Permanent Address', candidate.addressInfo.permanentAddress],
              ['City', candidate.addressInfo.city],
              ['State', candidate.addressInfo.state],
              ['PIN Code', candidate.addressInfo.pinCode],
            ]}
          />
          <InfoCard
            title="Family & Emergency Contact"
            rows={[
              ["Father's Name", candidate.familyInfo.fatherName],
              ["Mother's Name", candidate.familyInfo.motherName],
              ['Spouse Name', candidate.familyInfo.spouseName || 'N/A'],
              ['Emergency Contact', candidate.familyInfo.emergencyContactName],
              ['Relationship', candidate.familyInfo.emergencyContactRelation],
              ['Emergency Phone', candidate.familyInfo.emergencyContactPhone],
            ]}
          />
          <InfoCard
            title="Education Information"
            rows={[
              ['Highest Qualification', candidate.educationInfo.highestQualification],
              ['College / University', candidate.educationInfo.collegeUniversity],
              ['Passing Year', candidate.educationInfo.passingYear],
              ['Percentage / CGPA', candidate.educationInfo.percentageOrCgpa],
            ]}
          />
          <InfoCard
            title="Previous Employment"
            rows={
              candidate.employmentInfo.isFresher
                ? [['Experience Status', 'Fresher (No prior employment)']]
                : [
                    ['Previous Company', candidate.employmentInfo.previousCompany],
                    ['Designation', candidate.employmentInfo.previousDesignation],
                    ['Total Experience', candidate.employmentInfo.previousExperience],
                    ['Last Working Date', candidate.employmentInfo.lastWorkingDate],
                    ['Previous Salary', candidate.employmentInfo.previousSalary || 'Not disclosed'],
                  ]
            }
          />
          <InfoCard
            title="Banking & Declaration"
            rows={[
              ['Account Holder', candidate.bankDetails?.accountHolderName],
              ['Bank Name', candidate.bankDetails?.bankName],
              ['Account Number', candidate.bankDetails?.accountNumber],
              ['IFSC Code', candidate.bankDetails?.ifscCode],
              [
                'Declaration',
                candidate.declaration.accepted
                  ? `Signed by ${candidate.declaration.digitalSignature}`
                  : 'Pending candidate signature',
              ],
            ]}
          />
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {documents.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No documents uploaded by this candidate yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-sm font-bold text-slate-900">{doc.category}</span>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`text-xs font-semibold ${
                          doc.verificationStatus === 'Approved'
                            ? 'text-emerald-700'
                            : doc.verificationStatus === 'Rejected'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {doc.verificationStatus}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-mono truncate">
                      {doc.originalName} · {(doc.sizeBytes / 1024).toFixed(1)} KB · Uploaded{' '}
                      {doc.uploadedAt.slice(0, 10)}
                    </p>
                    {doc.rejectionReason && (
                      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5 mt-1">
                        Rejection Reason: {doc.rejectionReason}
                      </p>
                    )}
                    {doc.history.length > 0 && (
                      <p className="text-[11px] text-slate-400">
                        Last reviewed by {doc.history[0].reviewedByName} on{' '}
                        {new Date(doc.history[0].timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openPreview(doc)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadDoc(doc)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                    {canApproveDocs && (
                      <>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleVerifyDoc(doc.id, 'Approved')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => {
                            setRejectDoc(doc);
                            setRejectReason(doc.rejectionReason || '');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          {statusHistory.length === 0 ? (
            <p className="text-sm text-slate-500">No status transitions recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {statusHistory.map((h) => (
                <div key={h.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {h.fromStatus ? `${h.fromStatus} -> ${h.toStatus}` : h.toStatus}
                    </p>
                    {h.note && <p className="text-xs text-slate-600 mt-0.5">{h.note}</p>}
                  </div>
                  <div className="text-xs text-slate-500 sm:text-right">
                    <div className="font-medium text-slate-700">
                      {h.changedByName} ({h.changedByRole})
                    </div>
                    <div className="font-mono">{new Date(h.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status Update Modal */}
      <Modal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        title="Update Application Status"
        subtitle="Every status change is recorded in the audit timeline."
      >
        <form onSubmit={handleStatusUpdate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Target Status
            </label>
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as OnboardingStatus)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {ONBOARDING_STATUSES.map((s) => {
                const adminOnly = ['Approved', 'Rejected', 'Onboarding Completed'].includes(s);
                const disabled = adminOnly && !canConvertToEmployee;
                return (
                  <option key={s} value={s} disabled={disabled}>
                    {disabled ? `${s} (Admin / Super Admin only)` : s}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Remarks / Reason
            </label>
            <textarea
              rows={3}
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              placeholder="Add verification notes or instructions..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setStatusModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-lg cursor-pointer disabled:opacity-60"
            >
              {actionBusy ? 'Saving...' : 'Update Status'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Request Corrections Modal */}
      <Modal
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        title="Request Candidate Corrections"
        subtitle="Sets status to Correction Required and unlocks the candidate link for edits."
      >
        <form onSubmit={handleSendCorrection} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Correction Instructions *
            </label>
            <textarea
              rows={4}
              required
              minLength={5}
              value={correctionNote}
              onChange={(e) => setCorrectionNote(e.target.value)}
              placeholder="Specify which details or documents need correction..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCorrectionOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy}
              className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer disabled:opacity-60"
            >
              {actionBusy ? 'Sending...' : 'Send Correction Request'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reject Document Modal */}
      <Modal
        open={Boolean(rejectDoc)}
        onClose={() => setRejectDoc(null)}
        title={`Reject Document: ${rejectDoc?.category || ''}`}
        subtitle="Provide a clear reason so the candidate can upload a replacement."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rejectDoc) handleVerifyDoc(rejectDoc.id, 'Rejected', rejectReason);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Rejection Reason *
            </label>
            <textarea
              rows={3}
              required
              minLength={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Image blurred, document cropped, or mismatched account number."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectDoc(null)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy}
              className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
            >
              Confirm Rejection
            </button>
          </div>
        </form>
      </Modal>

      {/* Document Preview Modal */}
      <Modal
        open={Boolean(previewDoc)}
        onClose={closePreview}
        title={previewDoc?.doc.category || 'Document Preview'}
        subtitle={previewDoc?.doc.originalName}
        maxWidth="max-w-3xl"
      >
        {previewDoc && (
          <div className="space-y-4">
            <div className="bg-slate-100 border border-slate-200 rounded-lg overflow-hidden min-h-[420px] flex items-center justify-center">
              {previewDoc.doc.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewDoc.blobUrl}
                  title={previewDoc.doc.originalName}
                  className="w-full h-[500px]"
                />
              ) : (
                <img
                  src={previewDoc.blobUrl}
                  alt={previewDoc.doc.originalName}
                  className="max-h-[500px] w-auto object-contain"
                />
              )}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleDownloadDoc(previewDoc.doc)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download Authorized Copy
              </button>
              <button
                type="button"
                onClick={closePreview}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-lg cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Transactional Employee Creation Confirm */}
      <ConfirmDialog
        open={convertConfirmOpen}
        onClose={() => setConvertConfirmOpen(false)}
        onConfirm={handleApproveAndCreateEmployee}
        loading={actionBusy}
        title="Approve Onboarding & Create Employee Record"
        message={`This will approve ${candidate.fullName}'s onboarding application, generate a unique 9HR Employee ID, transfer all verified details into the Employee Directory, and close their onboarding link. Proceed?`}
        confirmLabel="Approve & Create Employee"
      />

      {/* Employee Account Activation Modal */}
      <Modal
        open={Boolean(activationResult)}
        onClose={() => setActivationResult(null)}
        title="Employee Record & Account Created"
        subtitle="Share the single-use activation link with the new employee to set their password."
      >
        {activationResult && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg space-y-1 text-emerald-900">
              <p>
                <strong>Employee ID:</strong>{' '}
                <span className="font-mono font-bold">{activationResult.employeeCode}</span>
              </p>
              <p>
                <strong>Portal Login ID:</strong>{' '}
                <span className="font-mono font-bold">{activationResult.loginId}</span>
              </p>
            </div>
            {activationResult.activationUrl && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                {!activationResult.emailSent && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    <strong>Email has not been sent.</strong> Share this single-use activation link manually.
                  </p>
                )}
                <p className="font-semibold text-slate-700">Single-Use Account Activation Link</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activationResult.activationUrl}
                    className="flex-1 px-2.5 py-1.5 font-mono text-xs bg-white border border-slate-300 rounded"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(activationResult.activationUrl!);
                      addToast({ title: 'Activation link copied', type: 'success' });
                    }}
                    className="px-3 py-1.5 bg-[#0B192C] text-white font-semibold rounded cursor-pointer whitespace-nowrap"
                  >
                    Copy Activation Link
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActivationResult(null)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}

function InfoCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | undefined]>;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="text-sm font-bold text-slate-900 pb-3 mb-3 border-b border-slate-100">
        {title}
      </h3>
      <dl className="space-y-2.5 text-sm">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-slate-500 shrink-0">{label}</dt>
            <dd className="text-xs font-medium text-slate-900 text-right break-words">
              {val && val.trim() !== '' ? val : <span className="text-slate-400">Not provided</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
