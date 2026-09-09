import { router } from "expo-router";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api, AuthUser } from "@/src/lib/api";
import {
  configureApplePurchases,
  disconnectApplePurchases,
  isApplePurchaseConfigured,
} from "@/src/lib/applePurchases";
import {
  clearCachedUser,
  clearToken,
  loadCachedUser,
  loadToken,
  saveCachedUser,
  saveToken,
} from "@/src/utils/authStorage";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const savedToken = await loadToken();
        if (savedToken) {
          if (!active) return;
          setToken(savedToken);

          let cachedUser: AuthUser | null = null;
          const cached = await loadCachedUser();
          if (cached) {
            try {
              cachedUser = JSON.parse(cached) as AuthUser;
              if (!active) return;
              setUser(cachedUser);
              // Let the app open with the saved session while Render wakes.
              // The profile refresh below still corrects stale account data.
              setIsLoading(false);
            } catch {
              // ignore parse
            }
          }
          try {
            const fresh = await api.me(savedToken);
            if (!active) return;
            setUser(fresh);
            await saveCachedUser(JSON.stringify(fresh));
          } catch {
            // A network timeout is not proof that the session is invalid. Keep
            // a valid cached profile so a free-tier cold start cannot trap the
            // user on the startup spinner or sign them out.
            if (!cachedUser) {
              await clearToken();
              await clearCachedUser();
              if (!active) return;
              setToken(null);
              setUser(null);
            }
          }
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token || !user?.id || !isApplePurchaseConfigured()) return;
    let active = true;
    (async () => {
      try {
        await configureApplePurchases(user.id);
        const verified = await api.verifyAppleSubscription(token);
        if (active) {
          setUser(verified.user);
          await saveCachedUser(JSON.stringify(verified.user));
        }
      } catch {
        // Keep cached access during temporary App Store/backend outages.
      }
    })();
    return () => {
      active = false;
    };
  }, [token, user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api.login(email, password);
    setToken(resp.access_token);
    setUser(resp.user);
    await saveToken(resp.access_token);
    await saveCachedUser(JSON.stringify(resp.user));
    router.replace("/(app)/dashboard");
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const resp = await api.register(email, password, displayName);
      setToken(resp.access_token);
      setUser(resp.user);
      await saveToken(resp.access_token);
      await saveCachedUser(JSON.stringify(resp.user));
      return resp.registration_message || null;
    },
    [],
  );

  const logout = useCallback(async () => {
    await disconnectApplePurchases().catch(() => {});
    await clearToken();
    await clearCachedUser();
    setToken(null);
    setUser(null);
    router.replace("/(auth)/login");
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const fresh = await api.me(token);
      setUser(fresh);
      await saveCachedUser(JSON.stringify(fresh));
    } catch {
      // ignore
    }
  }, [token]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token && !!user,
      login,
      register,
      logout,
      refresh,
    }),
    [user, token, isLoading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
