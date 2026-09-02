import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { LockKey } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// Admin-only private note editor. Parent passes the PATCH url + current value.
export default function InternalNoteDialog({ open, number, url, value, onClose, onSaved }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setDraft(value || ""); }, [open, value]);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch(url, { notes: draft });
      toast.success("Internal note saved");
      onSaved && onSaved(data);
      onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="internal-note-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><LockKey size={16} weight="bold" /> Internal note · {number}</DialogTitle>
          <DialogDescription className="font-mono text-xs">Admin only — never shown to the customer, on PDFs, or in emails.</DialogDescription>
        </DialogHeader>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="internal-note-textarea" rows={4}
          placeholder="Private notes for staff — e.g. discount reason, follow-up, special instructions…"
          className="w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        <DialogFooter>
          <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={save} disabled={busy} data-testid="internal-note-save-btn">{busy ? "Saving…" : "Save note"}</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
