# Changelog

## Oct 2026
- **Install reply alert**: When a customer submits a tentative installation date, the CRM
  emails `sales@dbgsigns.com` that the customer replied with an install date. The request
  retains delivery-state timestamps and continues saving if the provider is throttled.
- **Salesman document editing**: Salesmen can edit existing Estimates, Sales Orders, and
  Invoices. Customer assignment and commission ownership/rate remain locked, while
  document copying remains admin-only. Verified by iteration_21 backend and browser QA.
- **COD/Deposit sales copies**: Successful COD and 50/50 deposit payment-link sends now
  email a matching internal copy to `sales@dbgsigns.com`. A failure to send that internal
  copy never prevents delivery to the selected customer recipient.
- **Estimate status removal**: Work status is no longer shown, editable, emailed, or
  printed for Estimates. Sales Orders and Invoices retain their existing work-status flow.
- **Document customer locks**: Each document number permanently retains its original
  customer, including during admin or salesman edits. Salesmen retain work-status updates;
  direct document-status routes remain admin-only. The customer picker stays locked while
  editing, and document tables keep mobile overflow contained. Verified with iteration_20
  backend and browser QA.

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
- **Explicit Stripe payment state**: Estimate, Sales Order, and Invoice lists now show
  `Stripe Deposit` or `Stripe Paid`. COD payments on Estimates and Sales Orders send the
  sales customer-paid Stripe/Credit Card notification too.
- **Paid Stripe invoice alert**: Fully paid Stripe/Credit Card invoices now send sales a
  separate, one-time paid-in-full notification when the Invoice moves into Paid.
- **Stripe COD/deposit receipts**: Confirmed payment-request charges now display payment
  state on Estimates, Sales Orders, and Invoices. A one-time email notifies sales when a
  50/50 down payment or COD charge confirms.
- **Installation scheduling read receipts**: The Completed / Installation Schedule email
  now tracks opens. Staff see `OPENED` on tentative calendar cards and an opened timestamp
  or `Unread` in the request dialog.
- **Company logo**: Updated the shared DBG Signs & Graphics logo used across CRM screens,
  customer-facing email templates, and generated documents.
- **Artwork proof read receipts**: Proof emails now include the customer approval/change
  instructions and per-recipient open tracking. Artwork Proofs and version history show
  unread/opened counts for each sent version.
- **Tentative install decisions**: Staff can approve a customer-selected installation date
  or select an open replacement date. Replacement offers are emailed with a secure customer
  acceptance button; calendar entries remain `OFFER` until the customer accepts.
- **Completed installation scheduling**: Added the `Completed / Installation Schedule`
  status. Its customer email links to a public tentative-install calendar: Monday–Thursday
  AM/PM and Friday AM, with notes. Requests enter the staff calendar as tentative until
  confirmed.
- **Collapsible desktop sidebar**: Staff can collapse the left navigation to maximize the
  work area and expand it again; mobile navigation keeps its drawer behavior.
- **Automatic CRM backup vault**: Admin Settings now retains complete CRM JSON backups in
  secure object storage. Run one on demand, download it through the protected API, or
  remove it from the vault. An idempotent monthly cron runs on the first at 08:00 UTC.
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
