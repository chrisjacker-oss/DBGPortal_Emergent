import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, PencilSimple, Trash, Tag } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const empty = { name: "", category: "Cut Vinyl", unit: "roll", buying_cost: 0, conversion_factor: 1, markup: 2, stock: "", supplier: "" };

export default function Materials() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [defaultMarkup, setDefaultMarkup] = useState(40);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [cats, setCats] = useState({ presets: [], custom: [], all: [] });
  const [catOpen, setCatOpen] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [del, setDel] = useState(null); // { url, label, after }
  const [filterCat, setFilterCat] = useState("all");

  const load = () => api.get("/materials").then((r) => setRows(r.data));
  const loadCats = () => api.get("/material-categories").then((r) => setCats(r.data)).catch(() => {});
  useEffect(() => {
    load();
    loadCats();
    api.get("/settings").then((r) => setDefaultMarkup(r.data.default_markup)).catch(() => {});
  }, []);

  const addCat = async () => {
    const name = newCat.trim();
    if (!name) return;
    try { await api.post("/material-categories", { name }); setNewCat(""); toast.success("Category added"); loadCats(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const removeCat = (c) => setDel({ url: `/material-categories/${c.id}`, label: `category "${c.name}"`, after: loadCats });
  const removePreset = (name) => setDel({ url: `/material-categories/preset/${encodeURIComponent(name)}`, label: `built-in category "${name}"`, after: () => { loadCats(); load(); } });
  const restorePreset = async (name) => {
    try { await api.post(`/material-categories/preset/${encodeURIComponent(name)}/restore`); toast.success("Category restored"); loadCats(); }
    catch (e) { toast.error(e.response?.data?.detail || "Restore failed"); }
  };
  const renameCat = async (c) => {
    const name = window.prompt("Rename category:", c.name);
    if (!name || !name.trim() || name.trim() === c.name) return;
    try { await api.put(`/material-categories/${c.id}`, { name: name.trim() }); toast.success("Category renamed"); loadCats(); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Rename failed"); }
  };

  const openNew = () => { setForm({ ...empty, markup: defaultMarkup }); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r, stock: r.stock ?? "", category: r.category ?? "", supplier: r.supplier ?? "" }); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // live preview of derived costs
  const cf = Number(form.conversion_factor || 0);
  const previewCost = cf ? Number(form.buying_cost || 0) / cf : 0;
  const previewPrice = previewCost * (Number(form.markup) > 0 ? Number(form.markup) : 1);

  const save = async () => {
    const payload = {
      name: form.name, category: form.category, unit: form.unit, supplier: form.supplier,
      buying_cost: Number(form.buying_cost), conversion_factor: Number(form.conversion_factor),
      markup: Number(form.markup), stock: form.stock === "" ? null : Number(form.stock),
    };
    try {
      if (editing) await api.put(`/materials/${editing}`, payload);
      else await api.post("/materials", payload);
      toast.success("Material saved"); setOpen(false); load();
    } catch { toast.error("Save failed"); }
  };
  const remove = (m) => setDel({ url: `/materials/${m.id}`, label: `material "${m.name}"`, after: load });
  const confirmDelete = async (password) => {
    try {
      await api.delete(del.url, { data: { password } });
      toast.success("Deleted"); const after = del.after; setDel(null); after && after(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const marginPct = (m) => (m.price_per_sqft > 0 ? Math.round(((m.price_per_sqft - m.cost_per_sqft) / m.price_per_sqft) * 100) : 0);

  const sortedRows = [...rows].sort((a, b) => {
    const name = (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
    const ca = (a.category || "Uncategorized").toLowerCase();
    const cb = (b.category || "Uncategorized").toLowerCase();
    return ca === cb ? name : ca.localeCompare(cb);
  });
  const visibleRows = filterCat === "all"
    ? sortedRows
    : sortedRows.filter((m) => (m.category || "Uncategorized") === filterCat);

  return (
    <div>
      <PageHeader overline="Inventory · Costing" title="Materials">
        <label className="flex items-center gap-2 text-sm">
          <span className="overline text-muted-foreground">Category</span>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} data-testid="materials-filter-category"
            className="border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All categories</option>
            {cats.all.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {isAdmin && <Btn variant="outline" onClick={() => setCatOpen(true)} data-testid="manage-categories-btn"><Tag size={16} weight="bold" /> Categories</Btn>}
        <Btn onClick={openNew} data-testid="add-material-btn"><Plus size={16} weight="bold" /> Add Material</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-5 py-3 font-mono">Material</th>
                <th className="px-5 py-3 font-mono">Unit</th>
                <th className="px-5 py-3 font-mono text-right">Buying Cost</th>
                <th className="px-5 py-3 font-mono text-right">Conv. (sqft/unit)</th>
                <th className="px-5 py-3 font-mono text-right">Cost/sqft</th>
                <th className="px-5 py-3 font-mono text-right">Markup</th>
                <th className="px-5 py-3 font-mono text-right">Price/sqft</th>
                <th className="px-5 py-3 font-mono text-right">Margin</th>
                <th className="px-5 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="materials-table">
              {visibleRows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-5 py-3">
                    <div className="font-medium">{m.name}</div>
                    <div className="overline text-[#0E7490]">{m.category || "Uncategorized"} · {m.supplier || "—"}</div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.unit}</td>
                  <td className="px-5 py-3 text-right font-mono">{currency(m.buying_cost)}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.conversion_factor}</td>
                  <td className="px-5 py-3 text-right font-mono">{currency(m.cost_per_sqft)}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.markup}×</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold">{currency(m.price_per_sqft)}</td>
                  <td className="px-5 py-3 text-right font-mono text-[#16A34A]">{marginPct(m)}%</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => openEdit(m)} data-testid={`edit-material-${m.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => remove(m)} data-testid={`delete-material-${m.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && <tr><td colSpan={9} className="px-6 py-10 text-center text-muted-foreground">{rows.length === 0 ? "No materials yet." : "No materials in this category."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit" : "New"} Material</DialogTitle>
            <DialogDescription className="font-mono text-xs">Cost/sqft = Buying cost ÷ Conversion factor. Price/sqft = Cost/sqft × (1 + Markup%)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Inp label="Name" value={form.name} onChange={set("name")} testid="mat-name" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Category</span>
                <select value={form.category} onChange={set("category")} data-testid="mat-category" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {cats.all.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="overline text-muted-foreground">Purchase unit</span>
                <select value={form.unit} onChange={set("unit")} data-testid="mat-unit" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {["roll", "sheet", "each", "gallon", "linear ft"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Inp label="Buying cost / unit" type="number" value={form.buying_cost} onChange={set("buying_cost")} testid="mat-buying-cost" />
              <Inp label="Conv. (sqft/unit)" type="number" value={form.conversion_factor} onChange={set("conversion_factor")} testid="mat-conversion" />
              <Inp label="Markup (× multiplier)" type="number" value={form.markup} onChange={set("markup")} testid="mat-markup" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Supplier" value={form.supplier} onChange={set("supplier")} testid="mat-supplier" />
              <Inp label="Stock (units)" type="number" value={form.stock} onChange={set("stock")} testid="mat-stock" />
            </div>
            <div className="border border-border bg-secondary/40 p-3 flex justify-between text-sm" data-testid="mat-preview">
              <span className="font-mono">Cost/sqft <b>{currency(previewCost)}</b></span>
              <span className="font-mono">Price/sqft <b>{currency(previewPrice)}</b></span>
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-material-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="rounded-none max-w-md" data-testid="categories-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Material Categories</DialogTitle>
            <DialogDescription className="font-mono text-xs">Built-in categories plus your own custom ones.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="overline text-muted-foreground mb-2">Built-in</div>
              <div className="space-y-1" data-testid="preset-categories-list">
                {cats.presets.map((c) => (
                  <div key={c} className="flex items-center justify-between border border-border px-3 py-2">
                    <span className="text-sm font-medium font-mono">{c}</span>
                    <Btn variant="ghost" onClick={() => removePreset(c)} data-testid={`delete-preset-${c}`} title="Remove this category"><Trash size={16} /></Btn>
                  </div>
                ))}
              </div>
            </div>
            {cats.hidden && cats.hidden.length > 0 && (
              <div>
                <div className="overline text-muted-foreground mb-2">Removed (built-in)</div>
                <div className="space-y-1" data-testid="hidden-categories-list">
                  {cats.hidden.map((c) => (
                    <div key={c} className="flex items-center justify-between border border-dashed border-border px-3 py-2">
                      <span className="text-sm text-muted-foreground line-through font-mono">{c}</span>
                      <Btn variant="outline" onClick={() => restorePreset(c)} data-testid={`restore-preset-${c}`}>Restore</Btn>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="overline text-muted-foreground mb-2">Custom</div>
              {cats.custom.length === 0 && <div className="text-sm text-muted-foreground">No custom categories yet.</div>}
              <div className="space-y-1" data-testid="custom-categories-list">
                {cats.custom.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border border-border px-3 py-2">
                    <span className="text-sm font-medium">{c.name}</span>
                    <div className="flex items-center gap-1">
                      <Btn variant="ghost" onClick={() => renameCat(c)} data-testid={`edit-category-${c.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => removeCat(c)} data-testid={`delete-category-${c.id}`}><Trash size={16} /></Btn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-2 border-t border-border pt-4">
              <div className="flex-1"><Inp label="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} testid="new-category-input" /></div>
              <Btn onClick={addCat} data-testid="add-category-btn"><Plus size={16} weight="bold" /> Add</Btn>
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setCatOpen(false)}>Done</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!del} label={del?.label || "record"} onClose={() => setDel(null)} onConfirm={confirmDelete} />
    </div>
  );
}
