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
- **Design Time rate setting**: exposed `design_rate_per_min` ($/min, default $1.08) on the Settings page next to the CNC rate. Verified save/persist.
- **Estimate trace link on SO**: the Sales Orders "From Estimate" column is now a clickable link (uses `from_estimate` + `estimate_id`) that opens the originating estimate with row highlight. The Estimates list normally hides converted estimates but still shows a focused one when traced from its SO (`visibleRows` allows `id === focusId`). Verified end-to-end.
- **Estimates drop off after conversion**: estimates with a `sales_order_id` are filtered out of the Estimates page.
- **Salesman conversions**: salespeople can convert estimate→SO and SO→invoice.
- **Design Time line category**: added "Design Time" preset category (like CNC Router Time) — a Minutes textbox × per-minute rate. New setting `design_rate_per_min` default **$1.08/min**; flat charge (no shop/machine labor); line_total = minutes × rate. Verified 30 min = $32.40 (backend + builder UI).
- **Reorderable categories**: up/down arrows in Categories dialog persist order (`settings.category_order`) driving all category dropdowns.
- **Deletable material categories**: admins can delete built-in categories (reversible hide) + custom (permanent).
- **Auto ship date**: `_autostamp_ship_date` stamps today on SO/Invoice when a tracking # is present and no ship date set (create+update); explicit dates preserved.
- **Ship date field ("Shipped on")** on SO/Invoice next to tracking; on PDF/email/lists/portal; carries SO→Invoice.
- **Shipping type**: dropdown (None / Ground / 2 Day Air / Overnight / Overnight AM / LTL) on Estimate/SO/Invoice builders; shown with tracking on PDF/email/lists/portal; carries EST→SO→Invoice.
- **Resend (managed email) integration**: app sends all email through Emergent's managed Resend proxy; added Reply-To `sales@dbgsigns.com`.
- **Open linked job**: linked SO/Invoice on calendar tile is a clickable link to the doc (with row highlight; added `?focus=` to Invoices).
- **Reschedule notice**: editing an install with a changed date auto-emails the customer an "installation rescheduled" alert (new date + prep note) and clears `reminder_sent_at` so the day-before reminder can fire for the new date; no email when the date is unchanged. `render_install_email(reschedule=True)`. Install notify is now resilient — email failures (e.g. rate limit) return `{"status":"error"}` and never block the save; UI shows a "use Resend" warning. Verified.
- **Install reminder email (cron)**: `.emergent/crons.yml` `install-reminders` daily → `POST /api/cron/install-reminders`; emails customers the day before their install, idempotent, marks `reminder_sent_at`.
- **Install → job link**: install dialog "Link to job" dropdown (customer's SOs + Invoices); `_enrich_install` returns `linked_number`, shown on the tile.
- **Nav**: Install Calendar sits directly under Invoices.
- **Install Calendar** (`/install-calendar`, admin-only): month grid; schedule installs (date, Morning/Afternoon, customer, contact, description) → alert email + prep note + internal copy; edit dialog Resend + admin-password Delete. Backend `db.installs`, `InstallInput`, `GET/POST/PUT/DELETE /api/installs` + `/installs/{id}/notify`.
- **Carrier link**: tracking numbers are now clickable links to the carrier's tracking page. Carrier auto-detected from the number format (UPS `1Z…`, FedEx 12/15 digits, USPS 20+/9x/420, DHL 10 digits, else Google fallback). Frontend `carrierInfo()` in `lib/api.js` + `<TrackingLink>` in kit.jsx, used on Sales Orders/Invoices lists and the customer Portal. Shipped-notice email also links the tracking # + a "Track your package" button (backend `carrier_track_url()`).
- **Read receipts (per recipient)**: `_send_document` now sends an individual email to each recipient, each with its own tracking pixel token, stored in `email_receipts:[{email,token,opened_at}]`. Sends are resilient — a failed address is skipped and returned in `failed` (frontend shows a warning toast); doc still records the ones that went out. `/track/open/{token}` marks the specific recipient's receipt opened (array filter). `ReceiptBadge` shows "Opened X/N" (green) or "Emailed to N people" (amber) with a per-recipient hover tooltip. Verified end-to-end.
- **Portal tracking**: added a "Tracking #" column to the customer Portal order history (clickable carrier link). `tracking_number` already flows through `/portal/orders` (not a margin field).
- **Shipped notice**: adding/changing a Tracking # on a Sales Order or Invoice auto-sends a branded "your order has shipped" email + internal copy. Fires only when tracking transitions to a new non-empty value. Stores `shipped_notified_at`.
- **Tracking # column**: on Sales Orders and Invoices lists.
- **Multi-recipient send**: "Email to customer" opens SendDialog (contacts + company email checkboxes + add-another-email).
- **Tracking #** field on SO & Invoice builder (not Estimates), next to Customer PO; carries SO→Invoice; on PDF + email.

## Constraints
- Preview only; production requires user Deploy.
- Do NOT re-add Email-to-Xero/accounting.
- Do NOT restore per-line Laminate checkbox.
- Do NOT re-run markup multiplier migration.
- Doc counters: next real doc = 29500.
