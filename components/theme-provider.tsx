"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, useRef } from "react";

/**
 * Syncs the theme from the user's saved preferences (DB) into next-themes
 * so that the UI reflects their choice across sessions.
 */
function ThemeSyncFromDb() {
  const { setTheme } = useTheme();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current) return;
    fetch("/api/settings/preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const theme = data?.theme;
        if (theme && ["light", "dark", "system"].includes(theme)) {
          synced.current = true;
          setTheme(theme);
        }
      })
      .catch(() => {});
  }, [setTheme]);

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
