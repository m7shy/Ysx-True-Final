import React from 'react';
import { motion } from 'motion/react';
import { Button, Card, Input, Alert } from '@/src/design/ui';
import { blurIn } from '@/src/design/motion';
import { useRouter, useQueryParam } from '../router';
import { login, requestMagicLink, consumeMagicLink, setPassword } from '../services/portalApi';
import { ApiError } from '../services/apiClient';

type Mode = 'password' | 'magic' | 'set-password';

/**
 * Login / invite landing. ?token= on /login consumes a magic link on mount;
 * /set-password?token= renders the first-password form (invite flow).
 */
export const LoginPage: React.FC<{ setPasswordMode?: boolean }> = ({ setPasswordMode = false }) => {
  const { navigate } = useRouter();
  const token = useQueryParam('token');

  const [mode, setMode] = React.useState<Mode>(setPasswordMode ? 'set-password' : 'password');
  const [email, setEmail] = React.useState('');
  const [password, setPasswordValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [consuming, setConsuming] = React.useState(Boolean(token) && !setPasswordMode);

  React.useEffect(() => {
    if (!token || setPasswordMode) return;
    (async () => {
      try {
        await consumeMagicLink(token);
        navigate('/');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Sign-in link failed — request a new one');
        setConsuming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'password') {
        await login(email, password);
        navigate('/');
      } else if (mode === 'magic') {
        const res = await requestMagicLink(email);
        setNotice(res.message);
      } else {
        if (!token) throw new ApiError(400, 'VALIDATION', 'This link is missing its token — use the link from your email');
        await setPassword(token, password);
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-4">
      <motion.div {...blurIn} className="w-full max-w-sm shrink-0 py-10">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold tracking-tight text-white">
            YSX<span className="text-volt-text"> Visuals</span>
          </p>
          <p className="mt-1 text-xs uppercase tracking-widest text-neutral-500">Client Portal</p>
        </div>

        <Card padding="lg">
          <h1 className="mb-1 text-lg font-semibold text-white">
            {mode === 'set-password' ? 'Set your password' : 'Welcome back'}
          </h1>
          <p className="mb-6 text-sm text-neutral-400">
            {mode === 'set-password'
              ? 'Choose a password to finish setting up your portal access.'
              : mode === 'magic'
                ? "We'll email you a one-time sign-in link."
                : 'Sign in to track your projects, files, and invoices.'}
          </p>

          {consuming ? (
            <p className="text-sm text-neutral-400">Signing you in…</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {mode !== 'set-password' && (
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              )}
              {mode !== 'magic' && (
                <Input
                  label={mode === 'set-password' ? 'New password' : 'Password'}
                  type="password"
                  autoComplete={mode === 'set-password' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'set-password' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  placeholder={mode === 'set-password' ? 'At least 8 characters' : '••••••••'}
                />
              )}

              {error && <Alert variant="error">{error}</Alert>}
              {notice && <Alert variant="success">{notice}</Alert>}

              <Button type="submit" fullWidth loading={busy}>
                {mode === 'password' ? 'Sign in' : mode === 'magic' ? 'Email me a link' : 'Set password & sign in'}
              </Button>

              {mode !== 'set-password' && (
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'password' ? 'magic' : 'password');
                    setError(null);
                    setNotice(null);
                  }}
                  className="block w-full text-center text-xs text-neutral-500 hover:text-volt-text transition-colors"
                >
                  {mode === 'password' ? 'Email me a sign-in link instead' : 'Use a password instead'}
                </button>
              )}
            </form>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-neutral-600">
          Need access? Ask your contact at YSX Visuals for an invite.
        </p>
      </motion.div>
    </div>
  );
};
