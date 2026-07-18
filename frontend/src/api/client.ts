import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

// The session is an httpOnly cookie (set by the API on login), so JS never
// touches the token. withCredentials makes the browser attach that cookie to
// every API request automatically.
export const api = axios.create({ baseURL, withCredentials: true });

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Session expired/invalid — bounce to login (unless already there).
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
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
