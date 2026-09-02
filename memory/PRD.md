# DBG Signs, Inc. — Sign Shop CRM (PRD)

## Original Problem Statement
Sign shop CRM with estimating, materials database, invoicing, customer reorder portal, accounts payable/receivable, and Xero export.

## Users / Choices
- Auth: email + password (JWT httpOnly cookies). Separate logins: staff console `/login` (admin + salesman), customer portal `/portal-login`.
- Roles: admin (full control), salesman (limited: estimates, sales orders, invoices, customers, own commissions), customer (portal only).
- Xero: CSV export (invoices incl. negative tier-discount row, bills).
- Payments: manual paid/unpaid (Stripe requested, NOT yet integrated).

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

## PENDING REQUESTS (requested, NOT implemented this session)
- Remove $/sqft column from customer-facing estimates/sales orders/invoices.
- Hide the tier discount on customer-facing documents; show only material cost, subtotal, and sqft used.
- Modern/professional redesign of the estimate/SO/invoice documents sent to customers (PDF + email).
- Stripe integration (online invoice payment). Playbook not yet pulled; use env Stripe test key, emergentintegrations.

## Backlog
- Split server.py into routers; add search indexes; stamp net_terms onto docs at creation (historical PDF accuracy); require due_date for dunning.
