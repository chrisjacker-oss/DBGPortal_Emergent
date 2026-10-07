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
- **October 2026**: The Paid invoice tab now includes an **In Zero** Yes/No field between
  the invoice number and customer. Only admins can change this internal paid-invoice flag;
  it is unavailable for unpaid or voided invoices.
- **October 2026**: Invoice **Invoiced & Waiting Payment** and **Paid** tabs no longer
  display selection checkboxes, bulk deletion, or a Delete action. Active and Voided
  invoice workflows keep their existing admin deletion controls.
- **October 2026**: Customer tentative-date submissions now send a server-side email to
  `sales@dbgsigns.com` stating that the customer replied with an install date. Delivery
  acceptance or failure is recorded without blocking the customer’s calendar request.
- **October 2026**: Salesmen can edit existing Estimates, Sales Orders, and Invoices.
  Customer binding, commission ownership, and commission rate stay locked during those
  edits; document copying remains admin-only.
- **October 2026**: Every COD/Deposit payment-link email now sends a separate matching
  copy to `sales@dbgsigns.com` after at least one customer recipient is delivered.
  Sales-copy failures are logged without interrupting customer delivery.
- **October 2026**: Removed work status from Estimates only. Estimate tables, PDFs, and
  API updates no longer expose it; Sales Orders and Invoices retain their work statuses.
- **October 2026**: Document editing and duplication are now admin-only for Estimates,
  Sales Orders, and Invoices. Every document permanently retains the customer assigned at
  creation, even for admins; salesmen retain their limited work-status updates only.
- **September 2026**: Document payment state now identifies the customer payment source:
  `Stripe Deposit $…` or `Stripe Paid $…` on Estimates, Sales Orders, and Invoices.
  COD payments on Estimates/Sales Orders now also notify sales as paid via Stripe/Credit Card.
- **September 2026**: When a Stripe/Credit Card payment fully moves an Invoice into the
  **Paid** state, `sales@dbgsigns.com` receives a separate one-time “Invoice paid via
  Stripe / Credit Card” email. Deposit notices remain separate from the full-paid alert.
- **September 2026**: Confirmed Stripe COD/50-50 payments now show a clear `Deposit $…`
  or `Paid $…` state on Estimate, Sales Order, and Invoice lists. The payment amount
  continues through Estimate → Sales Order → Invoice conversion, and a confirmed
  payment sends a one-time sales notification to `sales@dbgsigns.com`.
- **September 2026**: Completed / Installation Schedule emails now include their own
  tracking pixel. Tentative install cards show `OPENED` when the customer loads the email,
  and the staff install dialog displays the opened timestamp or `Unread` status.
- **September 2026**: Replaced the shared company logo with the supplied DBG Signs &
  Graphics PNG. The stored logo is used by CRM navigation/settings, public email images,
  and every PDF generator that reads the company logo setting.
- **September 2026**: Artwork Proof emails now include the customer approval instructions
  requested by the shop. Each proof recipient gets an individual open-tracking pixel;
  Artwork Proofs shows `Unread X/N` or `Opened X/N` per current version and history.
- **September 2026**: Tentative install requests now support staff decisions: **Approved**
  emails acceptance of the selected date, while **Date taken / offer open date** lets staff
  select a replacement slot and email a secure customer **Accept this date** action.
  Offered dates show as `OFFER` in the calendar and become confirmed only after acceptance.
- **September 2026**: Added **Completed / Installation Schedule** work status for Sales
  Orders and Invoices. It sends the completed-decals email and a
  30-day secure scheduling link. Customers can request Monday–Thursday AM/PM or Friday
  AM, leave notes, and create a tentative calendar entry for staff review/confirmation.
- **September 2026**: Install Calendar now flags tentative customer requests as `REQ`.
  Staff can adjust and confirm them; confirmation sends the existing installation notice.
- **September 2026**: Added a desktop sidebar collapse/expand control so staff can open
  more workspace; arrow controls now show **Close** and **Expand** labels. The responsive
  mobile navigation drawer remains available.
- **September 2026**: Added the admin-only **Automatic Backup Vault** in Settings.
  It stores complete Extended JSON CRM backups in durable private object storage, supports
  manual runs/downloads/removal, and keeps every accessible backup until an admin removes it.
- **September 2026**: Added an idempotent monthly backup cron for the first of each month
  at `08:00 UTC` (2:00 AM Central Standard Time / 3:00 AM daylight time). Backup metadata
  is exposed to admins only; storage paths and backup contents stay server-side.
- **September 2026**: Added preset **Service Call** and **Local Delivery Fee**
  categories. Service Call uses a manual price; Local Delivery Fee stores miles plus a
  manual fee. Both are flat charges and carry through Estimate → Sales Order → Invoice,
  including customer PDF/email output.
