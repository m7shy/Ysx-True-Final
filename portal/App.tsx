import React from 'react';
import { RouterProvider, useRouter, useQueryParam } from './router';
import { bootstrapSession, isAuthed, onAuthChange } from './services/apiClient';
import { PortalShell } from './components/PortalShell';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectPage } from './pages/ProjectPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { FaqPage } from './pages/FaqPage';

const Routes: React.FC = () => {
  const { path, navigate } = useRouter();
  const token = useQueryParam('token');
  // Subscribed, not read during render. `authState` lives in a module, so
  // computing this inline meant a session cleared mid-flight (a failed refresh
  // on an open tab) never re-rendered: the client sat on a dead shell instead
  // of bouncing to /login. Deploys make that the common case, because
  // refresh-token rotation invalidates every live session at once.
  const authed = React.useSyncExternalStore(onAuthChange, isAuthed, isAuthed);
  const isPublic = path.startsWith('/login') || path.startsWith('/set-password');

  // Unauthenticated deep links bounce to /login (preserving a magic-link token).
  React.useEffect(() => {
    if (!authed && !isPublic) {
      navigate(token ? `/login?token=${token}` : '/login');
    }
  }, [authed, isPublic, token, navigate]);

  // Public routes (and magic-link/invite landings, which sign the user in).
  if (path.startsWith('/set-password')) return <LoginPage setPasswordMode />;
  if (path.startsWith('/login')) return <LoginPage />;
  if (!authed) return null;

  let page: React.ReactNode;
  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  const invoiceMatch = path.match(/^\/invoices\/([^/]+)$/);

  if (projectMatch) page = <ProjectPage id={projectMatch[1]} />;
  else if (invoiceMatch) page = <InvoicesPage id={invoiceMatch[1]} />;
  else if (path.startsWith('/invoices')) page = <InvoicesPage />;
  else if (path.startsWith('/faq')) page = <FaqPage />;
  else page = <DashboardPage />;

  return <PortalShell>{page}</PortalShell>;
};

const App: React.FC = () => {
  // The access token lives in memory only, so a page reload always starts
  // signed out. The HttpOnly refresh cookie is what actually carries the
  // session, so we must attempt a silent refresh BEFORE rendering routes —
  // otherwise every reload would bounce an authenticated client to /login.
  const [booting, setBooting] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    bootstrapSession().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-noir">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    );
  }

  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
};

export default App;
