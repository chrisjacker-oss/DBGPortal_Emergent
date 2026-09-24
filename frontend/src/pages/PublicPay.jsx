import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { CheckCircle, LockSimple } from "@phosphor-icons/react";

function CardForm({ amount, surcharge, onDone }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { toast.error(error.message || "Payment failed"); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === "succeeded") {
      try { await api.get(`/pub/pay/status/${paymentIntent.id}`); } catch (e) { console.warn("Payment status sync failed (payment already succeeded):", e); }
      onDone();
    } else {
      toast.message("Payment is processing. You'll receive a receipt once it clears.");
      onDone();
    }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {surcharge > 0 && <div className="text-xs text-muted-foreground" data-testid="pub-pay-surcharge">Includes a {currency(surcharge)} card-processing fee.</div>}
      <Btn onClick={pay} disabled={!stripe || busy} data-testid="pub-pay-submit" className="w-full justify-center">
        {busy ? "Processing…" : `Pay ${currency(amount)}`}
      </Btn>
    </div>
  );
}

export default function PublicPay() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [charge, setCharge] = useState(0);
  const [surcharge, setSurcharge] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/pub/pay/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(e.response?.data?.detail || "This payment link is invalid."));
  }, [token]);

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/pub/pay/${token}/intent`, {});
      const key = data.publishable_key || process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
      if (!key) { setErr("Card payments aren't configured yet. Please contact DBG Signs."); setBusy(false); return; }
      setStripePromise(loadStripe(key));
      setClientSecret(data.client_secret);
      setCharge(data.charged ?? data.amount);
      setSurcharge(data.surcharge || 0);
    } catch (e) {
      setErr(e.response?.data?.detail || "Unable to start payment. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border" data-testid="public-pay-page">
        <div className="bg-[#0A0A0A] px-6 py-5 flex items-center justify-between">
          <div className="text-white font-display text-xl tracking-wide">DBG Signs, Inc.</div>
          <LockSimple size={20} weight="bold" className="text-[#06B6D4]" />
        </div>
        <div className="h-[3px] bg-[#06B6D4]" />
        <div className="p-6 space-y-5">
          {err && <div className="text-sm text-destructive py-6 text-center" data-testid="public-pay-error">{err}</div>}

          {!err && !info && <div className="py-10 text-center text-muted-foreground text-sm">Loading…</div>}

          {!err && info && (
            <>
              <div>
                <div className="overline text-muted-foreground">{info.kind} {info.number}</div>
                <div className="text-lg font-semibold mt-1">{info.customer_name}</div>
              </div>

              {done || info.paid ? (
                <div className="text-center py-6 space-y-2" data-testid="public-pay-success">
                  <CheckCircle size={44} weight="fill" className="text-[#16A34A] mx-auto" />
                  <div className="font-semibold text-lg">Payment received</div>
                  <div className="text-sm text-muted-foreground">Thank you! A receipt is on its way to your email.</div>
                </div>
              ) : (
                <>
                  <div className="border border-border divide-y divide-border font-mono text-sm">
                    <div className="flex justify-between px-4 py-2"><span className="text-muted-foreground">Total</span><span>{currency(info.total)}</span></div>
                    {info.amount_paid > 0 && <div className="flex justify-between px-4 py-2"><span className="text-muted-foreground">Already paid</span><span>{currency(info.amount_paid)}</span></div>}
                    <div className="flex justify-between px-4 py-3 bg-[#0A0A0A] text-white font-semibold">
                      <span>{info.payment_label || "Balance due"}</span>
                      <span data-testid="public-pay-balance">{currency(info.requested_amount ?? info.balance)}</span>
                    </div>
                  </div>

                  {!clientSecret ? (
                    <Btn onClick={start} disabled={busy} data-testid="public-pay-start" className="w-full justify-center">
                      {busy ? "Starting secure form…" : "Pay by credit card"}
                    </Btn>
                  ) : stripePromise ? (
                    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
                      <CardForm amount={charge} surcharge={surcharge} onDone={() => setDone(true)} />
                    </Elements>
                  ) : null}

                  <div className="text-[11px] text-muted-foreground text-center">Secure payment powered by Stripe. We never store your card details.</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
