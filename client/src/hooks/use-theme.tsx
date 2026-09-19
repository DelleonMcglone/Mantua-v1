/* eslint-disable react-refresh/only-export-components -- context module: Provider component + useTheme hook live together. */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "mantua.theme";

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    // Task 071 (MX-007) — the browser chrome / installed-app title bar
    // follows the surface colour (tokens.css `--bg` per theme).
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#000000" : "#f6f5f2");
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore — private mode etc.
    }
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        set: setTheme,
        toggle: () => {
          setTheme((t) => (t === "dark" ? "light" : "dark"));
        },
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
