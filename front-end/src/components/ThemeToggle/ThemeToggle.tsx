import { useEffect } from 'react';
import { usePersistedState } from '../../hooks/usePersistedState';
import styles from './ThemeToggle.module.css';

type Theme = 'light' | 'dark'

export const ThemeToggle = () => {
  const [theme, setTheme] = usePersistedState<Theme>('theme', () =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const icon = theme === 'dark' ? '☀︎' : '☾';

  return (
    <button
      className="icon-btn"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  );
};
