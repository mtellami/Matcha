import { useTheme } from "./theme";
import { Button } from "@heroui/react";
import { Moon, Sun } from "lucide-react";

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <div className="theme-switch" role="group" aria-label="Color theme">
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
        onPress={() => setTheme(dark ? "light" : "dark")}
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </Button>
    </div>
  );
}
