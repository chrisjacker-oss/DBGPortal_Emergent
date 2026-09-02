import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

function CardForm({ amount, onPaid, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { toast.error(error.message || "Payment failed"); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      try { await api.get(`/payments/status/${paymentIntent.id}`); } catch { /* status poll best-effort */ }
      toast.success("Payment successful — a receipt is on its way!");
      onPaid();
    } else {
      toast.message("Payment is processing. We'll update the invoice once it clears.");
      onClose();
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <DialogFooter>
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn onClick={pay} disabled={!stripe || busy} data-testid="pay-submit-btn">
          {busy ? "Processing…" : `Pay ${currency(amount)}`}
        </Btn>
      </DialogFooter>
    </div>
  );
}

export default function PayNowDialog({ open, invoice, onClose, onPaid }) {
  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState("");
  const [clientSecret, setClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const total = Number(invoice?.total || 0);
  const paidToDate = Number(invoice?.amount_paid || 0);
  const balance = Math.round((total - paidToDate) * 100) / 100;

  useEffect(() => {
    if (open && invoice) {
      setStep("amount");
      setAmount(String(balance.toFixed(2)));
      setClientSecret(null);
      setStripePromise(null);
      setError(null);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  const startPayment = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount greater than zero"); return; }
    if (amt > balance + 0.005) { toast.error(`Amount can't exceed the balance of ${currency(balance)}`); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/payments/create-intent", { invoice_id: invoice.id, amount: amt });
      const key = data.publishable_key || process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
      if (!key) { setError("Card payments aren't configured yet. Please contact DBG Signs."); setBusy(false); return; }
      setStripePromise(loadStripe(key));
      setClientSecret(data.client_secret);
      setStep("card");
    } catch (e) {
      setError(e.response?.data?.detail || "Unable to start payment. Please try again.");
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="pay-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Pay Invoice {invoice?.number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Balance due {currency(balance)}{paidToDate > 0 ? ` · ${currency(paidToDate)} already paid` : ""}
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-destructive py-4" data-testid="pay-error">{error}</div>}

        {!error && step === "amount" && (
          <div className="space-y-4">
            <Inp label="Amount to pay now (USD)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} testid="pay-amount" />
            <div className="flex gap-2">
              <Btn variant="outline" onClick={() => setAmount(String(balance.toFixed(2)))} data-testid="pay-full-btn">Pay full balance</Btn>
            </div>
            <DialogFooter>
              <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
              <Btn onClick={startPayment} disabled={busy} data-testid="pay-continue-btn">{busy ? "Starting…" : "Continue to card"}</Btn>
            </DialogFooter>
          </div>
        )}

        {!error && step === "card" && clientSecret && stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
            <CardForm amount={Number(amount)} onPaid={onPaid} onClose={onClose} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
