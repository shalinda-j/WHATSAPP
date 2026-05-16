import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../config';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('token'),
  );
  const [loading, setLoading] = useState(true);

  const login = (newToken: string) => {
    setToken(newToken);
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('token');
    setUser(null);
  };

  useEffect(() => {
    // Guard against the double-logout race: the axios interceptor in
    // src/config.ts already calls logout()+ redirects on a 401, which
    // setToken(null), which re-triggers this effect. Without the
    // `cancelled` latch the second pass could log a confusing error
    // and re-clear localStorage during the redirect.
    let cancelled = false;
    if (token) {
      localStorage.setItem('token', token);
      api
        .get('/api/auth/me')
        .then((res) => {
          if (!cancelled) setUser(res.data);
        })
        .catch(() => {
          if (!cancelled) logout();
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      localStorage.removeItem('token');
      setUser(null);
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
