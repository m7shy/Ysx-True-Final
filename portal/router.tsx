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

const RouterContext = React.createContext<{ path: string; navigate: (to: string) => void }>({
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

  const navigate = React.useCallback((to: string) => {
    window.history.pushState(null, '', `${BASE}${to}`);
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
