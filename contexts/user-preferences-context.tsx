"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface UserPreferences {
  timezone: string | null;
  theme: string | null;
}

const defaultPreferences: UserPreferences = {
  timezone: null,
  theme: null,
};

const UserPreferencesContext = createContext<{
  preferences: UserPreferences;
  refetch: () => Promise<void>;
}>({
  preferences: defaultPreferences,
  refetch: async () => {},
});

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] =
    useState<UserPreferences>(defaultPreferences);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/preferences");
      if (!res.ok) return;
      const data = await res.json();
      setPreferences({
        timezone: data.timezone ?? null,
        theme: data.theme ?? null,
      });
    } catch {
      setPreferences(defaultPreferences);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => refetch(), 0);
    return () => clearTimeout(id);
  }, [refetch]);

  return (
    <UserPreferencesContext.Provider value={{ preferences, refetch }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}

export function useUserTimezone(): string | undefined {
  const { preferences } = useUserPreferences();
  return preferences.timezone ?? undefined;
}
