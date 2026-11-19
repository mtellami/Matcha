import { useTheme } from "./theme";
import { Moon, Sun } from "lucide-react";

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <div className="theme-switch" role="group" aria-label="Color theme">
      <button
        type="button"
        className="grid size-9 min-h-9 min-w-9 shrink-0 place-items-center rounded-full border border-matcha-border bg-transparent p-0 text-matcha-muted transition-colors hover:bg-matcha-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-matcha-accent"
        aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
        onClick={() => setTheme(dark ? "light" : "dark")}
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}
