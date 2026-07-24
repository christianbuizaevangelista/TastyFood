// Meta (Facebook) Pixel for the public JuanPalaman shop only — it is what lets a
// Sales campaign optimise toward people who actually buy, and powers retargeting
// of visitors who didn't. Loaded lazily from the shop pages (never on the signed
// -in DMS), so only shoppers are tracked.
//
// The app runs a strict CSP (script-src 'self'), so we can't paste Facebook's
// inline snippet. Instead the fbq stub is defined here in our OWN bundle ('self',
// allowed) and only fbevents.js is fetched from connect.facebook.net — which the
// CSP in vercel.json explicitly allows.

const PIXEL_ID = '753803000414526';

declare global {
  interface Window {
    fbq?: FbqFn & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
  }
}
type FbqFn = (...args: unknown[]) => void;

let started = false;

// Inject fbevents.js + init the pixel once, then fire the initial PageView.
export function initPixel(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const w = window;
  if (!w.fbq) {
    const n: FbqFn & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown } =
      function (...args: unknown[]) {
        n.callMethod ? n.callMethod(...args) : n.queue!.push(args);
      } as never;
    n.queue = [];
    n.loaded = true;
    n.version = '2.0';
    n.push = n;
    w.fbq = n;
    w._fbq = n;

    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }

  w.fbq!('init', PIXEL_ID);
  w.fbq!('track', 'PageView');
}

// Fire a standard event (no-op until the pixel is initialised).
export function track(event: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  window.fbq('track', event, params);
}
