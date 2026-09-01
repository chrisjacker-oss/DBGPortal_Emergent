# DBG Signs, Inc. — Sign Shop CRM (PRD)

## Original Problem Statement
Build a sign shop CRM with estimating, materials database, invoicing, customer reorder portal, accounts payable and receivable, and exporting to Xero financial.

## User Choices
- Auth: Email + password (JWT via httpOnly cookies)
- Roles: admin, staff, customer (distinct permissions)
- Xero: export invoices/bills as Xero-compatible CSV files
- Payments: manual paid/unpaid tracking (no online payments yet)
- Brand: DBG Signs, Inc. — tagline "Image Is Everything"

## Architecture
- Backend: FastAPI + MongoDB (motor), all routes under /api
- Frontend: React (CRA/craco) + Tailwind, Swiss-brutalist theme, Phosphor icons
- Auth: bcrypt hashing, httpOnly cookies, require_staff gate, brute-force lockout, admin seed on startup

## Personas
- Admin/Owner: full financial + CRM control
- Staff: estimating, invoicing, materials, customers, AP/AR, reorders
- Customer: portal only — order history + reorder requests

## Implemented (2026-09-01)
- Email/password auth with roles; admin seeded (chrisjacker@gmail.com)
- Customers CRM (CRUD)
- Materials database (CRUD, cost/price/margin, staff-only)
- Estimating builder with line items, material autofill, tax, totals; convert-to-invoice
- Invoicing (CRUD, mark paid, line items)
- Accounts Payable (bills CRUD, mark paid, summary)
- Accounts Receivable (outstanding/overdue/collected, receive payment)
- Customer reorder portal + staff reorder queue with status advance
- Xero-compatible CSV export for invoices and bills
- Dashboard KPIs
- Rebranded to DBG Signs, Inc. with Dallas skyline login
- Tested: backend 95%, frontend 100%. Fixed: invalid-ID 404 guard, material cost restricted to staff.

## Backlog
- P1: atomic document numbering (avoid reused EST/INV/BILL numbers after delete)
- P1: lockout keyed on X-Forwarded-For / per-email
- P2: logout should clear cookies without valid token; partial-payment amounts; PDF invoices; live Xero API sync; pagination
