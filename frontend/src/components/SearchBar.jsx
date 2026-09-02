import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { MagnifyingGlass } from "@phosphor-icons/react";

const typeColor = {
  Estimate: "text-[#0E7490]",
  "Sales Order": "text-[#A21CAF]",
  Invoice: "text-[#B45309]",
  Customer: "text-foreground",
  Material: "text-[#16A34A]",
};

export const SearchBar = () => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q)}`).then((r) => { setResults(r.data.results); setOpen(true); }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (r) => { setOpen(false); setQ(""); navigate(r.route, { state: { highlight: r.id } }); };

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center gap-2 border border-input bg-secondary/60 px-3 py-2">
        <MagnifyingGlass size={16} className="text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          data-testid="global-search-input"
          placeholder="Search estimates, SOs, invoices, customers, materials…"
          className="bg-transparent text-sm w-full focus:outline-none"
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-96 overflow-y-auto bg-card border border-border shadow-lg" data-testid="search-results">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No matches</div>
          ) : (
            results.map((r) => (
              <button key={`${r.type}-${r.id}`} onClick={() => go(r)} data-testid={`search-result-${r.id}`}
                className="w-full text-left px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary transition-colors duration-150 flex items-center gap-3">
                <span className={`overline w-24 shrink-0 ${typeColor[r.type] || ""}`}>{r.type}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium block truncate">{r.label}</span>
                  <span className="text-xs text-muted-foreground block truncate">{r.subtitle}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
