import { useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert, EmptyState } from '../components/ui';
import { dateTime } from '../lib/format';

interface Material {
  id: string;
  title: string;
  description?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  applicationTier?: string | null;
  createdAt: string;
}

// Tagging a file as the application form for a tier is what makes it the one
// an online applicant is sent after applying.
const TIERS = ['PROVINCIAL', 'CITY', 'RESELLER', 'RETAIL'] as const;
const TIER_LABEL: Record<string, string> = {
  PROVINCIAL: 'Provincial Distributor',
  CITY: 'City Distributor',
  RESELLER: 'Reseller',
  RETAIL: 'Retail Distributor',
};

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(mime: string) {
  if (mime.includes('pdf')) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
  return '📦';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export default function Materials() {
  const { user } = useAuth();
  const isPrincipal = user!.role === 'PRINCIPAL';
  const { data, loading, error, refetch } = useFetch<{ materials: Material[] }>('/materials');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload() {
    setErr(null);
    if (!title.trim()) return setErr('Enter a title.');
    if (!file) return setErr('Choose a file to upload.');
    if (file.size > 3 * 1024 * 1024) return setErr('File too large (max 3 MB).');
    setBusy(true);
    try {
      await api.post('/materials', {
        title: title.trim(),
        description: description.trim() || undefined,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64: await fileToDataUrl(file),
        applicationTier: tier || null,
      });
      setTitle('');
      setDescription('');
      setTier('');
      setFile(null);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  // Retag without re-uploading — the file itself is unchanged.
  async function retag(m: Material, applicationTier: string) {
    setErr(null);
    try {
      await api.patch(`/materials/${m.id}`, { applicationTier: applicationTier || null });
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function download(m: Material) {
    setErr(null);
    try {
      const res = await api.get(`/materials/${m.id}/content`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = m.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setErr(apiError(e));
    }
  }

  async function remove(m: Material) {
    if (!confirm(`Delete "${m.title}"? Distributors will no longer see it.`)) return;
    try {
      await api.delete(`/materials/${m.id}`);
      refetch();
    } catch (e) {
      setErr(apiError(e));
    }
  }

  const materials = data?.materials ?? [];

  return (
    <div>
      <PageHeader
        title="Downloadables"
        subtitle="Materials shared by Tasty Food — download what you need"
      />

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <div className={`grid grid-cols-1 gap-6 ${isPrincipal ? 'lg:grid-cols-3' : ''}`}>
        {isPrincipal && (
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Upload material</h2>
            <label className="label">Title</label>
            <input className="input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 2026 Price List" />
            <label className="label">Description (optional)</label>
            <textarea className="input mb-3" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            <label className="label">Official application form for</label>
            <select className="input mb-1" value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">— not an application form —</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>{TIER_LABEL[t]}</option>
              ))}
            </select>
            <p className="mb-3 text-xs text-slate-400">
              Tagged files are emailed automatically to anyone who applies online for that level.
            </p>
            <label className="label">File (max 3 MB)</label>
            <input type="file" className="mb-3 text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <div className="mb-3 text-xs text-green-600">✓ {file.name} ({fmtSize(file.size)})</div>}
            <button className="btn-primary w-full" disabled={busy} onClick={upload}>
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        )}

        <div className={isPrincipal ? 'lg:col-span-2' : ''}>
          {loading ? (
            <Spinner />
          ) : error ? (
            <Alert>{error}</Alert>
          ) : materials.length === 0 ? (
            <EmptyState>No materials available yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {materials.map((m) => (
                <div key={m.id} className="card flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-2xl">{fileIcon(m.mimeType)}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{m.title}</div>
                      {m.description && <div className="truncate text-xs text-slate-500">{m.description}</div>}
                      {isPrincipal ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-slate-400">Application form for</span>
                          <select
                            className="input h-7 w-48 py-0 text-xs"
                            value={m.applicationTier ?? ''}
                            onChange={(e) => retag(m, e.target.value)}
                          >
                            <option value="">— none —</option>
                            {TIERS.map((t) => (
                              <option key={t} value={t}>{TIER_LABEL[t]}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        m.applicationTier && (
                          <div className="mt-1">
                            <span className="badge bg-brand-50 text-brand-700">
                              Application form · {TIER_LABEL[m.applicationTier] ?? m.applicationTier}
                            </span>
                          </div>
                        )
                      )}
                      <div className="text-xs text-slate-400">
                        {m.fileName} · {fmtSize(m.size)} · {dateTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button className="btn-primary text-xs" onClick={() => download(m)}>Download</button>
                    {isPrincipal && (
                      <button className="text-xs text-red-600 hover:underline" onClick={() => remove(m)}>Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
