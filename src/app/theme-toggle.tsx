import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type Theme } from './theme-provider';

const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = {
  system: '시스템',
  light: '라이트',
  dark: '다크',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = () => {
    const i = ORDER.indexOf(theme);
    setTheme(ORDER[(i + 1) % ORDER.length]);
  };
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={`테마: ${LABELS[theme]} (클릭하여 전환)`}
      title={`테마: ${LABELS[theme]}`}
    >
      <Icon />
    </Button>
  );
}
