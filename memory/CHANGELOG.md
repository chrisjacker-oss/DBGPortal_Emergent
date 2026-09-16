# Changelog

## Jun 2026
- **Send email note**: shared Send popup (SendDialog) now has an optional "Note to customer" field for Estimates, Sales Orders, and Invoices. Backend `SendDocInput.note` → `_send_document(note=...)` → `render_doc_email(note=...)` renders a highlighted message block near the greeting (recipient + internal copy). Proofs send popup uses `allowNote={false}`. Verified.
- **Artwork Proofs customer picker**: switched to searchable `SearchSelect`.
- **Artwork Proof approval system**: standalone `/artwork-proofs` page; upload PDF/JPG/PNG (≤25MB) via Emergent object storage; email to contact; public `/proof/:token` page with Approve / Request changes (notes); versioned revisions; shop notified at sales@dbgsigns.com. Tested (iteration_16).
- **Estimate customer approval**: estimate emails have an Approve button → `/approve/:token`; shop notified; "CUSTOMER OK" badge on list.
- **Label changes**: work status "ready" → "Pickup / Shipping"; document "due date" → "Est. Complete date".
- **Idle auto-logout**: 90-min default (admin-configurable in Settings → Security) with 1-min countdown warning dialog.
- **Installer work orders**: installers view/create/edit own work orders, cannot delete.
