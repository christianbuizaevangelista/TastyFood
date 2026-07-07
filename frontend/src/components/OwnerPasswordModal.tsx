import { useState } from 'react';
import { Alert } from './ui';

// Prompts the Principal owner for their password to authorize overselling
// (transacting beyond available stock). Calls onConfirm(password).
export function OwnerPasswordModal({
  message,
  error,
  busy,
  onConfirm,
  onClose,
}: {
  message: string;
  error?: string | null;
  busy?: boolean;
  onConfirm: (password: string) => void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-bold text-slate-900">Owner authorization required</h2>
        <p className="mb-4 text-sm text-slate-500">{message}</p>
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        <label className="label">Owner password</label>
        <input
          type="password"
          className="input"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && pw) onConfirm(pw); }}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={busy || !pw} onClick={() => onConfirm(pw)}>
            {busy ? 'Verifying…' : 'Confirm & proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}
