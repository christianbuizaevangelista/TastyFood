import { FormEvent, useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useFetch } from '../lib/useFetch';
import { PageHeader, Spinner, Alert } from '../components/ui';
import { ROLE_LABEL } from '../lib/nav';
import { Org } from '../types';

export default function Account() {
  const { user } = useAuth();
  const { data: org, loading, error, refetch } = useFetch<Org>(`/orgs/${user!.org.id}`);

  const [form, setForm] = useState({ address: '', contactPhone: '', contactEmail: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Seed the editable fields once the org loads.
  useEffect(() => {
    if (org) {
      setForm({
        address: org.address ?? '',
        contactPhone: org.contactPhone ?? '',
        contactEmail: org.contactEmail ?? '',
      });
    }
  }, [org]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      await api.patch(`/orgs/${user!.org.id}`, {
        address: form.address,
        contactPhone: form.contactPhone,
        // Email validated by the API; omit if blank to avoid a validation error.
        contactEmail: form.contactEmail || undefined,
      });
      setMsg('Account settings saved.');
      refetch();
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Account Settings" subtitle="Manage your business contact details" />

      <form onSubmit={save} className="card space-y-4">
        {err && <Alert>{err}</Alert>}
        {msg && <Alert kind="success">{msg}</Alert>}

        {/* Read-only identity */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input className="input bg-slate-50 text-slate-500" value={user!.name} disabled readOnly />
          </div>
          <div>
            <label className="label">Position</label>
            <input className="input bg-slate-50 text-slate-500" value={ROLE_LABEL[user!.role]} disabled readOnly />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
          Name and Position cannot be changed. Update your business details below.
        </div>

        {/* Editable business details */}
        <div>
          <label className="label">Business Address</label>
          <input
            className="input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="e.g. 123 Rizal St., General Trias, Cavite"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Cellphone Number</label>
            <input
              className="input"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              placeholder="e.g. 0917 123 4567"
            />
          </div>
          <div>
            <label className="label">Email Address</label>
            <input
              className="input"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              placeholder="business@email.com"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      <p className="mt-3 text-xs text-slate-400">
        Organization: {org?.name} · This email is your business contact address shown on orders, not
        your sign-in email.
      </p>
    </div>
  );
}
