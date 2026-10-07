import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EnvelopeSimple } from "@phosphor-icons/react";

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || "").trim());

export default function SendDialog({ open, doc, path, kindLabel = "document", allowNote = true, onClose, onSent }) {
  const [options, setOptions] = useState([]); // {email, label}
  const [checked, setChecked] = useState({}); // email -> bool
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    setExtra("");
    setNote("");
    const opts = [];
    const seen = new Set();
    const addOpt = (email, label) => {
      const e = (email || "").trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      opts.push({ email: e, label });
    };
    if (doc.customer_email) addOpt(doc.customer_email, `${doc.customer_name || "Customer"} — company email`);
    api.get(`/customers/${doc.customer_id}/contacts`)
      .then((r) => {
        (r.data || []).forEach((c) => { if (c.email) addOpt(c.email, `${c.name}${c.title ? ` (${c.title})` : ""}`); });
      })
      .catch(() => {})
      .finally(() => {
        setOptions(opts);
        // preselect the doc's current contact email, else the company email
        const pre = {};
        const preferred = doc.contact_email || doc.customer_email;
        if (preferred && opts.some((o) => o.email.toLowerCase() === preferred.toLowerCase())) pre[preferred] = true;
        else if (opts[0]) pre[opts[0].email] = true;
        setChecked(pre);
      });
  }, [open, doc]);

  const selected = () => {
    const list = options.filter((o) => checked[o.email]).map((o) => o.email);
    if (extra.trim() && isEmail(extra)) list.push(extra.trim());
    return list;
  };

  const submit = async () => {
    const recipients = selected();
    if (recipients.length === 0) { toast.error("Select at least one recipient"); return; }
    if (extra.trim() && !isEmail(extra)) { toast.error("The added email is not valid"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`${path}/${doc.id}/send`, { recipients, ...(allowNote && note.trim() ? { note: note.trim() } : {}) });
      if (data.failed && data.failed.length) {
        toast.warning(`Emailed to ${data.to}. Could not send to: ${data.failed.join(", ")}`);
      } else {
        toast.success(`Emailed to ${data.to}`);
      }
      onSent && onSent();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Email failed");
    } finally { setBusy(false); }
  };

  const count = selected().length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="send-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Email {kindLabel} {doc?.number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">Select who should receive this {kindLabel}. You can choose more than one.</DialogDescription>
        </DialogHeader>

        {kindLabel === "invoice" && (
          <div
            className="border-l-4 border-[#0E7490] bg-[#06B6D4]/10 px-3 py-2 text-sm"
            data-testid="invoice-pdf-link-notice"
          >
            The customer email includes a secure <strong>Download Invoice PDF</strong> button.
          </div>
        )}

        <div className="space-y-1 max-h-72 overflow-y-auto border border-border p-1" data-testid="send-recipients">
          {options.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">No contacts with an email on file. Add one below.</div>}
          {options.map((o) => (
            <label key={o.email} className="flex items-start gap-3 px-3 py-2 hover:bg-secondary/50 cursor-pointer">
              <input type="checkbox" checked={!!checked[o.email]} onChange={() => setChecked((c) => ({ ...c, [o.email]: !c[o.email] }))}
                data-testid={`send-recipient-${o.email}`} className="h-4 w-4 mt-0.5 accent-[#0A0A0A]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{o.label}</span>
                <span className="block text-xs text-muted-foreground truncate">{o.email}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="block">
          <span className="overline text-muted-foreground">Add another email</span>
          <input type="email" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="name@company.com" data-testid="send-extra-email"
            className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>

        {allowNote && (
          <label className="block">
            <span className="overline text-muted-foreground">Note to customer (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} data-testid="send-note"
              placeholder={`Add a short message to include in the ${kindLabel} email…`}
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
        )}

        <DialogFooter>
          <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={submit} disabled={busy || count === 0} data-testid="send-confirm-btn">
            <EnvelopeSimple size={16} weight="bold" /> {busy ? "Sending…" : `Send${count ? ` (${count})` : ""}`}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
