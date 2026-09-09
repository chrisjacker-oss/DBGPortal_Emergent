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
- **June 2026**: Removed laminator cost from commission calculation entirely (backend + frontend). Commission base = gross profit. Verified via API; estimates counter reset to 29499.
- Role-based laminator display (admin-only) — superseded by full removal above.

## Backlog / P1-P2
- Admin dashboard "clocked-in today" widget.
- Customer monthly statement from customer popup.
- N+1 optimization for large endpoints.
- Safe refactor sprint (DocBuilder/Invoices/backend imports).
- Remove hardcoded test secrets in test files.
- Data cleanup: duplicate "Chris Acker" team records.

## Invariants
- Preview only; production requires user Deploy.
- Do NOT re-add Email-to-Xero/accounting.
- Do NOT restore per-line Laminate checkbox.
- Do NOT re-run markup multiplier migration.
- Doc counters: next real doc = 29500.
