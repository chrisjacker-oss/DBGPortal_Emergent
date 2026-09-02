# DBG Signs, Inc. — Sign Shop CRM (PRD)

## Original Problem Statement
Sign shop CRM with estimating, materials database, invoicing, customer reorder portal, accounts payable/receivable, and Xero export.

## Users / Choices
- Auth: email + password (JWT httpOnly cookies). Separate logins: staff console `/login` (admin + salesman), customer portal `/portal-login`.
- Roles: admin (full control), salesman (limited: estimates, sales orders, invoices, customers, own commissions), customer (portal only).
- Xero: CSV export (invoices incl. negative tier-discount row, bills).
- Payments: manual paid/unpaid AND Stripe embedded card ("Pay Now") — auto-marks invoice paid on success.

## Recent changes (2026-06)
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
