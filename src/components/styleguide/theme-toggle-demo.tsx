"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

/**
 * Styleguide-only control — the app has no theme toggle elsewhere yet.
 * Flips next-themes' global .dark class so the whole preview (and, if
 * you happen to be looking at another tab, the rest of the app) can be
 * checked in both modes.
 */
export function ThemeToggleDemo() {
  const { theme = "system", setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {isDark ? "Light mode" : "Dark mode"}
    </Button>
  );
}
