import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type User } from '../api/client';

interface AuthState {
  user: User | null;
  // True until the first session check finishes, so a refresh doesn't flash the login page.
  loading: boolean;
  // Set when the session check failed for a reason other than being logged out.
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((res) => setUser(res.user))
      .catch((err: ApiError) => {
        if (err.status !== 401) setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api<{ user: User }>('/auth/login', { email, password });
    setError(null);
    setUser(res.user);
  };

  const logout = async () => {
    await api('/auth/logout', {});
    setUser(null);
  };

  const markPasswordChanged = () => setUser((u) => u && { ...u, mustChangePassword: false });

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, markPasswordChanged }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
