// FILE: test/portalAuthState.test.ts
//
// The portal's in-memory session, and the subscription that lets React see it
// change.
//
// The defect this pins: `authState` is module state, and App.tsx computed
// `authed` during render. When a mid-session refresh failed and `clearAuth()`
// ran, nothing re-rendered — the client sat on a dead shell instead of being
// sent to /login, and only a manual reload escaped. A fresh page load was fine
// (bootstrapSession runs before the first render), so it only ever hit an
// ALREADY-OPEN TAB, which is precisely what a deploy produces: refresh-token
// rotation invalidates every live session at once.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveAuth, clearAuth, loadAuth, isAuthed, onAuthChange } from '../portal/services/apiClient';

const SESSION = {
  accessToken: 'tok',
  clientUser: { id: 'cu1', email: 'client@example.com' },
  client: { id: 'c1', name: 'Acme', companyName: null },
};

beforeEach(() => {
  clearAuth();
});

describe('portal auth state', () => {
  it('reports authed only while a session is held', () => {
    expect(isAuthed()).toBe(false);
    saveAuth(SESSION);
    expect(isAuthed()).toBe(true);
    expect(loadAuth()?.clientUser.email).toBe('client@example.com');
    clearAuth();
    expect(isAuthed()).toBe(false);
  });

  it('notifies subscribers when a session is cleared', () => {
    // The whole point. Without this notification React never learns the session
    // ended and the client is stranded on a dead screen.
    saveAuth(SESSION);
    const listener = vi.fn();
    onAuthChange(listener);

    clearAuth();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when a session is established', () => {
    const listener = vi.fn();
    onAuthChange(listener);

    saveAuth(SESSION);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when nothing actually changed', () => {
    // Re-saving on every token refresh must not churn every subscriber; the
    // session was already present and still is.
    saveAuth(SESSION);
    const listener = vi.fn();
    onAuthChange(listener);

    saveAuth({ ...SESSION, accessToken: 'rotated' });

    expect(listener).not.toHaveBeenCalled();
    expect(loadAuth()?.accessToken).toBe('rotated');
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const off = onAuthChange(listener);
    off();

    saveAuth(SESSION);

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying the other subscribers when one of them throws', () => {
    // This runs inside request error handling. A component that throws on
    // teardown must not prevent the rest of the app from learning it is signed
    // out, and must not take down the request path either.
    saveAuth(SESSION);
    const bad = vi.fn(() => {
      throw new Error('subscriber exploded');
    });
    const good = vi.fn();
    onAuthChange(bad);
    onAuthChange(good);

    expect(() => clearAuth()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
