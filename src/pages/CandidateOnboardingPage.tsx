import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Save,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Modal, StatusIndicator } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import {
  Candidate,
  CandidateDocument,
  DOCUMENT_CATEGORIES,
  DocumentCategory,
  REQUIRED_DOCUMENT_CATEGORIES,
} from '../shared/types.ts';
import {
  addressInfoSchema,
  bankDetailsSchema,
  declarationSchema,
  educationInfoSchema,
  employmentInfoSchema,
  familyInfoSchema,
  personalInfoSchema,
} from '../shared/validation.ts';

const STEPS = [
  { num: 1, label: 'Personal' },
  { num: 2, label: 'Address' },
  { num: 3, label: 'Family' },
  { num: 4, label: 'Education' },
  { num: 5, label: 'Employment' },
  { num: 6, label: 'Banking' },
  { num: 7, label: 'Documents' },
  { num: 8, label: 'Declaration' },
];

interface OnboardLoadResponse {
  candidate: Candidate;
  documents: CandidateDocument[];
  tokenExpiresAt: string;
  editable: boolean;
}

export default function CandidateOnboardingPage() {
  const { token } = useParams<{ token: string }>();
  const { addToast } = useAuth();

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<{ message: string; expired?: boolean } | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [editable, setEditable] = useState(true);
  const [tokenExpiresAt, setTokenExpiresAt] = useState('');

  const [step, setStep] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedTime, setLastSavedTime] = useState('');
  const [uploadingCat, setUploadingCat] = useState<DocumentCategory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<CandidateDocument | null>(null);

  const autosaveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  const loadSession = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setFatalError(null);
    try {
      const res = await apiRequest<OnboardLoadResponse>(`/api/onboard/${encodeURIComponent(token)}`);
      setCandidate({
        ...res.candidate,
        bankDetails: {
          ...res.candidate.bankDetails,
          confirmAccountNumber:
            res.candidate.bankDetails.confirmAccountNumber ??
            res.candidate.bankDetails.accountNumber,
        },
      });
      setDocuments(res.documents);
      setEditable(res.editable);
      setTokenExpiresAt(res.tokenExpiresAt);
    } catch (err: unknown) {
      const apiErr = err as { message?: string; data?: { expired?: boolean } };
      setFatalError({
        message: apiErr?.message || 'Unable to load onboarding session.',
        expired: Boolean(apiErr?.data?.expired),
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSession();
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [loadSession]);

  const persistDraft = useCallback(
    async (candState: Candidate, silent = true) => {
      if (!token || !editable) return;
      setSaveState('saving');
      try {
        const res = await apiRequest<{ candidate: Candidate; savedAt: string }>(
          `/api/onboard/${encodeURIComponent(token)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              personalInfo: candState.personalInfo,
              addressInfo: candState.addressInfo,
              familyInfo: candState.familyInfo,
              educationInfo: candState.educationInfo,
              employmentInfo: candState.employmentInfo,
              bankDetails: candState.bankDetails,
              declaration: candState.declaration,
            }),
          }
        );
        dirtyRef.current = false;
        setSaveState('saved');
        setLastSavedTime(new Date(res.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setCandidate((prev) =>
          prev ? { ...prev, completionPct: res.candidate.completionPct, status: res.candidate.status } : prev
        );
        if (!silent) {
          addToast({ title: 'Draft saved', type: 'success' });
        }
      } catch (err) {
        setSaveState('error');
        if (!silent) {
          addToast({
            title: 'Save failed',
            description: err instanceof Error ? err.message : 'Unable to save draft.',
            type: 'error',
          });
        }
      }
    },
    [token, editable, addToast]
  );

  const updateCandidateState = (updater: (prev: Candidate) => Candidate) => {
    setCandidate((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      dirtyRef.current = true;
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        if (dirtyRef.current) {
          persistDraft(next, true);
        }
      }, 900);
      return next;
    });
  };

  const validateCurrentStep = (targetStep: number): boolean => {
    if (!candidate) return false;
    setFieldErrors({});
    let parsed: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } };

    switch (targetStep) {
      case 1:
        parsed = personalInfoSchema.safeParse(candidate.personalInfo);
        break;
      case 2:
        parsed = addressInfoSchema.safeParse({
          ...candidate.addressInfo,
          permanentAddress: candidate.addressInfo.sameAsCurrent
            ? candidate.addressInfo.currentAddress
            : candidate.addressInfo.permanentAddress,
        });
        break;
      case 3:
        parsed = familyInfoSchema.safeParse(candidate.familyInfo);
        break;
      case 4:
        parsed = educationInfoSchema.safeParse(candidate.educationInfo);
        break;
      case 5:
        parsed = employmentInfoSchema.safeParse(candidate.employmentInfo);
        break;
      case 6:
        parsed = bankDetailsSchema.safeParse(candidate.bankDetails);
        break;
      case 7: {
        const validCats = new Set(
          documents.filter((d) => d.verificationStatus !== 'Rejected').map((d) => d.category)
        );
        const missing = REQUIRED_DOCUMENT_CATEGORIES.filter((cat) => !validCats.has(cat));
        if (missing.length > 0) {
          setFieldErrors({
            documents: `Please upload valid files for required categories: ${missing.join(', ')}`,
          });
          return false;
        }
        return true;
      }
      case 8:
        parsed = declarationSchema.safeParse(candidate.declaration);
        break;
      default:
        return true;
    }

    if (!parsed.success && parsed.error) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] || 'form');
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (!candidate) return;
    if (!validateCurrentStep(step)) return;
    await persistDraft(candidate, true);
    setStep((s) => Math.min(8, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFileUpload = async (category: DocumentCategory, file: File) => {
    if (!token) return;
    setUploadingCat(category);
    try {
      const formData = new FormData();
      formData.append('category', category);
      formData.append('file', file);
      const res = await apiRequest<{ document: CandidateDocument; completionPct: number }>(
        `/api/onboard/${encodeURIComponent(token)}/documents`,
        {
          method: 'POST',
          body: formData,
        }
      );
      setDocuments((prev) => [
        ...prev.filter((d) => d.category !== category),
        res.document,
      ]);
      setCandidate((prev) => (prev ? { ...prev, completionPct: res.completionPct } : prev));
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy.documents;
        return copy;
      });
      addToast({ title: `Uploaded ${category}`, type: 'success' });
    } catch (err) {
      addToast({
        title: 'Upload Rejected',
        description: err instanceof Error ? err.message : 'Invalid file.',
        type: 'error',
      });
    } finally {
      setUploadingCat(null);
    }
  };

  const handleDeleteDoc = async (doc: CandidateDocument) => {
    if (!token) return;
    try {
      const res = await apiRequest<{ completionPct: number }>(
        `/api/onboard/${encodeURIComponent(token)}/documents/${doc.id}`,
        { method: 'DELETE' }
      );
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setCandidate((prev) => (prev ? { ...prev, completionPct: res.completionPct } : prev));
      addToast({ title: `Removed ${doc.category}`, type: 'info' });
    } catch (err) {
      addToast({
        title: 'Remove failed',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidate || !token) return;
    if (!validateCurrentStep(8)) return;

    setSubmitting(true);
    try {
      const res = await apiRequest<{ candidate: Candidate; message: string }>(
        `/api/onboard/${encodeURIComponent(token)}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({
            personalInfo: candidate.personalInfo,
            addressInfo: candidate.addressInfo,
            familyInfo: candidate.familyInfo,
            educationInfo: candidate.educationInfo,
            employmentInfo: candidate.employmentInfo,
            bankDetails: candidate.bankDetails,
            declaration: candidate.declaration,
          }),
        }
      );
      setCandidate(res.candidate);
      setEditable(false);
      addToast({ title: 'Application Submitted', description: res.message, type: 'success' });
    } catch (err) {
      addToast({
        title: 'Submission Incomplete',
        description: err instanceof Error ? err.message : 'Check required steps and try again.',
        type: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Loading View
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl p-8 space-y-4">
          <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-72 bg-slate-100 rounded animate-pulse" />
          <div className="h-40 w-full bg-slate-100 rounded animate-pulse mt-4" />
        </div>
      </div>
    );
  }

  // Invalid / Expired Link View
  if (fatalError || !candidate) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-white border border-slate-200 p-1 mx-auto mb-4 overflow-hidden">
            <img
              src="/assets/aistudio/image_0ecd2493.png"
              alt="9HR India Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            {fatalError?.expired ? 'Onboarding Link Expired' : 'Onboarding Link Unavailable'}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            {fatalError?.message}
          </p>
          <p className="text-xs text-slate-400">
            9HR India Pvt. Ltd. · Contact your assigned HR recruiter to request a fresh onboarding URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Corporate Header */}
      <header className="bg-[#0B192C] text-white border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
              <img
                src="/assets/aistudio/image_0ecd2493.png"
                alt="9HR India Pvt. Ltd. Logo"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="font-display text-base sm:text-lg font-bold leading-tight">
                9HR India Pvt. Ltd.
              </h1>
              <p className="text-xs text-slate-300">
                Candidate Onboarding · {candidate.position} ({candidate.department})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {editable && (
              <span className="text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                {saveState === 'saving'
                  ? 'Saving draft...'
                  : saveState === 'saved'
                    ? `Saved ${lastSavedTime}`
                    : saveState === 'error'
                      ? 'Autosave error'
                      : `Link expires ${new Date(tokenExpiresAt).toLocaleDateString()}`}
              </span>
            )}
            <span className="font-mono font-semibold text-emerald-300 tabular-nums">
              {candidate.completionPct}% Complete
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Candidate Context & Correction Banner */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 font-mono">{candidate.candidateCode}</p>
            <h2 className="font-display text-xl font-bold text-slate-900">
              Welcome, {candidate.fullName}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Joining Date: <span className="font-mono">{candidate.joiningDate}</span> · HR Contact:{' '}
              {candidate.assignedRecruiterName}
            </p>
          </div>
          <StatusIndicator status={candidate.status} />
        </div>

        {candidate.status === 'Correction Required' && candidate.correctionNotes && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-950 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">HR Requested Corrections Before Approval</p>
              <p className="text-xs mt-1 leading-relaxed">{candidate.correctionNotes}</p>
            </div>
          </div>
        )}

        {/* Read-Only Submitted / Approved View */}
        {!editable ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {candidate.status === 'Onboarding Completed'
                ? 'Onboarding Completed'
                : candidate.status === 'Approved'
                  ? 'Application Approved'
                  : 'Onboarding Application Submitted'}
            </h2>
            <p className="text-sm text-slate-600 max-w-lg mx-auto">
              {candidate.status === 'Onboarding Completed'
                ? `Welcome to 9HR India Pvt. Ltd.! Your employee record (${candidate.employeeCode || 'Assigned'}) has been finalized.`
                : 'Your details and documents have been received by the 9HR India HR team for verification. If any corrections are required, your recruiter will reach out.'}
            </p>
            <div className="pt-4 border-t border-slate-100 max-w-md mx-auto text-xs text-slate-500 space-y-1">
              <p>
                Digital Signature: <strong>{candidate.declaration.digitalSignature}</strong>
              </p>
              {candidate.declaration.submittedAt && (
                <p>
                  Submitted on:{' '}
                  <span className="font-mono">
                    {new Date(candidate.declaration.submittedAt).toLocaleString()}
                  </span>
                </p>
              )}
              <p>Documents Uploaded: {documents.length}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Step Sidebar */}
            <aside className="lg:col-span-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1 sticky top-6">
                {STEPS.map((s) => {
                  const isCurrent = step === s.num;
                  const isPast = step > s.num;
                  return (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => setStep(s.num)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-[#0B192C] text-white'
                          : isPast
                            ? 'text-emerald-800 bg-emerald-50/70 hover:bg-emerald-50'
                            : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[11px] ${
                            isCurrent
                              ? 'bg-emerald-500 text-white'
                              : isPast
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {isPast ? <Check className="w-3 h-3" /> : s.num}
                        </span>
                        <span>{s.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Step Form Content */}
            <section className="lg:col-span-9 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
              {/* Step 1: Personal */}
              {step === 1 && (
                <div className="space-y-5">
                  <StepHeader
                    step={1}
                    title="Personal Information"
                    subtitle="Provide your legal details as they appear on government identification."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Full Name *"
                      error={fieldErrors.fullName}
                      value={candidate.personalInfo.fullName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: { ...p.personalInfo, fullName: v },
                        }))
                      }
                    />
                    <Field
                      label="Date of Birth *"
                      type="date"
                      error={fieldErrors.dateOfBirth}
                      value={candidate.personalInfo.dateOfBirth}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: { ...p.personalInfo, dateOfBirth: v },
                        }))
                      }
                    />
                    <SelectField
                      label="Gender *"
                      error={fieldErrors.gender}
                      value={candidate.personalInfo.gender}
                      options={['Male', 'Female', 'Other', 'Prefer not to say']}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: {
                            ...p.personalInfo,
                            gender: v as Candidate['personalInfo']['gender'],
                          },
                        }))
                      }
                    />
                    <SelectField
                      label="Marital Status *"
                      error={fieldErrors.maritalStatus}
                      value={candidate.personalInfo.maritalStatus}
                      options={['Single', 'Married', 'Divorced', 'Widowed']}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: {
                            ...p.personalInfo,
                            maritalStatus: v as Candidate['personalInfo']['maritalStatus'],
                          },
                        }))
                      }
                    />
                    <Field
                      label="Mobile Number *"
                      error={fieldErrors.mobileNumber}
                      value={candidate.personalInfo.mobileNumber}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: { ...p.personalInfo, mobileNumber: v },
                        }))
                      }
                    />
                    <Field
                      label="Email Address *"
                      type="email"
                      error={fieldErrors.email}
                      value={candidate.personalInfo.email}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          personalInfo: { ...p.personalInfo, email: v },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Address */}
              {step === 2 && (
                <div className="space-y-5">
                  <StepHeader
                    step={2}
                    title="Address Information"
                    subtitle="Enter your current residential address and permanent address."
                  />
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Current Address *
                      </label>
                      <textarea
                        rows={2}
                        value={candidate.addressInfo.currentAddress}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: {
                              ...p.addressInfo,
                              currentAddress: val,
                              permanentAddress: p.addressInfo.sameAsCurrent
                                ? val
                                : p.addressInfo.permanentAddress,
                            },
                          }));
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                      {fieldErrors.currentAddress && (
                        <p className="text-xs text-red-600 mt-1">{fieldErrors.currentAddress}</p>
                      )}
                    </div>

                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={candidate.addressInfo.sameAsCurrent}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: {
                              ...p.addressInfo,
                              sameAsCurrent: checked,
                              permanentAddress: checked
                                ? p.addressInfo.currentAddress
                                : p.addressInfo.permanentAddress,
                            },
                          }));
                        }}
                      />
                      <span>Permanent address is same as current address</span>
                    </label>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Permanent Address *
                      </label>
                      <textarea
                        rows={2}
                        disabled={candidate.addressInfo.sameAsCurrent}
                        value={
                          candidate.addressInfo.sameAsCurrent
                            ? candidate.addressInfo.currentAddress
                            : candidate.addressInfo.permanentAddress
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: { ...p.addressInfo, permanentAddress: val },
                          }));
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50"
                      />
                      {fieldErrors.permanentAddress && (
                        <p className="text-xs text-red-600 mt-1">{fieldErrors.permanentAddress}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <Field
                        label="City *"
                        error={fieldErrors.city}
                        value={candidate.addressInfo.city}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: { ...p.addressInfo, city: v },
                          }))
                        }
                      />
                      <Field
                        label="State *"
                        error={fieldErrors.state}
                        value={candidate.addressInfo.state}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: { ...p.addressInfo, state: v },
                          }))
                        }
                      />
                      <Field
                        label="PIN Code (6 digits) *"
                        error={fieldErrors.pinCode}
                        value={candidate.addressInfo.pinCode}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            addressInfo: { ...p.addressInfo, pinCode: v.replace(/\D/g, '').slice(0, 6) },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Family */}
              {step === 3 && (
                <div className="space-y-5">
                  <StepHeader
                    step={3}
                    title="Family & Emergency Contact"
                    subtitle="Required for statutory records and workplace emergency contacts."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Father's Name *"
                      error={fieldErrors.fatherName}
                      value={candidate.familyInfo.fatherName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, fatherName: v },
                        }))
                      }
                    />
                    <Field
                      label="Mother's Name *"
                      error={fieldErrors.motherName}
                      value={candidate.familyInfo.motherName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, motherName: v },
                        }))
                      }
                    />
                    <Field
                      label="Spouse Name (Optional)"
                      error={fieldErrors.spouseName}
                      value={candidate.familyInfo.spouseName || ''}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, spouseName: v },
                        }))
                      }
                    />
                    <Field
                      label="Emergency Contact Name *"
                      error={fieldErrors.emergencyContactName}
                      value={candidate.familyInfo.emergencyContactName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, emergencyContactName: v },
                        }))
                      }
                    />
                    <Field
                      label="Emergency Contact Relationship *"
                      error={fieldErrors.emergencyContactRelation}
                      placeholder="e.g., Father, Spouse, Sibling"
                      value={candidate.familyInfo.emergencyContactRelation}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, emergencyContactRelation: v },
                        }))
                      }
                    />
                    <Field
                      label="Emergency Contact Phone *"
                      error={fieldErrors.emergencyContactPhone}
                      value={candidate.familyInfo.emergencyContactPhone}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          familyInfo: { ...p.familyInfo, emergencyContactPhone: v },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Step 4: Education */}
              {step === 4 && (
                <div className="space-y-5">
                  <StepHeader
                    step={4}
                    title="Educational Information"
                    subtitle="Enter details of your highest completed academic qualification."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Highest Qualification *"
                      placeholder="e.g., B.Tech Computer Science, MBA"
                      error={fieldErrors.highestQualification}
                      value={candidate.educationInfo.highestQualification}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          educationInfo: { ...p.educationInfo, highestQualification: v },
                        }))
                      }
                    />
                    <Field
                      label="College / University *"
                      error={fieldErrors.collegeUniversity}
                      value={candidate.educationInfo.collegeUniversity}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          educationInfo: { ...p.educationInfo, collegeUniversity: v },
                        }))
                      }
                    />
                    <Field
                      label="Passing Year (YYYY) *"
                      placeholder="2022"
                      error={fieldErrors.passingYear}
                      value={candidate.educationInfo.passingYear}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          educationInfo: { ...p.educationInfo, passingYear: v.replace(/\D/g, '').slice(0, 4) },
                        }))
                      }
                    />
                    <Field
                      label="Percentage / CGPA *"
                      placeholder="e.g., 8.4 CGPA or 78%"
                      error={fieldErrors.percentageOrCgpa}
                      value={candidate.educationInfo.percentageOrCgpa}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          educationInfo: { ...p.educationInfo, percentageOrCgpa: v },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Employment */}
              {step === 5 && (
                <div className="space-y-5">
                  <StepHeader
                    step={5}
                    title="Employment Information"
                    subtitle="Provide details of your most recent employment or mark as Fresher."
                  />
                  <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={candidate.employmentInfo.isFresher}
                      onChange={(e) =>
                        updateCandidateState((p) => ({
                          ...p,
                          employmentInfo: { ...p.employmentInfo, isFresher: e.target.checked },
                        }))
                      }
                    />
                    <span>I am a Fresher (No prior full-time employment)</span>
                  </label>

                  {!candidate.employmentInfo.isFresher && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field
                        label="Previous Company *"
                        error={fieldErrors.previousCompany}
                        value={candidate.employmentInfo.previousCompany || ''}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            employmentInfo: { ...p.employmentInfo, previousCompany: v },
                          }))
                        }
                      />
                      <Field
                        label="Previous Designation *"
                        error={fieldErrors.previousDesignation}
                        value={candidate.employmentInfo.previousDesignation || ''}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            employmentInfo: { ...p.employmentInfo, previousDesignation: v },
                          }))
                        }
                      />
                      <Field
                        label="Total Experience *"
                        placeholder="e.g., 4 Years"
                        error={fieldErrors.previousExperience}
                        value={candidate.employmentInfo.previousExperience || ''}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            employmentInfo: { ...p.employmentInfo, previousExperience: v },
                          }))
                        }
                      />
                      <Field
                        label="Last Working Date *"
                        type="date"
                        error={fieldErrors.lastWorkingDate}
                        value={candidate.employmentInfo.lastWorkingDate || ''}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            employmentInfo: { ...p.employmentInfo, lastWorkingDate: v },
                          }))
                        }
                      />
                      <Field
                        label="Previous CTC / Salary (Optional)"
                        placeholder="e.g., 12 LPA"
                        value={candidate.employmentInfo.previousSalary || ''}
                        onChange={(v) =>
                          updateCandidateState((p) => ({
                            ...p,
                            employmentInfo: { ...p.employmentInfo, previousSalary: v },
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step 6: Banking */}
              {step === 6 && (
                <div className="space-y-5">
                  <StepHeader
                    step={6}
                    title="Banking Information"
                    subtitle="Used exclusively for salary payroll disbursement at 9HR India Pvt. Ltd."
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label="Account Holder Name *"
                      error={fieldErrors.accountHolderName}
                      value={candidate.bankDetails.accountHolderName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          bankDetails: { ...p.bankDetails, accountHolderName: v },
                        }))
                      }
                    />
                    <Field
                      label="Bank Name *"
                      placeholder="e.g., HDFC Bank"
                      error={fieldErrors.bankName}
                      value={candidate.bankDetails.bankName}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          bankDetails: { ...p.bankDetails, bankName: v },
                        }))
                      }
                    />
                    <Field
                      label="Account Number *"
                      mono
                      error={fieldErrors.accountNumber}
                      value={candidate.bankDetails.accountNumber}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          bankDetails: {
                            ...p.bankDetails,
                            accountNumber: v.replace(/\D/g, ''),
                          },
                        }))
                      }
                    />
                    <Field
                      label="Confirm Account Number *"
                      mono
                      error={fieldErrors.confirmAccountNumber}
                      value={candidate.bankDetails.confirmAccountNumber || ''}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          bankDetails: {
                            ...p.bankDetails,
                            confirmAccountNumber: v.replace(/\D/g, ''),
                          },
                        }))
                      }
                    />
                    <Field
                      label="IFSC Code *"
                      mono
                      placeholder="HDFC0001234"
                      error={fieldErrors.ifscCode}
                      value={candidate.bankDetails.ifscCode}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          bankDetails: {
                            ...p.bankDetails,
                            ifscCode: v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              )}

              {/* Step 7: Documents */}
              {step === 7 && (
                <div className="space-y-5">
                  <StepHeader
                    step={7}
                    title="Document Upload"
                    subtitle="Upload clear PDF, JPG, JPEG, or PNG files (max 5 MB each). Files are stored privately."
                  />

                  {fieldErrors.documents && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      {fieldErrors.documents}
                    </div>
                  )}

                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                    {DOCUMENT_CATEGORIES.map((category) => {
                      const doc = documents.find((d) => d.category === category);
                      const isRequired = REQUIRED_DOCUMENT_CATEGORIES.includes(category);
                      const isUploading = uploadingCat === category;

                      return (
                        <div
                          key={category}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="text-sm font-semibold text-slate-900">
                                {category}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                {isRequired ? 'Required' : 'If applicable'}
                              </span>
                            </div>

                            {doc ? (
                              <div className="mt-1 space-y-1">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono text-slate-600 truncate max-w-[260px]">
                                    {doc.originalName}
                                  </span>
                                  <span className="text-slate-300">·</span>
                                  <span
                                    className={`font-semibold inline-flex items-center gap-1 ${
                                      doc.verificationStatus === 'Approved'
                                        ? 'text-emerald-700'
                                        : doc.verificationStatus === 'Rejected'
                                          ? 'text-red-700'
                                          : 'text-amber-700'
                                    }`}
                                  >
                                    {doc.verificationStatus === 'Rejected' && (
                                      <XCircle className="w-3 h-3" />
                                    )}
                                    {doc.verificationStatus}
                                  </span>
                                </div>
                                {doc.rejectionReason && (
                                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                                    HR Note: {doc.rejectionReason} — Please upload a replacement.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 mt-0.5">No file uploaded</p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {doc && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setPreviewDoc(doc)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDoc(doc)}
                                  className="p-1.5 text-red-600 border border-red-200 rounded-md hover:bg-red-50 cursor-pointer"
                                  title="Remove file"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}

                            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0B192C] hover:bg-[#132946] rounded-md cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              {isUploading ? 'Uploading...' : doc ? 'Replace' : 'Upload'}
                              <input
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                className="hidden"
                                disabled={isUploading}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleFileUpload(category, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 8: Declaration & Submit */}
              {step === 8 && (
                <form onSubmit={handleFinalSubmit} className="space-y-6">
                  <StepHeader
                    step={8}
                    title="Declaration & Final Submission"
                    subtitle="Review your information, confirm accuracy, and digitally sign your onboarding declaration."
                  />

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 space-y-2 leading-relaxed">
                    <p className="font-bold text-slate-900 text-sm">
                      Candidate Verification & Consent Declaration
                    </p>
                    <p>
                      I hereby declare that all personal, educational, employment, banking details, and supporting documents submitted in this onboarding portal for <strong>9HR India Pvt. Ltd.</strong> are true, complete, and accurate to the best of my knowledge.
                    </p>
                    <p>
                      I authorize 9HR India Pvt. Ltd. and its authorized background verification partners to verify the information and documents provided herein. I understand that any misrepresentation or omission may lead to withdrawal of the employment offer or termination of services.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-start gap-2.5 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={candidate.declaration.accepted}
                        onChange={(e) =>
                          updateCandidateState((p) => ({
                            ...p,
                            declaration: { ...p.declaration, accepted: e.target.checked },
                          }))
                        }
                        className="mt-1"
                      />
                      <span>
                        I have read, understood, and agree to the declaration and consent terms above.
                      </span>
                    </label>
                    {fieldErrors.accepted && (
                      <p className="text-xs text-red-600">{fieldErrors.accepted}</p>
                    )}

                    <Field
                      label="Digital Signature (Type your full legal name) *"
                      placeholder={candidate.personalInfo.fullName || 'Your Full Name'}
                      error={fieldErrors.digitalSignature}
                      value={candidate.declaration.digitalSignature}
                      onChange={(v) =>
                        updateCandidateState((p) => ({
                          ...p,
                          declaration: { ...p.declaration, digitalSignature: v },
                        }))
                      }
                    />
                  </div>

                  <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(7)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to Documents
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-60"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {submitting
                        ? 'Submitting...'
                        : candidate.status === 'Correction Required'
                          ? 'Resubmit Onboarding Application'
                          : 'Submit Final Application'}
                    </button>
                  </div>
                </form>
              )}

              {/* Step Footer Navigation (Steps 1-7) */}
              {step < 8 && (
                <div className="mt-8 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {step > 1 && (
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.max(1, s - 1))}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        Previous
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => persistDraft(candidate, false)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      Save Draft
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer"
                  >
                    Save & Continue
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Preview Uploaded Doc Modal */}
      <Modal
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.category || 'Preview'}
        subtitle={previewDoc?.originalName}
        maxWidth="max-w-3xl"
      >
        {previewDoc && token && (
          <div className="bg-slate-100 border border-slate-200 rounded-lg overflow-hidden min-h-[400px] flex items-center justify-center">
            {previewDoc.mimeType === 'application/pdf' ? (
              <iframe
                src={`/api/onboard/${encodeURIComponent(token)}/documents/${previewDoc.id}/file`}
                title={previewDoc.originalName}
                className="w-full h-[480px]"
              />
            ) : (
              <img
                src={`/api/onboard/${encodeURIComponent(token)}/documents/${previewDoc.id}/file`}
                alt={previewDoc.originalName}
                className="max-h-[480px] w-auto object-contain"
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StepHeader({
  step,
  title,
  subtitle,
}: {
  step: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="pb-4 border-b border-slate-100">
      <p className="text-xs font-semibold text-emerald-700 mb-0.5">Step {step} of 8</p>
      <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = 'text',
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 ${
          mono ? 'font-mono' : ''
        } ${error ? 'border-red-400 bg-red-50/30' : 'border-slate-300'}`}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: string[];
  error?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600 ${
          error ? 'border-red-400' : 'border-slate-300'
        }`}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
