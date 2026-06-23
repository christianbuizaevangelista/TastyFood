import { FormEvent, useEffect, useState } from 'react';
import { api, apiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { NAV } from '../lib/nav';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
  isActive: boolean;
  permissions: string[];
  pending: boolean;
}

// Grantable modules (those with a permission key) the current owner's role can reach.
function permOptions(role: string) {
  return NAV.filter((n) => n.perm && n.roles.includes(role as any)).map((n) => ({
    key: n.perm as string,
    label: n.label,
    icon: n.icon,
  }));
}

export default function Users() {
  const { user } = useAuth();
  const options = permOptions(user!.role);

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state — used for both "add" (no id) and "edit" (id set).
  const [editing, setEditing] = useState<null | { id?: string; name: string; email: string; perms: Set<string>; isActive: boolean }>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/users');
      setUsers(data.users);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setEditing({ name: '', email: '', perms: new Set(), isActive: true });
  }
  function openEdit(u: StaffUser) {
    setEditing({ id: u.id, name: u.name, email: u.email, perms: new Set(u.permissions), isActive: u.isActive });
  }
  function togglePerm(key: string) {
    if (!editing) return;
    const next = new Set(editing.perms);
    next.has(key) ? next.delete(key) : next.add(key);
    setEditing({ ...editing, perms: next });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (editing.id) {
        await api.patch(`/users/${editing.id}`, {
          name: editing.name,
          permissions: [...editing.perms],
          isActive: editing.isActive,
        });
        setNotice('Changes saved.');
      } else {
        const { data } = await api.post('/users', {
          name: editing.name,
          email: editing.email,
          permissions: [...editing.perms],
        });
        setNotice(
          data.invite?.sent
            ? `Invite emailed to ${editing.email}.`
            : `User created, but the invite email could not be sent (${data.invite?.reason ?? 'email not configured'}). Use "Resend invite" once email is set up.`
        );
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend(u: StaffUser) {
    setNotice(null);
    setError(null);
    try {
      const { data } = await api.post(`/users/${u.id}/resend-invite`);
      setNotice(data.invite?.sent ? `Invite re-sent to ${u.email}.` : `Could not send invite (${data.invite?.reason ?? 'email not configured'}).`);
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function remove(u: StaffUser) {
    if (!confirm(`Remove ${u.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  const labelFor = (key: string) => options.find((o) => o.key === key)?.label ?? key;

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="As owner, add team members and choose exactly which modules each one can access."
        action={
          <button className="btn-primary" onClick={openAdd}>
            + Invite staff
          </button>
        }
      />

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert kind="success">{notice}</Alert></div>}

      {loading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState>No users yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="td">Name</th>
                <th className="td">Email</th>
                <th className="td">Role</th>
                <th className="td">Status</th>
                <th className="td">Access</th>
                <th className="td text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="td font-medium">{u.name}</td>
                  <td className="td text-slate-500">{u.email}</td>
                  <td className="td">
                    {u.isOwner ? (
                      <span className="badge bg-amber-100 text-amber-800">Owner</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-600">Staff</span>
                    )}
                  </td>
                  <td className="td">
                    {u.isOwner ? (
                      <span className="badge bg-green-100 text-green-700">Active</span>
                    ) : u.pending ? (
                      <span className="badge bg-amber-100 text-amber-700">Pending invite</span>
                    ) : u.isActive ? (
                      <span className="badge bg-green-100 text-green-700">Active</span>
                    ) : (
                      <span className="badge bg-red-100 text-red-700">Disabled</span>
                    )}
                  </td>
                  <td className="td">
                    {u.isOwner ? (
                      <span className="text-xs text-slate-400">Full control</span>
                    ) : u.permissions.length === 0 ? (
                      <span className="text-xs text-slate-400">Dashboard only</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.permissions.map((p) => (
                          <span key={p} className="badge bg-sky-100 text-sky-700">{labelFor(p)}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="td text-right">
                    {!u.isOwner && (
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost text-xs" onClick={() => openEdit(u)}>Edit</button>
                        {u.pending && (
                          <button className="btn-ghost text-xs" onClick={() => resend(u)}>Resend invite</button>
                        )}
                        <button className="text-xs text-red-600 hover:underline" onClick={() => remove(u)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-slate-900">
              {editing.id ? 'Edit staff access' : 'Invite a staff member'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label">Full name</label>
                <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  disabled={!!editing.id}
                  required
                />
                {!editing.id && (
                  <p className="mt-1 text-xs text-slate-400">We'll email them a link to set their own password.</p>
                )}
              </div>
              <div>
                <label className="label">Assigned tasks (module access)</label>
                <div className="grid grid-cols-2 gap-2">
                  {options.map((o) => (
                    <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-brand-400">
                      <input type="checkbox" checked={editing.perms.has(o.key)} onChange={() => togglePerm(o.key)} />
                      <span>{o.icon} {o.label}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-400">Dashboard &amp; Account Settings are always available.</p>
              </div>
              {editing.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                  Account active (can sign in)
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Send invite'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
