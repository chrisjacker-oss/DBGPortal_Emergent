import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const METHODS = ["Check", "ACH", "Wire", "Cash", "Card", "Other"];
const needsRef = (m) => ["Check", "ACH", "Wire"].includes(m);
const today = () => new Date().toISOString().slice(0, 10);

export default function RecordPaymentDialog({ open, invoice, onClose, onSaved }) {
  const total = Number(invoice?.total || 0);
  const balance = Math.round((total - Number(invoice?.amount_paid || 0)) * 100) / 100;
  const [method, setMethod] = useState("Check");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setMethod("Check"); setReference(""); setAmount(String(balance.toFixed(2))); setDate(today()); setNotes(""); setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  const save = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0 || amt > balance + 0.005) { toast.error(`Amount must be between $0 and ${currency(balance)}`); return; }
    if (needsRef(method) && !reference.trim()) { toast.error(`Enter the ${method} number / reference`); return; }
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice.id}/manual-payment`, {
        amount: amt, method, reference: reference.trim() || null, date: new Date(date).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success("Payment recorded"); onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to record payment"); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="record-payment-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Record Payment · {invoice?.number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">Balance due {currency(balance)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className="overline text-muted-foreground">Payment method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="rp-method" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {needsRef(method) && (
            <Inp label={method === "Check" ? "Check number" : `${method} reference / trace #`} value={reference} onChange={(e) => setReference(e.target.value)} testid="rp-reference" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Amount (USD)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} testid="rp-amount" />
            <Inp label="Date received" type="date" value={date} onChange={(e) => setDate(e.target.value)} testid="rp-date" />
          </div>
          <label className="block">
            <span className="overline text-muted-foreground">Notes (optional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="rp-notes" rows={2}
              placeholder="e.g. partial payment, deposit, paid at counter…"
              className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
          </label>
        </div>
        <DialogFooter>
          <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={save} disabled={busy} data-testid="rp-save-btn">{busy ? "Saving…" : "Record payment"}</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
