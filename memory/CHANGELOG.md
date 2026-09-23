# Changelog

## Jun 2026
- **Work status email personalization**: `render_work_status_email` now greets the order's **contact by name** (falls back to company name) and shows a **"Job: {title}"** line so the customer knows what's being worked on. `_set_work_status` resolves the doc's `contact_id` for both the greeting and the recipient (prefers the contact's email, then customer email). Verified via render output.
- **Google sign-in (Emergent Auth, staff only)**: "Sign in with Google" button on the staff /login (not portal). Frontend redirects to auth.emergentagent.com with `window.location.origin + '/dashboard'`; return `#session_id` is caught synchronously in `AppRoutes` (App.js) → `AuthCallback` POSTs to `POST /api/auth/google/session`. Backend exchanges the session_id at Emergent `/auth/v1/env/oauth/session-data`, matches the Google email to an EXISTING staff user (admin/salesman/installer) — no auto-create; unknown/customer → 403 — then issues our normal JWT cookie session (`set_auth_cookies`). Email/password login kept. AuthContext skips `/auth/me` when hash has `session_id`. Owner `chrisjacker@gmail.com` promoted from a duplicate installer record to admin. Endpoint wiring + deny path agent-verified; live Google round-trip needs user confirmation.
- **Send email note**: shared Send popup (SendDialog) now has an optional "Note to customer" field for Estimates, Sales Orders, and Invoices. Backend `SendDocInput.note` → `_send_document(note=...)` → `render_doc_email(note=...)` renders a highlighted message block near the greeting (recipient + internal copy). Proofs send popup uses `allowNote={false}`. Verified.
- **Artwork Proofs customer picker**: switched to searchable `SearchSelect`.
- **Artwork Proof approval system**: standalone `/artwork-proofs` page; upload PDF/JPG/PNG (≤25MB) via Emergent object storage; email to contact; public `/proof/:token` page with Approve / Request changes (notes); versioned revisions; shop notified at sales@dbgsigns.com. Tested (iteration_16).
- **Estimate customer approval**: estimate emails have an Approve button → `/approve/:token`; shop notified; "CUSTOMER OK" badge on list.
- **Label changes**: work status "ready" → "Pickup / Shipping"; document "due date" → "Est. Complete date".
- **Idle auto-logout**: 90-min default (admin-configurable in Settings → Security) with 1-min countdown warning dialog.
- **Installer work orders**: installers view/create/edit own work orders, cannot delete.

## Sep 2026
- **Salesman work statuses**: Salesmen can update work status on Estimates, Sales
  Orders, and Invoices; each update follows the existing customer notification flow.
- **Shipping address**: a manual Ship To field now carries from Estimate to Sales
  Order to Invoice and appears on customer PDF and email documents.
- **Customer line prices**: document PDFs/emails show quantity, unit price, and
  amount for regular line items; flat service charges continue to display once.
