import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

// The session is an httpOnly cookie (set by the API on login), so JS never
// touches the token. withCredentials makes the browser attach that cookie to
// every API request automatically.
export const api = axios.create({ baseURL, withCredentials: true });

// Pages that anonymous visitors are meant to reach. A 401 on these is normal
// (e.g. the landing page's own /auth/me probe) and must NOT bounce them away.
const PUBLIC_PATHS = ['/login', '/set-password', '/join', '/apply', '/track', '/shop'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const onPublicPage = PUBLIC_PATHS.some((p) => location.pathname.startsWith(p));
    // "Who am I" is a question, not a failure: a 401 from it is simply the
    // answer "nobody", which is exactly what an anonymous visitor on the root
    // landing page gets. Bouncing on it would send them to a login screen they
    // never asked for. Every other 401 still means a session went away.
    const isAuthProbe = (err.config?.url ?? '').includes('/auth/me');
    if (err.response?.status === 401 && !onPublicPage && !isAuthProbe) {
      location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error || err.message;
  }
  return 'Unexpected error';
}
