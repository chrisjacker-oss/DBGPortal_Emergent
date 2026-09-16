import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { CheckCircle, LockSimple } from "@phosphor-icons/react";

export default function PublicApprove() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/pub/approve/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(e.response?.data?.detail || "This approval link is invalid."));
  }, [token]);

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/pub/approve/${token}`, {});
      setDone(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not approve. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border" data-testid="public-approve-page">
        <div className="bg-[#0A0A0A] px-6 py-5 flex items-center justify-between">
          <div className="text-white font-display text-xl tracking-wide">DBG Signs, Inc.</div>
          <LockSimple size={20} weight="bold" className="text-[#06B6D4]" />
        </div>
        <div className="h-[3px] bg-[#16A34A]" />
        <div className="p-6 space-y-5">
          {err && <div className="text-sm text-destructive py-6 text-center" data-testid="public-approve-error">{err}</div>}

          {!err && !info && <div className="py-10 text-center text-muted-foreground text-sm">Loading…</div>}

          {!err && info && (
            <>
              <div>
                <div className="overline text-muted-foreground">Estimate {info.number}</div>
                <div className="text-lg font-semibold mt-1">{info.customer_name}</div>
                {info.title && <div className="text-sm text-muted-foreground">{info.title}</div>}
              </div>

              {done || info.approved ? (
                <div className="text-center py-6 space-y-2" data-testid="public-approve-success">
                  <CheckCircle size={44} weight="fill" className="text-[#16A34A] mx-auto" />
                  <div className="font-semibold text-lg">Estimate approved</div>
                  <div className="text-sm text-muted-foreground">Thank you! We&rsquo;ve let DBG Signs know and we&rsquo;ll get started on your order.</div>
                </div>
              ) : (
                <>
                  <div className="border border-border divide-y divide-border font-mono text-sm">
                    <div className="flex justify-between px-4 py-3 bg-[#0A0A0A] text-white font-semibold"><span>Total</span><span data-testid="public-approve-total">{currency(info.total)}</span></div>
                  </div>
                  <p className="text-sm text-muted-foreground">By approving, you confirm the details and pricing above and authorize DBG Signs to begin production.</p>
                  <Btn onClick={approve} disabled={busy} data-testid="public-approve-submit" className="w-full justify-center bg-[#16A34A] hover:bg-[#15803D] text-white">
                    {busy ? "Approving…" : "Approve this estimate"}
                  </Btn>
                  <div className="text-[11px] text-muted-foreground text-center">Questions? Email sales@dbgsigns.com</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
