# DBG Signs, Inc. — Sign Shop CRM (PRD)

## Original Problem Statement
Sign shop CRM with estimating, materials database, invoicing, customer reorder portal, accounts payable/receivable, and Xero export.

## Users / Choices
- Auth: email + password (JWT httpOnly cookies). Separate logins: staff console `/login` (admin + salesman), customer portal `/portal-login`.
- Roles: admin (full control), salesman (limited: estimates, sales orders, invoices, customers, own commissions), customer (portal only).
- Xero: CSV export (invoices incl. negative tier-discount row, bills).
- Payments: manual paid/unpaid AND Stripe embedded card ("Pay Now") — auto-marks invoice paid on success.

## Recent changes (2026-06)
- Manual payment recording: staff "Record payment" dialog on invoices captures method (Check/ACH/Wire/Cash/Card/Other) + reference (check # / ACH trace), amount (supports partial) and date. POST /api/invoices/{id}/manual-payment applies to amount_paid, flips partial→paid, and the reference shows in the invoice payment history (e.g. "Check #10432").
- Role gating: salesman & installer can no longer see Dashboard, Portal Accounts, Receivables, Payables, Team or Settings (menu + direct-URL redirect via role-based Protected routes). /api/dashboard and /api/receivables/overdue are admin-only. Salesman lands on /estimates, installer on /work-orders.
- Multiple contacts per company: db.contacts (name/email/phone/title), managed from Customers → Contacts dialog. A contact can optionally be given a portal login (user.customer_id links login → company; supports multiple logins per company). Estimates/SOs/Invoices have a Contact (Attn) dropdown; the contact shows as "Attn:" on the PDF + email and is used as the email recipient. contact_id carries through approve→SO→invoice.
- Card surcharge: Settings toggle + % (card_surcharge_enabled/pct). Online card payments (single, partial, pay-all) add the fee on top; base still applied to invoice(s). Pay dialog shows the fee.
- Statement PDF: portal customers get a one-click account statement of open invoices (GET /api/portal/statement/pdf, build_statement_pdf); "Statement" button in portal header.
- Work Orders: service/installer daily logs. Model + CRUD (/api/work-orders, require_worker; installers see/edit own, admin sees all). Fields: customer (+ inline add-customer), date, work performed, unit/VIN, equipment type (Trailer/Box Truck/Vehicle/Tractor/Outside Sign/Other+text), mileage start/end. New WorkOrders page.
- New role: installer (a.k.a. service/installer). Added to Team role picker, /api/users; require_worker = admin|salesman|installer gates /customers (list+create) and work orders. Installer nav = Work Orders + Customers; lands on /work-orders; blocked from other staff routes (URL-guarded in Protected).
- Documents (PDF + email) show line-item SIZE as `W" × H" × qty · sqft` (helper _dims_label) instead of just sqft.
- Pay All Outstanding: portal customers can settle every unpaid invoice in one card charge (POST /api/payments/create-intent-all → one PaymentIntent, allocations applied to each invoice on success). Portal header "Pay all ($X)" button.
- Payment History: GET /api/invoices/{id}/payments lists card payments (date/amount/method), incl. bulk allocations; staff Invoices page has a history dialog per invoice.
- Overdue Auto-Reminders: daily cron (/app/.emergent/crons.yml → POST /api/cron/overdue-reminders, Bearer WEBHOOK_CRON_SECRET, 15:00 UTC) emails a friendly past-due nudge for invoices past due date (throttled to once / 3 days via past_due_sent_at, idempotent by run_id). Cron endpoint acks immediately + backgrounds work.
- Material categories: added built-in "Marketing Materials"; admin-managed custom categories (GET/POST/DELETE /api/material-categories; Materials page "Categories" dialog).
- Commission: base is now MATERIALS-ONLY at SELLING price × commission_rate (no labor/machine, not at-cost). DocBuilder preview + /api/commissions updated.
- Settings: default_tax_rate applied/seeded to new estimates/SOs/invoices (editable per doc).
- Sales Orders can be created directly from the Sales Orders page (POST/PUT /api/sales-orders), not only via estimate approval.
- Stripe embedded card payments: POST /api/payments/create-intent (card-only, optional partial `amount`), GET /api/payments/status/{id}, POST /api/stripe/webhook. Pay Now on staff Invoices + customer Portal. Keys in backend/.env; frontend REACT_APP_STRIPE_PUBLISHABLE_KEY. Stripe test sandbox.
- Partial payments: invoices track amount_paid; status flips unpaid→partial→paid; balance shown on Invoices + Portal; PayNowDialog lets you choose an amount (default full balance). _apply_payment is idempotent (guards double-count across status-poll + webhook).
- Payment receipts: automatic emailed receipt to the customer when a card payment clears (render_payment_receipt_email via Resend; failures never block payment).
- Portal accounts admin console (/portal-accounts, admin only): add / suspend (blocks login) / delete customer logins.
- Void + reactivate for invoices & sales orders (Active/Voided tabs), ADMIN-ONLY. Voided excluded from dashboard/receivables/portal/payment.
- Deleting any estimate/SO/invoice requires the admin password (admin-only); reusable AdminDeleteDialog.
- Logo now shown on login page + console sidebar (served from /api/pub/logo).
- Dashboard: admin-only Accounts Payable card + Record Bill/Add Material quick actions.
- Customer Portal: friendly "Access unavailable" panel when portal disabled/suspended (no blank page).

## Accounts (see /app/memory/test_credentials.md)
- admin: sales@dbgsigns.com / 10297099 ; chrisjacker@gmail.com / SignShop2026!
- salesman: sam@dbgsigns.com / Sales2026!

## Implemented (through 2026-09)
- Estimate → Sales Order → Invoice pipeline (approve creates SO, convert creates INV; commission + tier discount carried through).
- Materials DB costing: cost/sqft = buying_cost ÷ conversion_factor; price/sqft = cost/sqft × (1+markup%). Staff/admin only.
- Area-based line items (W×H×qty). Shop labor $65/hr @150 sqft/hr and machine $35/hr @150 sqft/hr auto-derived from area; optional extra labor hours. Global Shop Settings.
- Sales commission per estimate (rate defaults from salesman profile; base = pre-tax cost subtotal). Commissions report (admin: by-salesman; salesman: own).
- Customer tiers: T1 35% / T2 25% / T3 15% discount applied to subtotal. Customer fields: title, net_terms (COD/50/50/Net 10/Net 15), portal_enabled checkbox.
- Customer portal (reorders + order history) with portal_enabled gating.
- Accounts Receivable + Payable dashboards; past-due (>45d) notices email a PDF invoice link with read receipt.
- Email (Emergent Resend) send of estimates/SOs/invoices + tracking-pixel read receipts.
- PDF generation (reportlab) for estimates/SOs/invoices + public tokenized PDF links.
- Site-wide search (estimate/SO/invoice #, customer, material, line-item description).
- Xero CSV export; role-based nav; DBG Signs branding + Dallas skyline login.
- Testing: iteration 5 backend 100% (79 pytest), frontend 92%.

## KNOWN OPEN ISSUES (not yet fixed)
- HIGH: Portal.jsx has no error handling for the 403 portal-disabled gate (customer sees blank page / CRA overlay).
- MEDIUM: Salesman dashboard shows dead "Record Bill" / "Add Material" quick actions; dashboard "payable" figure not gated to admin.
- LOW: 1-cent FE/BE rounding mismatch in DocBuilder preview; add DialogDescription for a11y.

## PENDING REQUESTS (requested, NOT implemented)
- Stripe integration (online invoice payment). Playbook not yet pulled; use env Stripe test key, emergentintegrations.

## Recently completed
- **Company info in Settings** (name, address, phone, web, email) — persisted in shop settings and rendered on quotes, sales orders and invoices (PDF footer + email footer).
- **Logo upload** in Settings (stored in MongoDB base64, served via GET /api/pub/logo) — appears on all documents; "Use default" reverts.
- **Per-line-item details** field (specifics) on estimates/SOs/invoices — shown in the builder, PDF (gray sub-line) and email.
- **Material categories** are now a preset dropdown: Cut Vinyl, Digital Vinyl, Banner, Substrates, Laminates.
- Modern mailable invoice/estimate/SO redesign (PDF + email) with logo; $/sqft and tier-discount hidden on customer docs (discount applied at line level so totals reconcile); commission on full cost subtotal (material + shop labor + machine).

## Backlog
- Split server.py into routers; add search indexes; stamp net_terms onto docs at creation (historical PDF accuracy); require due_date for dunning.

## Changelog 2026-06 (session: onboarding + delete security + commissions)
- **New team-member onboarding**: admin creates a staff account with a temp password → a welcome email (Resend) is sent with the temp password + a note to change it; user is forced onto a "Set a new password" screen (`ForcePasswordChange.jsx`) on first login. Backend: `must_change_password` flag on create_user + admin password resets (PUT /users when password supplied by another admin); `POST /api/auth/change-password`; login/me return the flag. Agent-tested (backend curl + frontend e2e, iteration_7 100%).
- **Every delete requires the admin account password**: all DELETE endpoints (customers, contacts, contact-portal, work-orders, materials, material-categories, bills, users, portal-accounts + existing estimates/SO/invoices) now take a `DeleteConfirm` body and `verify_admin_password`; frontend uses shared `AdminDeleteDialog` everywhere. Delete buttons hidden for non-admins (Customers/Contacts for salesman, Work Orders for installer). Agent-tested.
- **Line-item builder redesigned** (`DocBuilder.jsx`): columns are now Category → Material (filtered by category) → W(in) → H(in) → Qty → Sqft (computed) → Extra hrs → Cost. Free-text description dropped (auto-filled from material); details textbox kept. Admins get "+ Create category…" inline in the category dropdown.
- **Commissions rework** (`Commissions.jsx`): Unpaid/Paid tabs; admins select rows (checkboxes) and Mark Paid with a required PO number (`POST /api/commissions/pay`), which moves them to the Paid tab (shows PO #). Admin can Move back to Unpaid (`/commissions/unpay`). Added "Paid out" stat + per-salesman Paid column. Salesmen are read-only. Agent/self-tested.
- Removed custom material category "Wraps". Seeded demo installer `service@dbgsigns.com` in startup().
- **Paid commissions tab polish**: removed row checkboxes on the Paid tab, added a **Paid Date** column, and an **Export PDF** button (`GET /api/commissions/paid/pdf`, scoped: admin=all, salesman=own) that renders a branded "Commissions · Paid" statement (logo, PO #, paid date, total). PDF verified by rendering. Undo/move-back on the Paid tab was removed per request.
- **Commissions enhancements (iteration_8, 100%)**: (1) **Per-commission PO** — Mark-Paid dialog now has one PO field per selected commission; `POST /api/commissions/pay` takes `{items:[{estimate_id,po_number}]}` and validates all POs before applying (no partial apply). (2) **Per-salesman PDF** — By-salesman table has an Export button per salesman (`?salesman_name=`). (3) **Paid date filter** — From/To inputs on the Paid tab filter rows and feed `date_from`/`date_to` into the export PDF.
- **Dashboard drill-down + Receivables filter (iteration_8)**: dashboard stat cards and mini-stats are clickable and navigate to their detail pages; the Outstanding Receivable card goes to `/receivables?filter=overdue`. Receivables gained an **All / Overdue** toggle synced to the `?filter=overdue` URL param (`Dashboard.jsx`, `Receivables.jsx`).

