# Authentication Testing Playbook

1. Verify `GET /api/auth/me` with the active httpOnly session cookie.
2. Verify password login with each documented staff account using a cookie jar.
3. For Google sign-in, start from the active browser origin, exchange the one-time
   `session_id` through the backend, then verify `/api/auth/me` and role access.
4. Confirm unknown and customer Google identities are rejected without account creation.
5. Confirm logout clears the session and protected routes return `401`.

Never expose session tokens or production secrets in test output.