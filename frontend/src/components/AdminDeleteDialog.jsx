import { useState } from "react";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function AdminDeleteDialog({ open, label = "record", onClose, onConfirm }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await onConfirm(pw);
    setBusy(false);
    if (ok) setPw("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="rounded-none max-w-sm" data-testid="admin-delete-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Delete {label}</DialogTitle>
          <DialogDescription className="font-mono text-xs">This can't be undone. Enter your admin password to confirm.</DialogDescription>
        </DialogHeader>
        <Inp label="Admin password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} testid="admin-delete-password" />
        <DialogFooter>
          <Btn variant="outline" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={submit} disabled={busy || !pw} data-testid="admin-delete-confirm">{busy ? "Deleting…" : "Delete"}</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
