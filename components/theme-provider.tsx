"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { useUserPreferences } from "@/contexts/user-preferences-context";

/**
 * Syncs the theme from the user's saved preferences (context/DB) into next-themes
 * so that the UI reflects their choice across sessions.
 * Uses preferences from UserPreferencesContext (no separate fetch).
 */
function ThemeSyncFromDb() {
  const { setTheme } = useTheme();
  const { preferences } = useUserPreferences();
  const synced = useRef(false);

  useEffect(() => {
    const theme = preferences.theme;
    if (!theme || synced.current) return;
    if (["light", "dark", "system"].includes(theme)) {
      synced.current = true;
      setTheme(theme);
    }
  }, [preferences.theme, setTheme]);

  return null;
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <ThemeSyncFromDb />
      {children}
    </NextThemesProvider>
  );
}
