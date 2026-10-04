import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { API_ENDPOINTS, authorizationHeader } from "@/lib/api";

export type UserProfile = {
  id: number;
  name: string;
  email: string;
  role?: string;
};

type AuthSessionContextValue = {
  user: UserProfile | null;
  isLoading: boolean;
  setAuthenticatedUser: (user: UserProfile) => void;
  clearSession: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadSession = async () => {
      try {
        const [token, storedUser] = await Promise.all([
          SecureStore.getItemAsync("roadguard_access_token"),
          SecureStore.getItemAsync("roadguard_user"),
        ]);
        if (!isActive) return;
        if (!token || !storedUser) {
          await Promise.all([
            SecureStore.deleteItemAsync("roadguard_access_token"),
            SecureStore.deleteItemAsync("roadguard_user"),
          ]);
          return;
        }

        const parsed: unknown = JSON.parse(storedUser);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "id" in parsed &&
          typeof parsed.id === "number" &&
          Number.isSafeInteger(parsed.id) &&
          parsed.id > 0 &&
          "name" in parsed &&
          typeof parsed.name === "string" &&
          "email" in parsed &&
          typeof parsed.email === "string" &&
          "role" in parsed &&
          (parsed.role === "user" || parsed.role === "admin")
        ) {
          const restoredUser: UserProfile = {
            id: parsed.id,
            name: parsed.name,
            email: parsed.email,
            role: parsed.role,
          };
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(API_ENDPOINTS.reports, {
              headers: authorizationHeader(token),
              signal: controller.signal,
            });
            if (response.status === 401 || response.status === 403) {
              await Promise.all([
                SecureStore.deleteItemAsync("roadguard_access_token"),
                SecureStore.deleteItemAsync("roadguard_user"),
              ]);
              return;
            }
          } catch {
            // Keep a cached session during temporary network outages.
          } finally {
            clearTimeout(timeoutId);
          }
          if (isActive) setUser(restoredUser);
        } else {
          await Promise.all([
            SecureStore.deleteItemAsync("roadguard_access_token"),
            SecureStore.deleteItemAsync("roadguard_user"),
          ]);
        }
      } catch {
        if (isActive) {
          setUser(null);
          await Promise.all([
            SecureStore.deleteItemAsync("roadguard_access_token"),
            SecureStore.deleteItemAsync("roadguard_user"),
          ]);
        }
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void loadSession();
    return () => {
      isActive = false;
    };
  }, []);

  const setAuthenticatedUser = useCallback(
    (nextUser: UserProfile) => setUser(nextUser),
    [],
  );

  const clearSession = useCallback(async () => {
    setUser(null);
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync("roadguard_access_token"),
      SecureStore.deleteItemAsync("roadguard_user"),
    ]);
    const failedDeletion = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failedDeletion) throw failedDeletion.reason;
  }, []);

  return (
    <AuthSessionContext.Provider
      value={{ user, isLoading, setAuthenticatedUser, clearSession }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}