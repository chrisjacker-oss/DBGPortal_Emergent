# DBG Signs / Deep Blue Graphics — Sign-Shop CRM

React frontend + FastAPI backend + MongoDB CRM for a sign shop: customers/contacts, documents (estimates, sales orders, invoices), quoting/pricing, work orders, payments (Stripe), reporting, materials/rates, time clock, and staff workflows.

## Roles
- **Admin**: full access.
- **Salesman**: limited access, earns commission (e.g. 10%).
- **Installer/Service**: work orders, time clock.

## Pricing / Commission
- Shared line-item builder (`DocBuilder.jsx`) powers Estimate / Sales Order / Invoice.
- Customer-facing prices never expose material/buying cost, markup, or internal margin.
- Special line categories: Shipping (30% markup, cost-only), Installation (flat), CNC Router Time (min × rate, default $1.30/min).
- **Commission = gross profit (sum of material margins) × commission rate.**
  - Laminator machine cost is NOT deducted from commission (removed June 2026 per user request). Laminator settings fields still exist in Settings but no longer affect commission.

## Key files
- `backend/server.py` — all API, commission calc (~1225), doc numbering counters (start 29500), CORS, seeding.
- `frontend/src/components/DocBuilder.jsx` — shared builder + commission display.
- `frontend/src/pages/` — Settings, Customers, WorkOrders, Invoices, Estimates, SalesOrders, Reports, TimeClock.

## Integrations
- MongoDB (MONGO_URL / DB_NAME).
- Stripe (embedded Elements / PaymentIntent, public pay links).
- Managed email/Resend (no attachment support — use download links only).
- Emergent cron (daily overdue reminders).

## Recent changes
- **June 2026**: Work status visible to customers — shown as a "Work Status" line in the document PDF meta block (SO/Invoice) and as a colored "Progress" badge column in the customer portal "Order history" (`WorkStatusBadge`).
- **June 2026**: Work status field + inline dropdown + customer email on change.
- **June 2026**: Reorders bulk delete (admin checkboxes + password-confirmed).
- **June 2026**: Portal multi-invoice pay — select invoices and pay together via "Pay selected".
- **June 2026**: Reorders upgrade (prior line items on portal, invoice link + SO generation + customer email on Mark processing).
- **June 2026**: Contact portal checkbox + per-unit price box.
- **June 2026**: "Create a copy" action + per-document tax exempt checkbox + customer search (tested iteration 15).
- **June 2026**: Installation excluded from commission — commission base skips category "Installation".
- **June 2026**: Tax exempt customers — checkbox + number on customer form; selecting an exempt customer auto-zeros doc tax; PDF shows "Tax Exempt · {number}".
- **June 2026**: Customer PO field — optional "Customer PO" on Estimate/SO/Invoice builder; shown on PDF + email; carried over on approve/convert.
- **June 2026**: Email monthly statement — statement dialog "Email to customer" button, `POST /api/customers/{cid}/statement/email`, blind copy to sales@dbgsigns.com, download link via `GET /api/pub/statement/{token}`.
- **June 2026**: Per-customer monthly statement — "Statement" button on each Customers row opens a month-picker dialog and downloads a PDF of that customer's invoices & balances. Backend: `GET /api/customers/{cid}/statement/pdf?month=YYYY-MM`.
- **June 2026**: Estimate/Sales Order/Invoice emails now include a customer "DOWNLOAD (PDF)" link (via `/api/pub/pdf/{token}`) and send a blind copy to sales@dbgsigns.com (separate send — managed email has no bcc field; copy omits tracking pixel).
- **June 2026**: Removed laminator cost from commission calculation entirely. Commission base = gross profit.

## Backlog / P1-P2
- Admin dashboard "clocked-in today" widget.
- Customer monthly statement from customer popup.
- N+1 optimization for large endpoints.
- Safe refactor sprint (DocBuilder/Invoices/backend imports).
- Remove hardcoded test secrets in test files.
- Data cleanup: duplicate "Chris Acker" team records.

## Invariants
## Recent (June 2026)
- **Multi-recipient send**: "Email to customer" on Estimates/Sales Orders/Invoices now opens a **SendDialog** (`components/SendDialog.jsx`) listing the customer's company email + all contacts with emails as checkboxes (current contact/company preselected), plus an "add another email" field. Sends one email to all selected recipients. Backend: `SendDocInput{recipients:[]}` on the three `/send` endpoints; `_send_document` accepts a recipient list (dedupes, joins), `send_email` accepts str or list. `enrich_customer` now returns `customer_email`. BCC copy to sales@dbgsigns.com unchanged. Empty recipients falls back to the default single recipient. Verified end-to-end.
- **Tracking #** field on Sales Orders & Invoices only (not Estimates): text box next to Customer PO in `DocBuilder.jsx` (`doc-tracking-number`). Backend `tracking_number` on Estimate/Invoice models; carries SO→Invoice; renders on customer PDF ("Tracking #") and in the document email. Verified end-to-end.

## Constraints
- Preview only; production requires user Deploy.
- Do NOT re-add Email-to-Xero/accounting.
- Do NOT restore per-line Laminate checkbox.
- Do NOT re-run markup multiplier migration.
- Doc counters: next real doc = 29500.
