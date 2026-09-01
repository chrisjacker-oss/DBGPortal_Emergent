import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, Trash } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const emptyItem = { description: "", material_id: "", quantity: 1, unit_price: 0 };

export default function DocBuilder({ open, onClose, onSave, initial, kind }) {
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open) {
      api.get("/customers").then((r) => setCustomers(r.data));
      api.get("/materials").then((r) => setMaterials(r.data));
      setForm(
        initial || {
          customer_id: "",
          title: "",
          line_items: [{ ...emptyItem }],
          tax_rate: 0,
          notes: "",
          status: kind === "invoice" ? "unpaid" : "draft",
          due_date: "",
        }
      );
    }
  }, [open, initial, kind]);

  if (!form) return null;

  const set = (k, v) => setForm({ ...form, [k]: v });
  const setItem = (i, k, v) => {
    const items = [...form.line_items];
    items[i] = { ...items[i], [k]: v };
    if (k === "material_id") {
      const m = materials.find((x) => x.id === v);
      if (m) { items[i].unit_price = m.price; if (!items[i].description) items[i].description = m.name; }
    }
    setForm({ ...form, line_items: items });
  };
  const addItem = () => setForm({ ...form, line_items: [...form.line_items, { ...emptyItem }] });
  const rmItem = (i) => setForm({ ...form, line_items: form.line_items.filter((_, x) => x !== i) });

  const subtotal = form.line_items.reduce((s, li) => s + Number(li.quantity || 0) * Number(li.unit_price || 0), 0);
  const tax = subtotal * (Number(form.tax_rate || 0) / 100);
  const total = subtotal + tax;

  const submit = () => {
    const payload = {
      ...form,
      tax_rate: Number(form.tax_rate || 0),
      due_date: form.due_date || null,
      line_items: form.line_items
        .filter((li) => li.description)
        .map((li) => ({
          description: li.description,
          material_id: li.material_id || null,
          quantity: Number(li.quantity || 0),
          unit_price: Number(li.unit_price || 0),
        })),
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {initial ? "Edit" : "New"} {kind === "invoice" ? "Invoice" : "Estimate"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="overline text-muted-foreground">Customer</span>
              <select
                value={form.customer_id}
                onChange={(e) => set("customer_id", e.target.value)}
                data-testid="doc-customer"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.company || c.name}</option>
                ))}
              </select>
            </label>
            <Inp label="Title / Job" value={form.title} onChange={(e) => set("title", e.target.value)} testid="doc-title" />
          </div>

          <div className="border border-border">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border overline text-muted-foreground bg-secondary/50">
              <div className="col-span-5">Description</div>
              <div className="col-span-3">Material</div>
              <div className="col-span-1 text-right">Qty</div>
              <div className="col-span-2 text-right">Unit $</div>
              <div className="col-span-1"></div>
            </div>
            {form.line_items.map((li, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border last:border-0 items-center">
                <input value={li.description} onChange={(e) => setItem(i, "description", e.target.value)} placeholder="Line item"
                  data-testid={`item-desc-${i}`} className="col-span-5 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring" />
                <select value={li.material_id || ""} onChange={(e) => setItem(i, "material_id", e.target.value)}
                  data-testid={`item-mat-${i}`} className="col-span-3 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">—</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input type="number" value={li.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)}
                  data-testid={`item-qty-${i}`} className="col-span-1 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                <input type="number" value={li.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)}
                  data-testid={`item-price-${i}`} className="col-span-2 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                <button onClick={() => rmItem(i)} data-testid={`item-remove-${i}`} className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive">
                  <Trash size={16} />
                </button>
              </div>
            ))}
            <div className="px-3 py-2">
              <Btn variant="ghost" onClick={addItem} data-testid="add-line-item-btn"><Plus size={16} weight="bold" /> Add line</Btn>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <Inp label="Tax rate (%)" type="number" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} testid="doc-tax" />
              {kind === "invoice" && <Inp label="Due date" type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} testid="doc-due" />}
              <label className="block">
                <span className="overline text-muted-foreground">Status</span>
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="doc-status"
                  className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {(kind === "invoice" ? ["unpaid", "partial", "paid", "overdue"] : ["draft", "sent", "approved", "rejected"]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="border border-border p-4 self-end">
              <Row label="Subtotal" value={subtotal} />
              <Row label={`Tax (${form.tax_rate || 0}%)`} value={tax} />
              <div className="border-t border-border mt-2 pt-2">
                <Row label="Total" value={total} bold />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn onClick={submit} data-testid="save-doc-btn">Save</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className={bold ? "font-display font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold text-base" : ""}`}>{currency(value)}</span>
    </div>
  );
}
