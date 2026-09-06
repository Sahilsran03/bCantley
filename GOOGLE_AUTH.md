# Google customer authentication — Part 1

Configure `GOOGLE_CLIENT_ID` in the backend environment with the Google OAuth web client ID. No client secret is needed. Missing configuration disables Google login with HTTP 503. No real credentials belong in repository files.

`POST /api/auth/google` accepts JSON `{ "credential": "<Google ID token>" }` only. It verifies RS256 signatures using Google's fixed HTTPS JWKS endpoint, the configured audience, issuer, expiry, issued-at, authorized party (when present), subject, and verified email. Public keys are cached with a bounded lifetime; retrieval has a timeout. Tokens are never logged.

Success uses the existing `{ success, accessToken, refreshToken, user }` response and stored refresh token, with 201 for creation and 200 for returning customers. Errors use the existing auth error middleware. Admin accounts and unverified linked accounts are rejected. Existing auth has no separate disabled/blocked field beyond `isVerified`.

`googleId` is an optional immutable provider subject with a sparse unique index. The existing unique normalized email index remains. Ensure the new `googleId` unique index is built before enabling this endpoint in environments that disable automatic Mongoose index creation. No production database/index changes are performed by this task.

Google-only accounts can omit phone and password; local registration still requires both. Password comparison safely rejects accounts without a password. Existing password reset remains available. No existing account profile or financial data is overwritten.

Existing same-email local accounts are not automatically linked: HTTP 409 directs users to their existing sign-in method. This conservative policy also avoids trusting third-party Google email ownership for linking. Returning accounts match `sub`, even if Google's email changes; stored account email is not overwritten. Concurrent creation relies on the email/provider unique indexes and resolves an already-created matching provider account safely.

Part 2: use Google Identity Services to obtain a credential, POST only that credential, then persist the normal Cantley session through AuthContext. Use the existing Vite convention for the public `VITE_GOOGLE_CLIENT_ID` (same client ID as backend). Configure allowed browser origins in Google Cloud. Handle 400/401/403/409/503 without displaying tokens. Collect phone later through the existing profile flow where needed; do not invent one. No Login/Register UI or frontend auth code is changed in Part 1.

Offline focused tests: `node --test src/scripts/testGoogleAuth.test.js`. Tests mock Google key retrieval/verification and model persistence; they do not call Google or a database.

Reference: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
