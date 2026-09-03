import { DotsThreeVertical } from "@phosphor-icons/react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

// items: array of { label, icon, onClick, danger, hidden, separator, testid }
export default function ActionsMenu({ items, testid }) {
  const visible = (items || []).filter((it) => it && !it.hidden);
  if (visible.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-testid={testid} title="Actions"
          className="inline-flex items-center justify-center h-8 w-8 rounded-none border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
          <DotsThreeVertical size={18} weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-none w-52">
        {visible.map((it, i) =>
          it.separator ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={i} data-testid={it.testid}
              onSelect={() => setTimeout(() => it.onClick?.(), 0)}
              className={`rounded-none cursor-pointer gap-2 ${it.danger ? "text-destructive focus:text-destructive" : ""}`}>
              {it.icon}<span>{it.label}</span>
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
