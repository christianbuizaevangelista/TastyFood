export function peso(n: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function pesoExact(n: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n || 0);
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-US').format(n || 0);
}

export function pct(n: number): string {
  return `${(n || 0).toFixed(1)}%`;
}

export function date(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dateTime(d: string | Date): string {
  return new Date(d).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
