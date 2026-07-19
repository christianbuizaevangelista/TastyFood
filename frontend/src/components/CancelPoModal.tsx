import { useState, ChangeEvent } from 'react';
import { api, apiError } from '../api/client';
import { Alert } from './ui';

// Cancelling a PO always records why, and optionally carries proof that the
// buyer was reimbursed. The buyer is emailed the reason automatically.
export function CancelPoModal({
  poNumber,
  poId,
  onClose,
  onDone,
}: {
  poNumber: string;
  poId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 3 * 1024 * 1024) {
      setErr('Proof of reimbursement is too large (max 3 MB).');
      return;
    }
    setErr(null);
    setFile(f);
  }

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(f);
    });
  }

  async function submit() {
    if (!reason.trim()) {
      setErr('Please give a reason for cancelling.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const reimbursementProof = file
        ? {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64: await fileToDataUrl(file),
          }
        : undefined;
      await api.post(`/purchase-orders/${poId}/cancel`, { reason: reason.trim(), reimbursementProof });
      onDone();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-slate-900">Cancel {poNumber}</h2>
        <p className="mt-1 text-sm text-slate-500">
          The buyer will be emailed the reason below. Any stock, Mana, and sales effects are reversed.
        </p>

        <div className="mt-4 space-y-3">
          {err && <Alert>{err}</Alert>}

          <div>
            <label className="label">Reason for cancelling *</label>
            <textarea
              className="input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Out of stock, buyer requested cancellation, wrong order encoded…"
              autoFocus
            />
          </div>

          <div>
            <label className="label">Proof of reimbursement (optional)</label>
            <input type="file" className="input" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={pick} />
            <p className="mt-1 text-xs text-slate-400">
              Attach a receipt or transfer screenshot if the buyer was already paid back. Image or PDF, max 3 MB.
            </p>
            {file && <p className="mt-1 text-xs text-slate-600">Attached: {file.name}</p>}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Keep order
          </button>
          <button
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            onClick={submit}
            disabled={busy}
          >
            {busy ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      </div>
    </div>
  );
}
