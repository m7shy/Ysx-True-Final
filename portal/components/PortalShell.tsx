import React from 'react';
import { LayoutGrid, Receipt, LifeBuoy, LogOut } from 'lucide-react';
import { useRouter } from '../router';
import { logout, loadAuth } from '../services/apiClient';

const NAV = [
  { path: '/', label: 'Projects', icon: LayoutGrid, match: (p: string) => p === '/' || p.startsWith('/projects') },
  { path: '/invoices', label: 'Invoices', icon: Receipt, match: (p: string) => p.startsWith('/invoices') },
  { path: '/faq', label: 'Help', icon: LifeBuoy, match: (p: string) => p.startsWith('/faq') },
];

/** Authenticated portal chrome: slim top bar + centered content column. */
export const PortalShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { path, navigate } = useRouter();
  const auth = loadAuth();

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-noir/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-3">
          <button
            onClick={() => navigate('/')}
            className="text-sm font-semibold tracking-tight text-white"
            aria-label="YSX Visuals — home"
          >
            YSX<span className="text-volt-text"> Visuals</span>
            <span className="ml-2 hidden sm:inline text-[10px] font-medium uppercase tracking-widest text-neutral-500">
              Client Portal
            </span>
          </button>

          <nav className="flex items-center gap-1" aria-label="Portal">
            {NAV.map(({ path: to, label, icon: Icon, match }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                aria-current={match(path) ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  match(path)
                    ? 'bg-volt/15 text-volt-text'
                    : 'text-neutral-400 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <button
              onClick={() => {
                // logout() also asks the server to clear the HttpOnly refresh
                // cookie; clearAuth() alone left the session restorable on the
                // next page load. Navigate immediately rather than awaiting —
                // local state is already dropped and the cookie clear is
                // fire-and-forget.
                void logout();
                navigate('/login');
              }}
              title={auth?.clientUser.email}
              className="ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-neutral-500 hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 pb-20">{children}</main>
    </div>
  );
};
