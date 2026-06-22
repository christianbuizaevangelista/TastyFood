import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Loc {
  code: string;
  name: string;
}

// Cascading Philippine address picker: Province → City/Municipality → Barangay,
// plus a free-text street/house line. Calls onChange with the composed address.
// Falls back to a plain text field if the location service is unavailable.
export default function AddressPicker({ onChange }: { onChange: (address: string) => void }) {
  const [provinces, setProvinces] = useState<Loc[]>([]);
  const [cities, setCities] = useState<Loc[]>([]);
  const [barangays, setBarangays] = useState<Loc[]>([]);

  const [province, setProvince] = useState<Loc | null>(null);
  const [city, setCity] = useState<Loc | null>(null);
  const [barangay, setBarangay] = useState<Loc | null>(null);
  const [street, setStreet] = useState('');

  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ provinces: Loc[] }>('/locations/provinces')
      .then((r) => setProvinces(r.data.provinces))
      .catch(() => setFailed(true));
  }, []);

  // Recompose and bubble up the full address whenever a part changes.
  useEffect(() => {
    const parts = [
      street.trim(),
      barangay ? `Brgy. ${barangay.name}` : '',
      city?.name ?? '',
      province?.name ?? '',
    ].filter(Boolean);
    onChange(parts.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, barangay, city, province]);

  async function pickProvince(code: string) {
    const p = provinces.find((x) => x.code === code) ?? null;
    setProvince(p);
    setCity(null);
    setBarangay(null);
    setCities([]);
    setBarangays([]);
    if (!p) return;
    setLoading(true);
    try {
      const r = await api.get<{ cities: Loc[] }>(`/locations/provinces/${code}/cities`);
      setCities(r.data.cities);
    } finally {
      setLoading(false);
    }
  }

  async function pickCity(code: string) {
    const c = cities.find((x) => x.code === code) ?? null;
    setCity(c);
    setBarangay(null);
    setBarangays([]);
    if (!c) return;
    setLoading(true);
    try {
      const r = await api.get<{ barangays: Loc[] }>(`/locations/cities/${code}/barangays`);
      setBarangays(r.data.barangays);
    } finally {
      setLoading(false);
    }
  }

  if (failed) {
    // Graceful fallback: plain address textarea.
    return (
      <input
        className="input"
        placeholder="Complete address"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select className="input" value={province?.code ?? ''} onChange={(e) => pickProvince(e.target.value)}>
          <option value="">Province…</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>{p.name}</option>
          ))}
        </select>
        <select className="input" value={city?.code ?? ''} disabled={!province} onChange={(e) => pickCity(e.target.value)}>
          <option value="">{province ? 'City / Municipality…' : 'Select province first'}</option>
          {cities.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <select
          className="input"
          value={barangay?.code ?? ''}
          disabled={!city}
          onChange={(e) => setBarangay(barangays.find((x) => x.code === e.target.value) ?? null)}
        >
          <option value="">{city ? 'Barangay…' : 'Select city first'}</option>
          {barangays.map((b) => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </div>
      <input
        className="input"
        placeholder="House no. / Street / Purok"
        value={street}
        onChange={(e) => setStreet(e.target.value)}
      />
      {loading && <p className="text-xs text-slate-400">Loading…</p>}
    </div>
  );
}
