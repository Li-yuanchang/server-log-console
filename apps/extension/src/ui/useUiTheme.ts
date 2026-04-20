import { useState, useEffect } from "react";

export type UiThemeAPI = {
  uiTheme: "classic" | "modern";
};

export function useUiTheme(): UiThemeAPI {
  const [uiTheme] = useState<"classic" | "modern">("modern");

  useEffect(() => {
    try { localStorage.setItem("ui-theme", "modern"); } catch { /* ignore */ }
  }, []);

  return { uiTheme };
}
