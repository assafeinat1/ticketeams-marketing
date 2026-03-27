import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export default function Header() {
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="glass px-6 py-3.5 border-b border-border flex justify-between items-center sticky top-0 z-40 mobile-px">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink via-orange to-purple flex items-center justify-center shadow-lg shadow-pink/10">
          <span className="text-lg font-extrabold text-white tracking-tight">T</span>
        </div>
        <div>
          <h1 className="text-base font-bold leading-tight">
            <span className="bg-gradient-to-l from-pink via-orange to-purple bg-clip-text text-transparent">
              Ticketeams
            </span>
            {' '}
            <span className="text-text font-semibold">Marketing</span>
          </h1>
          <p className="text-[10px] text-text-dim/60 font-medium tracking-wide header-subtitle">Marketing Agency Dashboard</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink to-purple flex items-center justify-center">
            <span className="text-[11px] font-bold text-white">T</span>
          </div>
          <span className="text-xs text-text-dim font-medium hidden sm:inline">Ticketeams</span>
        </div>
        <div className="w-px h-5 bg-border" />
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center text-text-dim hover:text-text transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
        <button
          onClick={logout}
          className="text-xs text-text-dim hover:text-red transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-red/10"
        >
          התנתק
        </button>
      </div>
    </header>
  );
}
