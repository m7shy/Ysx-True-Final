import React from 'react';

/**
 * Tiny path router for the portal (base /portal/). History-API based so URLs
 * look clean; the backend serves index.html for every /portal/* path.
 */

const BASE = '/portal';

function currentPath(): string {
  const p = window.location.pathname;
  const stripped = p.startsWith(BASE) ? p.slice(BASE.length) : p;
  return stripped === '' ? '/' : stripped;
}

const RouterContext = React.createContext<{ path: string; navigate: (to: string, opts?: { replace?: boolean }) => void }>({
  path: '/',
  navigate: () => {},
});

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = React.useState(currentPath);

  React.useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // `replace: true` uses replaceState so the previous URL (e.g. a one-time
  // magic-link token) is overwritten rather than pushed — avoiding history
  // leakage and Referer exposure on the next outbound request.
  const navigate = React.useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      window.history.replaceState(null, '', `${BASE}${to}`);
    } else {
      window.history.pushState(null, '', `${BASE}${to}`);
    }
    setPath(to);
  }, []);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
};

export function useRouter() {
  return React.useContext(RouterContext);
}

/** Query-string helper (e.g. ?token= on login/set-password). */
export function useQueryParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
