import AppShell from './app/AppShell';
import { ThemeProvider } from './app/theme-provider';

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
