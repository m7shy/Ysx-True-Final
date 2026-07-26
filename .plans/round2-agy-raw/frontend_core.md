### Cross-tenant settings and OAuth provider configuration leak in browser localStorage
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: context/SettingsContext.tsx:66
WHAT: UserSettings (which includes mail provider active selections and configurations) is written to `localStorage['ysxflow_settings']` globally. While `onSessionCleared` was added to remove this key when `clearAuth()` is called, `onSessionCleared` listeners are stored in in-memory module state (`sessionClearedListeners` in `services/authStorage.ts:30`). If a user closes the browser tab or reloads the browser, `accessToken` and `user` state are cleared from memory (`authStorage.ts:40-41`). When a new tenant logs in or opens the application in the same browser, `SettingsProvider` initializes its state from `localStorage.getItem('ysxflow_settings')` on mount (lines 49-61) BEFORE any login or silent refresh has occurred. Thus, the new user inherits and re-persists the previous tenant's `UserSettings` configuration.
SCENARIO: 
1. Tenant A logs in, sets up their settings (e.g. `activeProvider`, `emailSignature`), and closes the browser tab without clicking "Log out".
2. Because the tab was closed, in-memory state is lost. `localStorage['ysxflow_settings']` remains populated with Tenant A's settings.
3. Tenant B opens the app on the same machine/browser.
4. On initial mount, `SettingsProvider` reads `localStorage['ysxflow_settings']` (lines 49-61) and populates `settings` state with Tenant A's signature and active provider settings.
5. `useEffect` in `SettingsContext.tsx:64-67` runs immediately upon state initialization and re-saves Tenant A's settings. When Tenant B logs in, their session now operates using Tenant A's active email provider configuration and signature.
FIX: Do not store user-specific settings under an unscoped global key in `localStorage` without validating the authenticated user identity, or store user settings server-side/tenant-scoped in session state.

### Unhandled rejections during background scraper polling can crash or unmount UI
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: App.tsx:300
WHAT: In `AppContent`, `useEffect` runs an interval `tick` function every 60 seconds to poll `getScraperStatus()` and `getAutoSchedule()`. In `tick()`, `getAutoSchedule()` (line 306) and `getScraperStatus()` (line 301) catch errors with empty `catch {}` blocks. However, `getAutoSchedule()` calls `apiGet<AutoSchedule>('/api/scraper/auto')`, which calls `apiRequest`. If `apiRequest` encounters a 401 and silent refresh fails, `apiRequest` invokes `clearAuth()` and throws an `ApiError(401)`. While `tick()` catches this error, `clearAuth()` synchronously invokes `sessionClearedListeners`, setting `user = null` via `onSessionCleared` in `AuthContext.tsx:43`. But `AppContent`'s `tick()` continues execution after `clearAuth()` completes, attempting further state updates (`setScraperBusy`) on an unmounted or transitioning view component hierarchy, causing React warnings and potential unhandled promise rejections if `showToast` is invoked after state teardown.
SCENARIO: 
1. User's session expires while keeping the app open in the background.
2. Background interval fires `tick()` in `App.tsx:299`.
3. `getAutoSchedule()` triggers `apiGet` -> 401 -> `refreshAccessToken()` fails -> `clearAuth()`.
4. `clearAuth()` resets AuthContext user state to null, causing `AppContent` to unmount children and render `<LoginScreen />`.
5. The remaining code inside `tick()` executes toast notifications (`showToast('ERROR', ...)`) on unmounted notification contexts.
FIX: Check `isLoggedIn` or abort `tick()` execution immediately if `apiGet` throws an auth error or if the component unmounts.

