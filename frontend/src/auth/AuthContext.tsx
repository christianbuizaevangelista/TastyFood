import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      // The session cookie is httpOnly, so we can't read it — just ask the API
      // who we are. 200 = still signed in, 401 = not.
      try {
        const { data } = await api.get('/auth/me');
        setUser(data);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore — clear locally regardless
    }
    setUser(null);
    location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
