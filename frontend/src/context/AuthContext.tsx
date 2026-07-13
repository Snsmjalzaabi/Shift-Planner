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
  hasAccess: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  verifyCcadAccess: (email: string, code: string) => Promise<void>;
  activateTestSubscription: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

function canAccess(user: AuthUser | null) {
  if (!user) return false;
  if (user.is_superuser) return true;
  if (user.access_active) return true;
  if (user.account_type === "ccad_free" && user.email_verified) return true;
  if (user.account_type === "paid_subscription" && user.subscription_active) return true;
  return false;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const savedToken = await loadToken();
        if (savedToken) {
          setToken(savedToken);
          const cached = await loadCachedUser();
          if (cached) {
            try {
              setUser(JSON.parse(cached) as AuthUser);
            } catch {
              // ignore parse
            }
          }
          // background refresh
          try {
            const fresh = await api.me(savedToken);
            setUser(fresh);
            await saveCachedUser(JSON.stringify(fresh));
          } catch {
            // token invalid → clear
            await clearToken();
            await clearCachedUser();
            setToken(null);
            setUser(null);
          }
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

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
      router.replace("/(app)/dashboard");
    },
    [],
  );

  const verifyCcadAccess = useCallback(async (email: string, code: string) => {
    if (!token) throw new Error("You must sign in first.");
    const updated = await api.verifyCcad(token, email, code);
    setUser(updated);
    await saveCachedUser(JSON.stringify(updated));
  }, [token]);

  const activateTestSubscription = useCallback(async () => {
    if (!token) throw new Error("You must sign in first.");
    const updated = await api.mockSubscribe(token);
    setUser(updated);
    await saveCachedUser(JSON.stringify(updated));
  }, [token]);

  const logout = useCallback(async () => {
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

  const hasAccess = canAccess(user);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token && !!user,
      hasAccess,
      login,
      register,
      verifyCcadAccess,
      activateTestSubscription,
      logout,
      refresh,
    }),
    [user, token, isLoading, hasAccess, login, register, verifyCcadAccess, activateTestSubscription, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
