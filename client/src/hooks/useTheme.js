import { useEffect, useState } from 'react';
import { THEME_KEY } from '../constants/preferences.js';

export function useTheme() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  );

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return [theme, setTheme];
}
