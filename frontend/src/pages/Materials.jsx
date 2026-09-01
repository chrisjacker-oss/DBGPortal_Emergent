import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const empty = { name: "", category: "", unit: "sqft", cost: 0, price: 0, stock: "", supplier: "", image_url: "" };

export default function Materials() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);

  const load = () => api.get("/materials").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(empty); setEditing(null); setOpen(true); };
  const openEdit = (r) => { setForm({ ...empty, ...r, stock: r.stock ?? "", category: r.category ?? "", supplier: r.supplier ?? "" }); setEditing(r.id); setOpen(true); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const payload = { ...form, cost: Number(form.cost), price: Number(form.price), stock: form.stock === "" ? null : Number(form.stock) };
    try {
      if (editing) await api.put(`/materials/${editing}`, payload);
      else await api.post("/materials", payload);
      toast.success("Material saved");
      setOpen(false);
      load();
    } catch { toast.error("Save failed"); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete material?")) return;
    await api.delete(`/materials/${id}`);
    toast.success("Deleted");
    load();
  };

  const margin = (m) => (m.price > 0 ? Math.round(((m.price - m.cost) / m.price) * 100) : 0);

  return (
    <div>
      <PageHeader overline="Inventory" title="Materials">
        <Btn onClick={openNew} data-testid="add-material-btn"><Plus size={16} weight="bold" /> Add Material</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border border border-border" data-testid="materials-grid">
          {rows.map((m) => (
            <div key={m.id} className="bg-card p-6 group">
              <div className="flex items-start justify-between">
                <div>
                  <div className="overline text-[#0E7490]">{m.category || "Uncategorized"}</div>
                  <h3 className="font-display font-semibold text-lg mt-1">{m.name}</h3>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.supplier || "No supplier"}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <Btn variant="ghost" onClick={() => openEdit(m)} data-testid={`edit-material-${m.id}`}><PencilSimple size={16} /></Btn>
                  <Btn variant="ghost" onClick={() => remove(m.id)} data-testid={`delete-material-${m.id}`}><Trash size={16} /></Btn>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-border">
                <div><div className="overline text-muted-foreground">Cost</div><div className="font-mono text-sm mt-1">{currency(m.cost)}</div></div>
                <div><div className="overline text-muted-foreground">Price/{m.unit}</div><div className="font-mono text-sm mt-1">{currency(m.price)}</div></div>
                <div><div className="overline text-muted-foreground">Margin</div><div className="font-mono text-sm mt-1 text-[#16A34A]">{margin(m)}%</div></div>
              </div>
              {m.stock != null && <div className="text-xs text-muted-foreground mt-3">Stock: <span className="font-mono">{m.stock} {m.unit}</span></div>}
            </div>
          ))}
          {rows.length === 0 && <div className="bg-card p-10 text-center text-muted-foreground col-span-full">No materials yet.</div>}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit" : "New"} Material</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Inp label="Name" value={form.name} onChange={set("name")} testid="mat-name" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Category" value={form.category} onChange={set("category")} testid="mat-category" />
              <Inp label="Unit (sqft, roll, ea)" value={form.unit} onChange={set("unit")} testid="mat-unit" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Inp label="Cost" type="number" value={form.cost} onChange={set("cost")} testid="mat-cost" />
              <Inp label="Price" type="number" value={form.price} onChange={set("price")} testid="mat-price" />
              <Inp label="Stock" type="number" value={form.stock} onChange={set("stock")} testid="mat-stock" />
            </div>
            <Inp label="Supplier" value={form.supplier} onChange={set("supplier")} testid="mat-supplier" />
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