- **September 2026**: Customer Contacts now has an in-place **Edit** control for name,
  title, email, and phone. When a contact has portal access, an email update safely
  synchronizes the linked portal sign-in without changing its password or active session.
- **September 2026**: Every immediate task in the Estimate, Sales Order, and Invoice
  Actions menus now opens a shared summary popup with **Cancel** and **Confirm**.
  Existing task-specific dialogs (email, payments, edit, notes, history, delete) remain
  unchanged.
- **September 2026**: Renamed the document Actions menu payment command to
  **COD/Deposit Email** on Estimates, Sales Orders, and Invoices.
- **September 2026**: Estimates, Sales Orders, and Invoices now include a **Send payment
  link** action for staff. The popup selects customer contacts and either requests a
  50% deposit or the full COD balance. Each email uses a fixed, secure, 30-day public
  payment link; the public page cannot alter the requested amount.
- **September 2026**: Deposits paid on an Estimate carry into its Sales Order and then
  Invoice during conversion. Payment-request records mark the specific link paid while
  preserving existing Stripe portal payment flows.
- **September 2026**: Admin-only CRM Backup & Restore in Settings. Backup exports every
  MongoDB CRM collection as a portable Extended JSON file; restore replaces current
  database records only after an admin password and typed `RESTORE` confirmation.
- **September 2026**: Salesmen can update customer work status on Sales Orders and
  Invoices. The Estimate-specific status workflow was removed in October 2026.
- **September 2026**: Documents now include an optional manual **Shipping address**
  that carries Estimate → Sales Order → Invoice and is shown in customer email and
  PDF exports as Ship To.
- **September 2026**: Customer-facing Estimate, Sales Order, and Invoice PDFs/emails
  show Size, Quantity, Unit Price, and Amount for standard items. Flat services
  (Installation, Design Time, CNC, Decal Removal) remain a single visible charge.
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
- Optional Google Drive copy of the monthly CRM backup: paused pending Google OAuth
  Client ID and Client Secret. The secure in-app vault is active now.
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
- **Idle auto-logout**: signed-in users are auto-signed-out after N idle minutes (setting `idle_timeout_min`, default 90), with a 1-minute countdown warning dialog (`IdleWarning.jsx`) offering "Stay signed in" (renews token via `/auth/refresh`) or "Sign out". Timeout is admin-editable on Settings → Security; value delivered to all roles via `/auth/me` + login. Login page shows an inactivity message after auto-logout. Verified.
- **Label changes** (Jun 2026): work status "ready" now displays "Pickup / Shipping" (was "Ready for Pickup / Shipping") in kit.jsx `WORK_STATUS` + backend `WORK_STATUS_LABELS`; document "due date" now labeled "Est. Complete date" on Estimate/SO/Invoice builder (DocBuilder), PDF meta, document email, and Invoice detail/print. Stored value/`due_date` key unchanged. Verified.
- **Installer work orders**: installers see only their own work orders, can create + edit them (fix mistakes), cannot delete (admin-only). Confirmed already-implemented + verified.
- **Estimate customer approval** (Jun 2026): estimate emails include a green "✓ APPROVE THIS ESTIMATE" button → public page `/approve/:token` (PublicApprove.jsx) using the per-recipient `email_tracking` token. Backend `GET /api/pub/approve/{token}` (summary) + `POST /api/pub/approve/{token}` (idempotent) set `customer_approved`/`customer_approved_at`/`customer_approved_by` and email the shop (`render_estimate_approved_email` → sales@dbgsigns.com). Estimates list shows a green "CUSTOMER OK" badge; staff "Approve → Sales Order" convert action stays available until an SO exists (hide condition now `sales_order_id`, not status). Fields added to `_DUP_STRIP`. Verified end-to-end.
- **Artwork Proof approval system** (Jun 2026): standalone `/artwork-proofs` page (admin+salesman) to upload a single artwork file (PDF/JPG/PNG, ≤25MB), optionally link to an Estimate/SO/Invoice, and email it to the customer contact. Public no-login page `/proof/:token` (PublicProof.jsx) shows a preview (img inline / PDF iframe) with **Approve** and **Request changes** (typed notes). Approve/changes email sales@dbgsigns.com (`render_proof_decision_email`) and are saved on the proof; change notes shown on the staff row. **Versioned revisions** (v1,v2…) on the same proof with history dialog; each version keeps its own file + decision; public tokens are version-scoped. Files stored via **Emergent object storage** (init_storage/storage_put/storage_get; requires `EMERGENT_LLM_KEY` in env — added to backend/.env; **must be set in production secrets for uploads to work live**). Backend: `db.proofs` + `db.proof_tokens`, endpoints `POST /api/proofs` (multipart), `POST /api/proofs/{id}/version`, `GET/DELETE /api/proofs`, `POST /api/proofs/{id}/send`, `GET /api/proofs/{id}/file`, public `GET /api/pub/proof/{token}` + `/file` + `POST /approve` + `/changes`. Nav "Artwork Proofs" for admin+salesman. Tested 9/9 backend + all frontend flows (iteration_16).

