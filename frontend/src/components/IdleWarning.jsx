import { useAuth } from "@/context/AuthContext";
import { Btn } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Clock } from "@phosphor-icons/react";

export function IdleWarning() {
  const { idleWarnOpen, idleSecondsLeft, stayActive, logout } = useAuth();
  return (
    <Dialog open={!!idleWarnOpen} onOpenChange={() => {}}>
      <DialogContent className="rounded-none max-w-sm" data-testid="idle-warning-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Clock size={20} weight="bold" /> Still there?</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            You'll be signed out in <span data-testid="idle-countdown" className="text-foreground font-bold">{idleSecondsLeft}s</span> due to inactivity.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Btn variant="outline" onClick={logout} data-testid="idle-signout-btn">Sign out</Btn>
          <Btn onClick={stayActive} data-testid="idle-stay-btn">Stay signed in</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
