import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const empty = { name: "", category: "", unit: "roll", buying_cost: 0, conversion_factor: 1, markup: 40, stock: "", supplier: "" };

export default function Materials() {
  const [rows, setRows] = useState([]);
  const [defaultMarkup, setDefaultMarkup] = useState(40);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const load = () => api.get("/materials").then((r) => setRows(r.data));
  useEffect(() => {
    load();
    api.get("/settings").then((r) => setDefaultMarkup(r.data.default_markup)).catch(() => {});
  }, []);

  const openNew = () => { setForm({ ...empty, markup: defaultMarkup }); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r, stock: r.stock ?? "", category: r.category ?? "", supplier: r.supplier ?? "" }); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // live preview of derived costs
  const cf = Number(form.conversion_factor || 0);
  const previewCost = cf ? Number(form.buying_cost || 0) / cf : 0;
  const previewPrice = previewCost * (1 + Number(form.markup || 0) / 100);

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
  const remove = async (id) => { if (!window.confirm("Delete material?")) return; await api.delete(`/materials/${id}`); toast.success("Deleted"); load(); };

  const marginPct = (m) => (m.price_per_sqft > 0 ? Math.round(((m.price_per_sqft - m.cost_per_sqft) / m.price_per_sqft) * 100) : 0);

  return (
    <div>
      <PageHeader overline="Inventory · Costing" title="Materials">
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
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-5 py-3">
                    <div className="font-medium">{m.name}</div>
                    <div className="overline text-[#0E7490]">{m.category || "Uncategorized"} · {m.supplier || "—"}</div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.unit}</td>
                  <td className="px-5 py-3 text-right font-mono">{currency(m.buying_cost)}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.conversion_factor}</td>
                  <td className="px-5 py-3 text-right font-mono">{currency(m.cost_per_sqft)}</td>
                  <td className="px-5 py-3 text-right font-mono">{m.markup}%</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold">{currency(m.price_per_sqft)}</td>
                  <td className="px-5 py-3 text-right font-mono text-[#16A34A]">{marginPct(m)}%</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => openEdit(m)} data-testid={`edit-material-${m.id}`}><PencilSimple size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => remove(m.id)} data-testid={`delete-material-${m.id}`}><Trash size={16} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-6 py-10 text-center text-muted-foreground">No materials yet.</td></tr>}
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
              <Inp label="Category" value={form.category} onChange={set("category")} testid="mat-category" />
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
              <Inp label="Markup %" type="number" value={form.markup} onChange={set("markup")} testid="mat-markup" />
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
    </div>
  );
}