## Constraints
- Preview only; production requires user Deploy.
- Do NOT re-add Email-to-Xero/accounting.
- Do NOT restore per-line Laminate checkbox.
- Do NOT re-run markup multiplier migration.
- Doc counters: next real doc = 29500.

## Latest validation
- October 2026: Admin API and browser checks confirmed **In Zero** saves Yes/No on paid
  invoices only, while salesmen receive a server-side `403`. The temporary QA invoice and
  customer were removed. Backend compile and frontend production build passed.
- October 2026: Admin browser checks verified that Waiting Payment and Paid invoice rows
  omit select-all, row checkboxes, bulk deletion, and Delete actions. Temporary QA
  invoices were removed; the frontend production build passed with the existing warning.
- October 2026: Iteration 21 QA passed 30/30 checks across install scheduling, document
  role controls, and salesman UI. It confirmed a provider-accepted sales notification,
  locked customers/commission attribution, admin-only copying, and mobile-safe tables.
- October 2026: A controlled COD payment-link request delivered to the managed-email test
  recipient and confirmed the matching sales copy was sent. Temporary customer, Estimate,
  and payment-request records were removed.
- October 2026: Estimate work-status removal passed 8 focused API regression tests and
  browser checks. Estimate controls and its API route are absent; Sales Order work status
  remains available. Backend compile and frontend build passed with the existing
  non-blocking Install Calendar hook warning.
- October 2026: Document-locking QA passed 7 backend tests and salesman/admin browser
  flows. Admin edits and copies work, customer reassignment is rejected, salesman direct
  edits/copies/status changes are denied, work-status-only updates remain allowed, and
  document tables do not create mobile page overflow. Temporary QA data was deleted.
- September 2026: Controlled COD payment verified the Sales Order becomes `Stripe Paid`,
  stores the Stripe/Credit Card source, and sends the sales customer-paid notice once.
- September 2026: Controlled full Stripe invoice payment verified Paid status, one sales
  email, and idempotent retry protection. Temporary invoice/payment records were removed.
- September 2026: Controlled Stripe-confirmation verification proved a 50/50 payment
  updates the Estimate, carries to Sales Order and Invoice, and triggers exactly one
  sales notification after confirmation. Temporary records were removed.
- September 2026: Completed/install schedule email pixel and Install Calendar
  Opened/Unread indicator were API and browser verified; temporary records were removed.
- September 2026: Proof email-read tracking pixel and the Artwork Proofs `Opened 1/1`
  indicator were API/browser verified. The temporary verification proof was removed.
- September 2026: Alternate-date workflow was API-verified end-to-end: customer tentative
  request → staff offer → public offered-date view → customer acceptance → confirmed install.
- September 2026: Tentative-install QA passed 17 sequential API tests, including status
  email/token creation, public-date validation, duplicate protection, tentative calendar
  creation, estimate links, and confirmation. Browser checks passed for the public
  calendar/mobile layout and desktop sidebar toggle; temporary records were removed.
- September 2026: Backup vault QA passed 15 backend tests and full Settings/mobile flows.
  Verified protected upload, Extended JSON download, role gating, soft removal, cron auth,
  and same-run idempotency. Two real backups (one manual, one monthly) remain in the vault.
- September 2026: Service Call and Local Delivery Fee were verified in category APIs,
  document-builder inputs, calculation totals, Estimate → SO → Invoice conversion, and
  invoice PDF output. Test documents were deleted.
- September 2026: Payment-link QA passed 11 backend tests plus full admin/salesman UI
  flows for Estimate, Sales Order, and Invoice. Test documents, customers, and payment
  requests were removed. A managed-email rate limit caused one unrelated resend smoke
  test to skip; payment-link request generation and public pages passed.
- September 2026: CRM backup export was verified for an admin; salesman access is
  denied, malformed restore files are rejected before changes, and a rejection left
  exported collection counts unchanged. A real restore was not run against live data.
- September 2026: API workflow verified salesman work-status updates on all three
  document types, shipping-address conversion, unit pricing, and invoice PDF export.
- Generated PDF was rendered and visually checked. Test documents were deleted;
  document number gaps are expected and preserved.
