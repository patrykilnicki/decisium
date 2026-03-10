"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

interface UserPreferencesContextValue {
  preferences: UserPreferences;
  refetch: () => Promise<void>;
  hasFetched: boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue>({
  preferences: defaultPreferences,
  refetch: async () => {},
  hasFetched: false,
});

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] =
    useState<UserPreferences>(defaultPreferences);
  const [hasFetched, setHasFetched] = useState(false);

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
    } finally {
      setHasFetched(true);
    }
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({ preferences, refetch, hasFetched }),
    [preferences, refetch, hasFetched],
  );

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}

/**
 * Returns user timezone. Triggers loading preferences on first use (home, summaries,
 * collections, chat) so we don't fetch on every page—only when timezone is needed.
 */
export function useUserTimezone(): string | undefined {
  const ctx = useContext(UserPreferencesContext);
  const { hasFetched, preferences, refetch } = ctx;

  useEffect(() => {
    if (!hasFetched) {
      refetch();
    }
  }, [hasFetched, refetch]);

  return preferences.timezone ?? undefined;
}
