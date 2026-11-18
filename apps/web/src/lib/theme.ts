"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Resolve the effective theme: an explicit override, else the OS preference. */
function current(): Theme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Light/dark toggle backed by localStorage and the `data-theme` attribute that
 * globals.css keys on. The pre-paint script in layout.tsx sets the attribute
 * first, so this only has to mirror and write it.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(current());
    setReady(true);
  }, []);

  const apply = (next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("veyra.theme", next);
    } catch {
      /* private mode — the in-memory state below still works for this session */
    }
    setTheme(next);
  };

  return { theme, ready, toggle: () => apply(theme === "dark" ? "light" : "dark") };
}
