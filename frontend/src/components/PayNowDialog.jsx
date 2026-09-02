import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

function CardForm({ invoice, onPaid, onClose }) {
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
      toast.success("Payment successful — thank you!");
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
          {busy ? "Processing…" : `Pay ${currency(invoice?.total)}`}
        </Btn>
      </DialogFooter>
    </div>
  );
}

export default function PayNowDialog({ open, invoice, onClose, onPaid }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && invoice) {
      setClientSecret(null);
      setStripePromise(null);
      setError(null);
      api.post("/payments/create-intent", { invoice_id: invoice.id })
        .then((r) => {
          const key = r.data.publishable_key || process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
          if (!key) { setError("Card payments aren't configured yet. Please contact DBG Signs."); return; }
          setStripePromise(loadStripe(key));
          setClientSecret(r.data.client_secret);
        })
        .catch((e) => setError(e.response?.data?.detail || "Unable to start payment. Please try again."));
    }
  }, [open, invoice]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="pay-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Pay Invoice {invoice?.number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Secure card payment · {currency(invoice?.total)}
          </DialogDescription>
        </DialogHeader>
        {error && <div className="text-sm text-destructive py-4" data-testid="pay-error">{error}</div>}
        {!error && !(clientSecret && stripePromise) && <div className="py-8 text-center text-muted-foreground text-sm">Loading secure form…</div>}
        {!error && clientSecret && stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
            <CardForm invoice={invoice} onPaid={onPaid} onClose={onClose} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
