import { useState } from "react";
import api from "@/lib/api";
import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const submitSearch = async (event) => {
    event.preventDefault();
    const term = q.trim();
    if (!term) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const response = await api.get(`/search?q=${encodeURIComponent(term)}`);
      setResults(response.data.results);
      setOpen(true);
    } catch {
      setResults([]);
      setSearchError("Search is unavailable right now. Please try again.");
      setOpen(true);
    } finally {
      setSearching(false);
    }
  };

  const openResult = (result) => {
    const query = new URLSearchParams({ focus: result.id });
    const destination = `${result.route}?${query.toString()}`;
    const opened = window.open(destination, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(destination);
    setOpen(false);
    setQ("");
  };

  return (
    <div>
      <form onSubmit={submitSearch} className="flex gap-2" data-testid="global-search-form">
        <div className="flex min-w-0 flex-1 items-center gap-2 border border-input bg-secondary/60 px-3 py-2">
          <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            data-testid="global-search-input"
            placeholder="Search records…"
            className="min-w-0 w-full bg-transparent text-sm focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !q.trim()}
          data-testid="global-search-submit"
          className={[
            "border border-foreground bg-foreground px-3 py-2 text-xs font-bold uppercase",
            "tracking-[0.08em] text-primary-foreground transition-colors duration-150",
            "hover:bg-transparent hover:text-foreground disabled:cursor-not-allowed",
            "disabled:opacity-50",
          ].join(" ")}
        >
          {searching ? "Searching" : "Search"}
        </button>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-none p-0" data-testid="search-results-dialog">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle className="font-display text-2xl">Search results</DialogTitle>
            <DialogDescription>
              Select a result to open it in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto" data-testid="search-results">
            {searchError ? (
              <div className="px-6 py-8 text-sm text-destructive">{searchError}</div>
            ) : results.length === 0 ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">
                No matches for “{q}”.
              </div>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => openResult(result)}
                  data-testid={`search-result-${result.id}`}
                  className={[
                    "flex w-full items-center gap-4 border-b border-border px-6 py-4 text-left",
                    "last:border-0 hover:bg-secondary transition-colors duration-150",
                  ].join(" ")}
                >
                  <span className={`overline w-24 shrink-0 ${typeColor[result.type] || ""}`}>
                    {result.type}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{result.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  </span>
                  <ArrowSquareOut size={18} className="shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
