import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, Eye, FileCheck2, XCircle } from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { EmptyState, Modal, TableSkeleton } from '../components/ui/Primitives.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiRequest, fetchAuthorizedBlobUrl } from '../lib/api.ts';
import { hasPermission } from '../shared/rbac.ts';
import { CandidateDocument } from '../shared/types.ts';

interface QueueDoc extends CandidateDocument {
  candidateCode: string;
  candidateName: string;
  candidateDepartment: string;
  candidateStatus: string;
  isDemo: boolean;
}

export default function DocumentVerificationPage() {
  const { user, addToast } = useAuth();
  const canApproveDocs = hasPermission(user?.effectivePermissions, 'documents', 'approve');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Pending' | 'Approved' | 'Rejected'>('Pending');
  const [items, setItems] = useState<QueueDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [previewDoc, setPreviewDoc] = useState<{ doc: QueueDoc; blobUrl: string } | null>(null);
  const [rejectDoc, setRejectDoc] = useState<QueueDoc | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ items: QueueDoc[] }>(
        `/api/documents/queue?status=${statusFilter}`
      );
      setItems(res.items);
    } catch (err) {
      addToast({
        title: 'Failed to load document queue',
        description: err instanceof Error ? err.message : 'Error',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, addToast]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const openPreview = async (doc: QueueDoc) => {
    try {
      const blobUrl = await fetchAuthorizedBlobUrl(`/api/documents/${doc.id}/file`);
      setPreviewDoc({ doc, blobUrl });
    } catch {
      addToast({ title: 'Unable to open document preview', type: 'error' });
    }
  };

  const handleDownload = async (doc: QueueDoc) => {
    try {
      const blobUrl = await fetchAuthorizedBlobUrl(`/api/documents/${doc.id}/file?download=1`);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = doc.originalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      addToast({ title: 'Download failed', type: 'error' });
    }
  };

  const verifyDoc = async (docId: string, status: 'Approved' | 'Rejected', reason = '') => {
    setBusy(true);
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
      await loadQueue();
    } catch (err) {
      addToast({
        title: 'Verification error',
        description: err instanceof Error ? err.message : 'Failed',
        type: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout
      title="Document Verification Queue"
      breadcrumb="9HR India Pvt. Ltd. · Compliance & KYC Review"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(['Pending', 'Approved', 'Rejected', 'ALL'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'ALL' ? 'All Documents' : st}
            </button>
          ))}
        </div>
        <span className="text-xs font-mono text-slate-500 tabular-nums">
          {items.length} document{items.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="w-6 h-6" />}
          title="No documents in this queue"
          description="Uploaded candidate verification files matching this status filter will appear here."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Document Category</th>
                  <th className="py-3 px-4">File</th>
                  <th className="py-3 px-4">Uploaded</th>
                  <th className="py-3 px-4">Verification</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {items.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <Link
                        to={`/candidates/${d.candidateId}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700"
                      >
                        {d.candidateName}
                      </Link>
                      <div className="text-xs font-mono text-slate-500">
                        {d.candidateCode} · {d.candidateDepartment}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">{d.category}</td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-600">
                      {d.originalName} ({(d.sizeBytes / 1024).toFixed(1)} KB)
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600">
                      {d.uploadedAt.slice(0, 10)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          d.verificationStatus === 'Approved'
                            ? 'text-emerald-700'
                            : d.verificationStatus === 'Rejected'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {d.verificationStatus}
                      </span>
                      {d.rejectionReason && (
                        <p className="text-[11px] text-red-600 max-w-xs truncate">
                          {d.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPreview(d)}
                          className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(d)}
                          className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        {canApproveDocs && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => verifyDoc(d.id, 'Approved')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setRejectDoc(d);
                                setRejectReason('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(previewDoc)}
        onClose={() => {
          if (previewDoc) URL.revokeObjectURL(previewDoc.blobUrl);
          setPreviewDoc(null);
        }}
        title={previewDoc?.doc.category || 'Preview'}
        subtitle={`${previewDoc?.doc.candidateName || ''} · ${previewDoc?.doc.originalName || ''}`}
        maxWidth="max-w-3xl"
      >
        {previewDoc && (
          <div className="bg-slate-100 border border-slate-200 rounded-lg overflow-hidden min-h-[420px] flex items-center justify-center">
            {previewDoc.doc.mimeType === 'application/pdf' ? (
              <iframe src={previewDoc.blobUrl} title="Document Preview" className="w-full h-[500px]" />
            ) : (
              <img
                src={previewDoc.blobUrl}
                alt={previewDoc.doc.originalName}
                className="max-h-[500px] w-auto object-contain"
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(rejectDoc)}
        onClose={() => setRejectDoc(null)}
        title={`Reject ${rejectDoc?.category || 'Document'}`}
        subtitle={`Candidate: ${rejectDoc?.candidateName || ''}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (rejectDoc) verifyDoc(rejectDoc.id, 'Rejected', rejectReason);
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
              placeholder="Explain why this document was rejected..."
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
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
            >
              Reject Document
            </button>
          </div>
        </form>
      </Modal>
    </AppLayout>
  );
}
