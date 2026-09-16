import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { CheckCircle, LockSimple, PencilSimple, FileArrowDown } from "@phosphor-icons/react";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export default function PublicProof() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // null | "changes"
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(null); // "approved" | "changes"

  const fileUrl = `${BACKEND}/api/pub/proof/${token}/file`;

  useEffect(() => {
    api.get(`/pub/proof/${token}`).then((r) => setInfo(r.data)).catch((e) => setErr(e.response?.data?.detail || "This proof link is invalid."));
  }, [token]);

  const approve = async () => {
    setBusy(true);
    try { await api.post(`/pub/proof/${token}/approve`, {}); setDone("approved"); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not approve. Please try again."); }
    setBusy(false);
  };
  const submitChanges = async () => {
    if (!notes.trim()) { toast.error("Please describe the changes you'd like."); return; }
    setBusy(true);
    try { await api.post(`/pub/proof/${token}/changes`, { notes }); setDone("changes"); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not submit. Please try again."); }
    setBusy(false);
  };

  const isImg = String(info?.content_type || "").startsWith("image/");
  const alreadyDecided = info && (info.decision === "approved" || info.decision === "changes");
  const finalState = done || (alreadyDecided ? (info.decision === "changes" ? "changes" : "approved") : null);

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-card border border-border" data-testid="public-proof-page">
        <div className="bg-[#0A0A0A] px-6 py-5 flex items-center justify-between">
          <div className="text-white font-display text-xl tracking-wide">DBG Signs, Inc.</div>
          <LockSimple size={20} weight="bold" className="text-[#06B6D4]" />
        </div>
        <div className="h-[3px] bg-[#06B6D4]" />
        <div className="p-6 space-y-5">
          {err && <div className="text-sm text-destructive py-6 text-center" data-testid="public-proof-error">{err}</div>}
          {!err && !info && <div className="py-10 text-center text-muted-foreground text-sm">Loading…</div>}

          {!err && info && (
            <>
              <div>
                <div className="overline text-muted-foreground">Artwork Proof {info.number} · v{info.version}</div>
                <div className="text-lg font-semibold mt-1">{info.title}</div>
                <div className="text-sm text-muted-foreground">{info.customer_name}</div>
                {info.notes && <p className="text-sm text-muted-foreground mt-2">{info.notes}</p>}
              </div>

              {/* Artwork preview */}
              <div className="border border-border bg-secondary/30 flex items-center justify-center overflow-hidden" data-testid="public-proof-preview">
                {isImg ? (
                  <img src={fileUrl} alt="Artwork proof" className="max-h-[440px] w-auto object-contain" />
                ) : (
                  <iframe src={fileUrl} title="Artwork proof" className="w-full h-[440px] bg-white" />
                )}
              </div>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" data-testid="public-proof-download" className="inline-flex items-center gap-1 text-sm text-[#0E7490] hover:underline"><FileArrowDown size={16} /> Open / download the file</a>

              {finalState === "approved" ? (
                <div className="text-center py-6 space-y-2" data-testid="public-proof-approved">
                  <CheckCircle size={44} weight="fill" className="text-[#16A34A] mx-auto" />
                  <div className="font-semibold text-lg">Artwork approved</div>
                  <div className="text-sm text-muted-foreground">Thank you! We&rsquo;ve notified DBG Signs and we&rsquo;ll move into production.</div>
                </div>
              ) : finalState === "changes" ? (
                <div className="text-center py-6 space-y-2" data-testid="public-proof-changes-done">
                  <PencilSimple size={40} weight="fill" className="text-[#B45309] mx-auto" />
                  <div className="font-semibold text-lg">Changes requested</div>
                  <div className="text-sm text-muted-foreground">Thanks! We&rsquo;ve sent your notes to DBG Signs and will send an updated proof.</div>
                </div>
              ) : (
                <>
                  {mode !== "changes" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Btn onClick={approve} disabled={busy} data-testid="public-proof-approve" className="justify-center bg-[#16A34A] hover:bg-[#15803D] text-white">
                        <CheckCircle size={16} weight="bold" /> {busy ? "…" : "Approve artwork"}
                      </Btn>
                      <Btn variant="outline" onClick={() => setMode("changes")} data-testid="public-proof-request-changes" className="justify-center">
                        <PencilSimple size={16} weight="bold" /> Request changes
                      </Btn>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="block">
                        <span className="overline text-muted-foreground">What would you like changed?</span>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} data-testid="public-proof-notes" autoFocus
                          className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Describe the changes you'd like…" />
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <Btn variant="outline" onClick={() => { setMode(null); setNotes(""); }} disabled={busy} className="justify-center">Back</Btn>
                        <Btn onClick={submitChanges} disabled={busy} data-testid="public-proof-submit-changes" className="justify-center">
                          {busy ? "Sending…" : "Send change request"}
                        </Btn>
                      </div>
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground text-center">You can also reply directly to the email. Questions? sales@dbgsigns.com</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
