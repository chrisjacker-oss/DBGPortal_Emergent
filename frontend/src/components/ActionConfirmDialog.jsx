import { useState } from "react";
import { Btn } from "@/components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ActionConfirmDialog({ action, onClose }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!action?.onConfirm) return;
    setBusy(true);
    try {
      const completed = await action.onConfirm();
      if (completed !== false) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="rounded-none max-w-md" data-testid="action-confirm-dialog">
        <DialogHeader>
          <DialogTitle className="font-display" data-testid="action-confirm-title">
            {action?.title}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs" data-testid="action-confirm-description">
            {action?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Btn
            variant="outline"
            onClick={onClose}
            disabled={busy}
            data-testid="action-confirm-cancel-btn"
          >
            Cancel
          </Btn>
          <Btn
            variant={action?.danger ? "danger" : "solid"}
            onClick={submit}
            disabled={busy}
            data-testid="action-confirm-submit-btn"
          >
            {busy ? "Working…" : action?.confirmLabel || "Confirm"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}