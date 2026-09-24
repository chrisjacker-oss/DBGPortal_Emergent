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
- **Service Call & Local Delivery Fee**: Added two built-in service categories. Service
  Call has a manual cost; Local Delivery Fee has miles and a manual fee. Both calculate
  as customer-facing flat charges and retain their data across document conversion.
- **Editable customer contacts**: Staff can edit contacts directly inside the customer
  Contacts dialog. Portal-linked contacts retain their password and session while their
  email/login is updated; duplicate portal email addresses are rejected.
- **Document Action confirmations**: Direct Actions-menu tasks now show a short
  Cancel/Confirm popup before opening, copying, converting, downloading, printing,
  voiding, or reactivating an Estimate, Sales Order, or Invoice.
- **Payment request emails**: Staff can send a secure, fixed-amount payment link from
  Estimates, Sales Orders, and Invoices. Choose 50/50 for a half-total deposit or COD
  for the full remaining balance, then choose customer contacts. Links expire after 30
  days and work through the existing Stripe card-payment page.
- **CRM backup & restore**: Settings has admin-only JSON backup download and protected
  restore. Restore requires a selected backup, current admin password, and typed
  `RESTORE`, then signs out for a fresh session.
- **Salesman work statuses**: Salesmen can update work status on Estimates, Sales
  Orders, and Invoices; each update follows the existing customer notification flow.
- **Shipping address**: a manual Ship To field now carries from Estimate to Sales
  Order to Invoice and appears on customer PDF and email documents.
- **Customer line prices**: document PDFs/emails show quantity, unit price, and
  amount for regular line items; flat service charges continue to display once.
