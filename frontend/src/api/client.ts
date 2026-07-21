import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

// The session is an httpOnly cookie (set by the API on login), so JS never
// touches the token. withCredentials makes the browser attach that cookie to
// every API request automatically.
export const api = axios.create({ baseURL, withCredentials: true });

// Pages that anonymous visitors are meant to reach. A 401 on these is normal
// (e.g. the landing page's own /auth/me probe) and must NOT bounce them away.
const PUBLIC_PATHS = ['/login', '/set-password', '/join', '/apply'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const onPublicPage = PUBLIC_PATHS.some((p) => location.pathname.startsWith(p));
    // Session expired/invalid — bounce to login, but never from a public page.
    if (err.response?.status === 401 && !onPublicPage) {
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
