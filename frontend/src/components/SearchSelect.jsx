import { useState, useRef, useEffect } from "react";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";

// Searchable single-select dropdown. options: [{ value, label }]
export default function SearchSelect({ value, onChange, options, placeholder = "Select…", testid, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => String(o.label).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="relative mt-1" ref={ref}>
      <button type="button" disabled={disabled} data-testid={testid} onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 text-left">
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>{selected ? selected.label : placeholder}</span>
        <CaretDown size={14} className="opacity-60 shrink-0 ml-2" />
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full border border-border bg-popover shadow-md max-h-64 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <MagnifyingGlass size={14} className="opacity-60 shrink-0" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              data-testid={testid ? `${testid}-search` : undefined}
              className="w-full bg-transparent text-sm focus:outline-none" />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">No matches</div>}
            {filtered.map((o) => (
              <button key={o.value} type="button"
                data-testid={testid ? `${testid}-opt-${o.value}` : undefined}
                onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors ${o.value === value ? "bg-secondary font-medium" : ""}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
