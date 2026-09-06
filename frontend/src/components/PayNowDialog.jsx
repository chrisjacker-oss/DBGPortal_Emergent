import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

function CardForm({ amount, surcharge, onPaid, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { toast.error(error.message || "Payment failed"); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      try { await api.get(`/payments/status/${paymentIntent.id}`); } catch (e) { console.warn("Payment status sync failed (payment already succeeded):", e); }
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
      {surcharge > 0 && (
        <div className="text-xs text-muted-foreground" data-testid="pay-surcharge-note">Includes a {currency(surcharge)} card-processing fee.</div>
      )}
      <DialogFooter>
        <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn onClick={pay} disabled={!stripe || busy} data-testid="pay-submit-btn">
          {busy ? "Processing…" : `Pay ${currency(amount)}`}
        </Btn>
      </DialogFooter>
    </div>
  );
}

export default function PayNowDialog({ open, invoice, payAll, onClose, onPaid }) {
  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState("");
  const [chargeAmount, setChargeAmount] = useState(0);
  const [surcharge, setSurcharge] = useState(0);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const total = Number(invoice?.total || 0);
  const paidToDate = Number(invoice?.amount_paid || 0);
  const balance = Math.round((total - paidToDate) * 100) / 100;

  const beginCard = (data) => {
    const key = data.publishable_key || process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
    if (!key) { setError("Card payments aren't configured yet. Please contact DBG Signs."); return false; }
    setStripePromise(loadStripe(key));
    setClientSecret(data.client_secret);
    setChargeAmount(data.charged ?? data.amount);
    setSurcharge(data.surcharge || 0);
    setStep("card");
    return true;
  };

  const startAll = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/payments/create-intent-all");
      beginCard(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Unable to start payment. Please try again.");
    }
    setBusy(false);
  };

  useEffect(() => {
    if (open) {
      setClientSecret(null); setStripePromise(null); setError(null); setBusy(false);
      if (payAll) {
        setStep("loading");
        startAll();
      } else {
        setStep("amount");
        setAmount(String(balance.toFixed(2)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice, payAll]);

  const startPayment = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter an amount greater than zero"); return; }
    if (amt > balance + 0.005) { toast.error(`Amount can't exceed the balance of ${currency(balance)}`); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/payments/create-intent", { invoice_id: invoice.id, amount: amt });
      beginCard(data);
    } catch (e) {
      setError(e.response?.data?.detail || "Unable to start payment. Please try again.");
    }
    setBusy(false);
  };

  const titleText = payAll ? "Pay all outstanding" : `Pay Invoice ${invoice?.number || ""}`;
  const descText = payAll
    ? `${payAll.count || ""} invoice${payAll.count === 1 ? "" : "s"} · ${currency(payAll.total)}`
    : `Balance due ${currency(balance)}${paidToDate > 0 ? ` · ${currency(paidToDate)} already paid` : ""}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="pay-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{titleText}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{descText}</DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-destructive py-4" data-testid="pay-error">{error}</div>}

        {!error && step === "loading" && <div className="py-8 text-center text-muted-foreground text-sm">Loading secure form…</div>}

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
            <CardForm amount={chargeAmount} surcharge={surcharge} onPaid={onPaid} onClose={onClose} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
