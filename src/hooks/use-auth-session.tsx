import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
        if (!isActive || !token || !storedUser) return;

        const parsed: unknown = JSON.parse(storedUser);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "id" in parsed &&
          typeof parsed.id === "number" &&
          "name" in parsed &&
          typeof parsed.name === "string" &&
          "email" in parsed &&
          typeof parsed.email === "string"
        ) {
          setUser({
            id: parsed.id,
            name: parsed.name,
            email: parsed.email,
            role: "role" in parsed && typeof parsed.role === "string" ? parsed.role : undefined,
          });
        }
      } catch {
        if (isActive) setUser(null);
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void loadSession();
    return () => {
      isActive = false;
    };
  }, []);

  const setAuthenticatedUser = (nextUser: UserProfile) => setUser(nextUser);

  const clearSession = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync("roadguard_access_token"),
      SecureStore.deleteItemAsync("roadguard_user"),
    ]);
    setUser(null);
  };

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