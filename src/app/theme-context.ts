import { createContext } from 'react';

/**
 * Split out from theme-provider.tsx so the provider file satisfies
 * `react-refresh/only-export-components`. The Theme type and the React
 * context object are non-component exports.
 */
export type Theme = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
