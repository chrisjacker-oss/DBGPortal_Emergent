import { useEffect, useMemo, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, EnvelopeSimple } from "@phosphor-icons/react";

export default function PaymentRequestDialog({ open, doc, path, kindLabel, onClose, onSent }) {
  const [options, setOptions] = useState([]);
  const [checked, setChecked] = useState({});
  const [paymentType, setPaymentType] = useState("deposit");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !doc) return;
    setPaymentType("deposit");
    const contactOptions = [];
    const seen = new Set();
    const addOption = (email, label) => {
      const value = (email || "").trim();
      if (!value || seen.has(value.toLowerCase())) return;
      seen.add(value.toLowerCase());
      contactOptions.push({ email: value, label });
    };
    addOption(doc.customer_email, `${doc.customer_name || "Customer"} — company email`);
    api.get(`/customers/${doc.customer_id}/contacts`)
      .then(({ data }) => {
        (data || []).forEach((contact) => {
          if (!contact.email) return;
          addOption(contact.email, `${contact.name}${contact.title ? ` (${contact.title})` : ""}`);
        });
      })
      .catch(() => {})
      .finally(() => {
        setOptions(contactOptions);
        const preferred = doc.contact_email || doc.customer_email;
        const initial = {};
        if (preferred && contactOptions.some((option) => option.email === preferred)) {
          initial[preferred] = true;
        } else if (contactOptions[0]) {
          initial[contactOptions[0].email] = true;
        }
        setChecked(initial);
      });
  }, [open, doc]);

  const recipients = useMemo(
    () => options.filter((option) => checked[option.email]).map((option) => option.email),
    [checked, options]
  );
  const total = Number(doc?.total || 0);
  const paid = Number(doc?.amount_paid || 0);
  const balance = Math.max(0, total - paid);
  const requestedAmount = paymentType === "deposit"
    ? Math.max(0, Math.min(balance, Math.round((total * 0.5 - paid) * 100) / 100))
    : balance;
  const requestLabel = paymentType === "deposit" ? "50% deposit" : "COD payment in full";

  const submit = async () => {
    if (recipients.length === 0) {
      toast.error("Select at least one contact");
      return;
    }
    if (requestedAmount <= 0) {
      toast.error("This document has no payment amount due");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`${path}/${doc.id}/payment-request`, {
        recipients,
        payment_type: paymentType,
      });
      if (data.failed?.length) {
        toast.warning(`Payment link sent to ${data.to}; failed: ${data.failed.join(", ")}`);
      } else {
        toast.success(`Payment link for ${currency(data.amount)} sent to ${data.to}`);
      }
      onSent?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Payment link email failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="payment-request-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Send payment link · {doc?.number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Choose the payment plan and which customer contacts receive the secure card-payment link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3" data-testid="payment-request-type-options">
            <button
              type="button"
              onClick={() => setPaymentType("deposit")}
              data-testid="payment-request-50-50"
              className={`border p-4 text-left transition-colors ${
                paymentType === "deposit"
                  ? "border-[#0E7490] bg-[#06B6D4]/10"
                  : "border-border hover:bg-secondary/50"
              }`}
            >
              <div className="font-semibold">50 / 50</div>
              <div className="mt-1 text-xs text-muted-foreground">Request a 50% deposit</div>
            </button>
            <button
              type="button"
              onClick={() => setPaymentType("cod")}
              data-testid="payment-request-cod"
              className={`border p-4 text-left transition-colors ${
                paymentType === "cod"
                  ? "border-[#0E7490] bg-[#06B6D4]/10"
                  : "border-border hover:bg-secondary/50"
              }`}
            >
              <div className="font-semibold">COD</div>
              <div className="mt-1 text-xs text-muted-foreground">Request the full balance</div>
            </button>
          </div>

          <div className="border-l-2 border-[#06B6D4] bg-secondary/30 px-4 py-3" data-testid="payment-request-summary">
            <div className="overline text-muted-foreground">{requestLabel}</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{currency(requestedAmount)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {currency(paid)} paid of {currency(total)} · {currency(balance)} balance
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto border border-border p-1" data-testid="payment-request-recipients">
            {options.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No customer contacts with an email are available.
              </div>
            )}
            {options.map((option) => (
              <label key={option.email} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-secondary/50">
                <input
                  type="checkbox"
                  checked={!!checked[option.email]}
                  onChange={() => setChecked((current) => ({
                    ...current,
                    [option.email]: !current[option.email],
                  }))}
                  data-testid={`payment-request-recipient-${option.email}`}
                  className="mt-0.5 h-4 w-4 accent-[#0A0A0A]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{option.email}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Btn variant="outline" onClick={onClose} disabled={busy} data-testid="cancel-payment-request-btn">
            Cancel
          </Btn>
          <Btn
            onClick={submit}
            disabled={busy || recipients.length === 0 || requestedAmount <= 0}
            data-testid="send-payment-request-btn"
          >
            {busy ? <CreditCard size={16} weight="bold" /> : <EnvelopeSimple size={16} weight="bold" />}
            {busy ? "Sending…" : `Send ${currency(requestedAmount)} link`}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}