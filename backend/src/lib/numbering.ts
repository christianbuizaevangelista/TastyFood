// Generates a human-friendly document number with a random suffix.
function suffix(): string {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

export function poNumber(): string {
  const d = new Date();
  return `PO-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${suffix()}`;
}

export function saleNumber(): string {
  const d = new Date();
  return `SO-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${suffix()}`;
}
