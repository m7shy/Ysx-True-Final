import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function useDarkSide(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('ysxflow_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ysxflow_theme', theme);
  }, [theme]);

  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))];
}
