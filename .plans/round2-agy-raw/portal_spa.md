### Ineffective Sign-out Leaves Session Active Across Page Reloads
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: portal/components/PortalShell.tsx:50
WHAT: The "Sign out" handler only clears in-memory state (`clearAuth()`) without revoking the session on the server or clearing the HttpOnly `ysxportal_rt` refresh cookie.
SCENARIO: 
1. A client logs into the portal. The browser stores the HttpOnly refresh token cookie (`ysxportal_rt`).
2. The client clicks "Sign out" in `PortalShell.tsx`. `clearAuth()` sets `authState = null` in memory and `navigate('/login')` changes the route to `/login`.
3. The client (or another user on a shared device) refreshes the browser page or opens `/portal` in a new tab.
4. `App.tsx` executes `bootstrapSession()` on mount, which makes a POST request to `/api/portal/auth/refresh` with `credentials: 'include'`.
5. Because the HttpOnly `ysxportal_rt` cookie was never invalidated or cleared, the browser automatically sends it, and the backend returns a fresh access token and user identity payload, automatically logging the user back in.
FIX: Implement a `logout()` function in `portalApi.ts`/`apiClient.ts` that calls a backend logout endpoint (e.g. POST `/api/portal/auth/logout`) to clear/expire the HttpOnly refresh cookie and revoke the session on the backend before clearing in-memory auth state and navigating to `/login`.

### Stored XSS via Unsanitized File Link URLs
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: portal/pages/ProjectPage.tsx:191
WHAT: Deliverable and file link URLs (`f.url`) are rendered directly into anchor tag `href` attributes without protocol sanitization, permitting `javascript:` URI execution.
SCENARIO:
1. An admin user or compromised account sets a file link URL on a project to `javascript:alert(document.cookie)` or a script fetching sensitive portal data.
2. A client views the project detail page in the portal and clicks on the deliverable or file link (`<a href={f.url}>`).
3. The browser executes the inline JavaScript code within the client portal's origin context, leading to arbitrary script execution and potential session hijacking or data exfiltration.
FIX: Validate `f.url` against an allowed protocol whitelist (such as `^https?://`) prior to rendering, or sanitize the URL to neutralize `javascript:` pseudo-protocols.

### Magic-Link Token Double-Consumption in React StrictMode
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: portal/pages/LoginPage.tsx:31
WHAT: Magic-link consumption inside `useEffect` lacks single-execution guards, causing single-use token consumption requests to fail on double-mount or concurrent execution.
SCENARIO:
1. A client opens a valid magic-link URL (`/portal/login?token=VALID_TOKEN`).
2. Under React 18 Strict Mode (or fast component re-renders), the mount `useEffect` in `LoginPage.tsx` fires twice.
3. The first invocation calls `consumeMagicLink(token)`, which sends the token to `/api/portal/auth/magic-link/consume`. The backend validates and consumes/deletes the token.
4. The second concurrent invocation sends the same token, which the backend rejects with 400 Bad Request ("Invalid or expired token").
5. The second request's rejection triggers the `.catch` block in `LoginPage.tsx`, setting `setError('Sign-in link failed — request a new one')` and `setConsuming(false)`, presenting an error message to a user who actually had a valid link.
FIX: Add a `React.useRef` guard (e.g. `consumedRef.current`) to ensure `consumeMagicLink` is executed at most once per token, preventing duplicate API requests.

### Non-Reactive Auth State Leaves SPA in Zombie State on 401
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: portal/services/apiClient.ts:135
WHAT: `authState` is stored in a non-reactive module variable; calling `clearAuth()` on 401 API failures does not trigger React re-renders or redirect unauthenticated users to `/login`.
SCENARIO:
1. A client is actively viewing a protected page such as `/projects/proj_123`.
2. The user's session refresh token expires or is invalidated on the server.
3. The user performs an API-driven action (such as posting a project message or requesting a revision).
4. `apiRequest` receives a 401 HTTP response, attempts `refreshTokens()`, which fails.
5. `apiRequest` calls `clearAuth()`, setting `authState = null` in `apiClient.ts`, and throws an `ApiError`.
6. The page component catches `ApiError` and displays an inline error message, but `App.tsx` is never re-rendered because `authState` is a plain JS variable without React state bindings.
7. The user remains stuck on the protected page in an unauthenticated "zombie" state without being redirected to `/login`.
FIX: Expose authentication state using React Context or a subscription listener pattern so that invoking `clearAuth()` causes `App.tsx` to immediately re-render and navigate to `/login`.

### Unhandled TypeError Crash on Missing Invoice Payments Array
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: portal/pages/InvoicesPage.tsx:127
WHAT: Unchecked property access `invoice.payments.find(...)` throws an unhandled TypeError if `payments` is missing or `null` in the backend API response.
SCENARIO:
1. A client navigates to an invoice detail page (`/invoices/inv_123`).
2. The backend returns an invoice detail object where `payments` is `null` or `undefined` (e.g., newly created invoice without payment records initialized).
3. `InvoiceDetail` executes `invoice.payments.find((p) => p.receipt)`.
4. JavaScript throws `TypeError: Cannot read properties of undefined (reading 'find')`.
5. Because there is no React Error Boundary around `InvoiceDetail`, the entire SPA unmounts and crashes to a blank screen.
FIX: Use optional chaining or an array fallback guard: `(invoice.payments ?? []).find((p) => p.receipt)?.receipt ?? null`.

## CHECKED AND SOUND
- **In-Memory Access Token Storage (`portal/services/apiClient.ts`)**: Access tokens are kept strictly in memory (`authState`) and purged on reload, relying on HttpOnly refresh cookies rather than script-readable `localStorage`.
- **Legacy Storage Purging (`portal/services/apiClient.ts:47-53`)**: `purgeLegacyAuthStorage()` runs on startup to clean up leftover script-readable tokens from previous app versions.
- **URL History Sanitization (`portal/pages/LoginPage.tsx:35, 60`)**: Single-use magic link and invite tokens are removed from browser history using `navigate('/', { replace: true })`, preventing token exposure via back button or Referer headers.
- **Route Authorization Guard (`portal/App.tsx:18-27`)**: Protected routes check `authed` state and redirect unauthenticated deep link attempts back to `/login` while preserving query parameters.
- **XSS Prevention in Text Content (`portal/pages/ProjectPage.tsx`, `portal/pages/InvoicesPage.tsx`)**: User and admin supplied text fields (messages, scope summaries, revision notes, line items) are rendered as React text nodes rather than `dangerouslySetInnerHTML`.
MODEL_USED=gemini-3.1-pro-high VIA=file