### Unsent campaign auto follow-up scheduling ignores backend failure status and reports false success
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: hooks/useEmailProvider.ts:194-221
WHAT: In `sendNewEmail`, when scheduling follow-ups for a new email, `scheduleFollowup` is called inside a loop over `autoFollowUps`. If `scheduleFollowup` throws an error for a specific follow-up step (e.g. step 2 fails due to rate limits or network drop), the error is caught at line 213, appended to `followUpResults` as `{ success: false, error: appErr }`, and added to `followups.errors`. However, the overall `sendNewEmail` function returns `{ success: true, messageId, followups, scheduledFollowUps }` at line 224 without indicating to `CampaignContext` or the user that the campaign follow-up sequence is partially broken. The UI displays a success toast to the user ("activated/scheduled") even though critical sequence steps failed to schedule on the backend.
SCENARIO: 
1. User creates a campaign with 3 follow-up steps.
2. Initial email is sent successfully via `gwSend`.
3. Follow-up step 1 schedules successfully. Follow-up step 2 fails (e.g., backend 500 error during `scheduleFollowup`).
4. `sendNewEmail` catches the error for step 2, records it in `followUpResults`, and returns `success: true`.
5. `CampaignContext.addCampaign` receives `success: true` and shows a success toast "Campaign activated."
6. The user believes all follow-ups were scheduled, but step 2 is missing from the backend queue and will never be sent.
FIX: Check if any critical follow-up step failed in `sendNewEmail` or propagate individual step errors back to `CampaignContext` so the user is alerted to incomplete follow-up scheduling.

### Race condition in concurrent 401 token refresh in apiClient.ts can trigger unnecessary logout
SEVERITY: MEDIUM
CONFIDENCE: MEDIUM
FILE: services/apiClient.ts:24-48
WHAT: In `apiClient.ts`, `refreshAccessToken()` de-duplicates concurrent refresh calls using `refreshPromise`. If a 401 occurs, `refreshAccessToken()` starts a `fetch('/api/auth/refresh')`. If another request receives a 401 while `refreshPromise` is active, it awaits the same `refreshPromise`. However, if the refresh token request fails (e.g., transient network hiccup or temporary backend 500 response), `refreshAccessToken()` returns `false`. In `apiRequest` (line 97), if `refreshed` is `false`, it immediately calls `clearAuth()`, wiping the user's access token and state across the entire app.
SCENARIO: 
1. Two API requests run concurrently (e.g. loading campaigns and loading leads).
2. Access token expires, so both return HTTP 401.
3. First 401 calls `refreshAccessToken()`, setting `refreshPromise`. Second 401 reuses `refreshPromise`.
4. A transient network glitch causes the `/api/auth/refresh` request to fail with a network error.
5. `refreshAccessToken()` catches the error and returns `false`.
6. `apiRequest` immediately calls `clearAuth()`, logging out the user completely, even though the refresh token cookie itself remains valid and would succeed on a retry.
FIX: Distinguish between HTTP 401 invalid/expired refresh token responses vs transient network/500 errors before calling `clearAuth()`. Only call `clearAuth()` when the server explicitly rejects the refresh cookie with a 401/403.

## CHECKED AND SOUND
- **Authentication Header Injection**: Checked `apiClient.ts`, `mailGateway.ts`, and `followupApi.ts`. All Authorization headers properly format `Bearer ${token}` and handle missing tokens safely without throwing runtime null pointer exceptions.
- **CSRF & Credentials**: Checked `credentials: 'include'` in `apiClient.ts` fetch calls for `/api/auth/refresh`. Same-site cookie handling and credential passing are configured correctly.
- **Unsafe String Rendering / XSS**: Verified `App.tsx`, `context/`, `hooks/`, and `services/`. No instances of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or `eval` exist in the reviewed frontend core files. All user inputs rendered via React JSX are properly escaped text nodes.
- **Session Cleanup Listeners**: Verified `authStorage.ts` `onSessionCleared` listener pattern. Listeners properly trap individual callback errors in try/catch blocks so one failing listener cannot block others from resetting.
MODEL_USED=gemini-3.1-pro-high VIA=file
