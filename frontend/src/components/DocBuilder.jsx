import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, Trash } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const emptyItem = { description: "", details: "", material_id: "", width_in: 0, height_in: 0, quantity: 1, price_per_sqft: 0, extra_labor_hours: 0 };

const areaOf = (li) => {
  const w = Number(li.width_in || 0), h = Number(li.height_in || 0), q = Number(li.quantity || 0);
  return w > 0 && h > 0 ? (w * h / 144) * q : q;
};

export default function DocBuilder({ open, onClose, onSave, initial, kind }) {
  const { user } = useAuth();
  const isEstimate = kind !== "invoice";
  const isAdmin = user?.role === "admin";
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [settings, setSettings] = useState({ shop_rate_per_hr: 0, shop_sqft_per_hr: 0, machine_rate_per_hr: 0, machine_sqft_per_hr: 0 });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (open) {
      api.get("/customers").then((r) => setCustomers(r.data));
      api.get("/materials").then((r) => setMaterials(r.data));
      api.get("/settings").then((r) => setSettings(r.data));
      if (isAdmin) api.get("/users").then((r) => setSalesmen(r.data.filter((u) => u.role === "salesman"))).catch(() => {});
      setForm(
        initial
          ? { ...initial, line_items: (initial.line_items || []).map((li) => ({ ...emptyItem, ...li })) }
          : {
              customer_id: "", title: "", line_items: [{ ...emptyItem }], tax_rate: 0, notes: "",
              status: kind === "invoice" ? "unpaid" : "draft", due_date: "",
              commission_rate: isAdmin ? 0 : (user?.commission_rate || 0), salesman_id: isAdmin ? "" : user?.id,
            }
      );
    }
  }, [open, initial, kind, isAdmin, user]);

  if (!form) return null;

  const set = (k, v) => setForm({ ...form, [k]: v });
  const setItem = (i, k, v) => {
    const items = [...form.line_items];
    items[i] = { ...items[i], [k]: v };
    if (k === "material_id") {
      const m = materials.find((x) => x.id === v);
      if (m) { items[i].price_per_sqft = m.price_per_sqft; if (!items[i].description) items[i].description = m.name; }
    }
    setForm({ ...form, line_items: items });
  };
  const addItem = () => setForm({ ...form, line_items: [...form.line_items, { ...emptyItem }] });
  const rmItem = (i) => setForm({ ...form, line_items: form.line_items.filter((_, x) => x !== i) });

  const breakdown = (li) => {
    const area = areaOf(li);
    const material = Number(li.price_per_sqft || 0) * area;
    const machineH = settings.machine_sqft_per_hr > 0 ? area / settings.machine_sqft_per_hr : 0;
    const machine = machineH * settings.machine_rate_per_hr;
    const laborH = (settings.shop_sqft_per_hr > 0 ? area / settings.shop_sqft_per_hr : 0) + Number(li.extra_labor_hours || 0);
    const labor = laborH * settings.shop_rate_per_hr;
    return { area, material, machine, labor, total: material + machine + labor };
  };
  const lineTotal = (li) => breakdown(li).total;

  const subtotal = form.line_items.reduce((s, li) => s + lineTotal(li), 0);
  const selCust = customers.find((c) => c.id === form.customer_id);
  const discRate = selCust?.tier ? ({ 1: 35, 2: 25, 3: 15 }[selCust.tier] || 0) : 0;
  const discount = subtotal * (discRate / 100);
  const taxable = subtotal - discount;
  const tax = taxable * (Number(form.tax_rate || 0) / 100);
  const total = taxable + tax;
  const commission = subtotal * (Number(form.commission_rate || 0) / 100);
  const totMaterial = form.line_items.reduce((s, li) => s + breakdown(li).material, 0);
  const totLabor = form.line_items.reduce((s, li) => s + breakdown(li).labor, 0);
  const totMachine = form.line_items.reduce((s, li) => s + breakdown(li).machine, 0);

  const submit = () => {
    onSave({
      ...form,
      tax_rate: Number(form.tax_rate || 0),
      due_date: form.due_date || null,
      commission_rate: Number(form.commission_rate || 0),
      salesman_id: form.salesman_id || null,
      line_items: form.line_items
        .filter((li) => li.description || li.material_id)
        .map((li) => ({
          description: li.description, details: li.details || "", material_id: li.material_id || null,
          width_in: Number(li.width_in || 0), height_in: Number(li.height_in || 0),
          quantity: Number(li.quantity || 0), price_per_sqft: Number(li.price_per_sqft || 0),
          extra_labor_hours: Number(li.extra_labor_hours || 0),
        })),
    });
  };

  const cols = "grid-cols-[1.7fr_1.4fr_0.6fr_0.6fr_0.6fr_0.8fr_0.8fr_1fr_0.3fr]";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="font-display">{initial ? "Edit" : "New"} {kind === "invoice" ? "Invoice" : "Estimate"}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Shop {currency(settings.shop_rate_per_hr)}/hr @ {settings.shop_sqft_per_hr} sqft/hr · Machine {currency(settings.machine_rate_per_hr)}/hr @ {settings.machine_sqft_per_hr} sqft/hr · hours auto-derived from area
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <label className="block min-w-0">
              <span className="overline text-muted-foreground">Customer</span>
              <select value={form.customer_id} onChange={(e) => set("customer_id", e.target.value)} data-testid="doc-customer"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
              </select>
            </label>
            <Inp label="Title / Job" value={form.title} onChange={(e) => set("title", e.target.value)} testid="doc-title" />
          </div>

          <div className="border border-border overflow-x-auto min-w-0 w-full">
            <div className={`grid ${cols} gap-2 px-3 py-2 border-b border-border overline text-muted-foreground bg-secondary/50 min-w-[820px]`}>
              <div>Description</div><div>Material</div><div className="text-right">W(in)</div><div className="text-right">H(in)</div>
              <div className="text-right">Qty</div><div className="text-right">$/sqft</div><div className="text-right">Extra hrs</div>
              <div className="text-right">Line</div><div></div>
            </div>
            {form.line_items.map((li, i) => (
              <div key={i} className="border-b border-border last:border-0 min-w-[820px]">
                <div className={`grid ${cols} gap-2 px-3 pt-2 items-center`}>
                <input value={li.description} onChange={(e) => setItem(i, "description", e.target.value)} placeholder="Line item" data-testid={`item-desc-${i}`} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring" />
                <select value={li.material_id || ""} onChange={(e) => setItem(i, "material_id", e.target.value)} data-testid={`item-mat-${i}`} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">—</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Cell value={li.width_in} onChange={(v) => setItem(i, "width_in", v)} testid={`item-w-${i}`} />
                <Cell value={li.height_in} onChange={(v) => setItem(i, "height_in", v)} testid={`item-h-${i}`} />
                <Cell value={li.quantity} onChange={(v) => setItem(i, "quantity", v)} testid={`item-qty-${i}`} />
                <Cell value={li.price_per_sqft} onChange={(v) => setItem(i, "price_per_sqft", v)} testid={`item-price-${i}`} />
                <Cell value={li.extra_labor_hours} onChange={(v) => setItem(i, "extra_labor_hours", v)} testid={`item-extra-${i}`} />
                <div className="text-right font-mono text-sm" data-testid={`item-line-${i}`}>{currency(lineTotal(li))}</div>
                <button onClick={() => rmItem(i)} data-testid={`item-remove-${i}`} className="flex justify-center text-muted-foreground hover:text-destructive"><Trash size={16} /></button>
                </div>
                <div className="px-3 pb-2 pt-1">
                  <input value={li.details || ""} onChange={(e) => setItem(i, "details", e.target.value)} placeholder="+ Additional details / specifics for this item (optional)" data-testid={`item-details-${i}`} className="w-full min-w-0 border border-input/60 bg-secondary/30 px-2 py-1.5 text-xs rounded-none focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
            ))}
            <div className="px-3 py-2 min-w-[820px]"><Btn variant="ghost" onClick={addItem} data-testid="add-line-item-btn"><Plus size={16} weight="bold" /> Add line</Btn></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Inp label="Tax rate (%)" type="number" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} testid="doc-tax" />
              {kind === "invoice" && <Inp label="Due date" type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} testid="doc-due" />}
              <label className="block">
                <span className="overline text-muted-foreground">Status</span>
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="doc-status" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {(kind === "invoice" ? ["unpaid", "partial", "paid", "overdue"] : ["draft", "sent", "approved", "rejected"]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              {isEstimate && (
                <div className="border border-border p-3 space-y-3" data-testid="commission-block">
                  <div className="overline text-[#A21CAF]">Sales commission (on total cost)</div>
                  {isAdmin ? (
                    <label className="block">
                      <span className="overline text-muted-foreground">Salesman</span>
                      <select value={form.salesman_id || ""} onChange={(e) => set("salesman_id", e.target.value)} data-testid="doc-salesman"
                        className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="">— unassigned —</option>
                        {salesmen.map((s) => <option key={s.id} value={s.id}>{`${s.name} (${s.commission_rate}%)`}</option>)}
                      </select>
                    </label>
                  ) : (
                    <div className="text-sm">Salesman: <span className="font-medium">{user?.name} (you)</span></div>
                  )}
                  <Inp label="Commission rate (%)" type="number" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} testid="doc-commission-rate" />
                  <div className="border-t border-border pt-2 text-sm font-mono flex justify-between" data-testid="commission-preview">
                    <span>{currency(subtotal)} × {Number(form.commission_rate || 0)}%</span>
                    <span className="text-[#A21CAF] font-semibold">{currency(commission)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-border p-4 self-start">
              <Row label="Material cost" value={totMaterial} muted />
              <Row label="Shop labor" value={totLabor} muted />
              <Row label="Machine" value={totMachine} muted />
              <div className="border-t border-border mt-2 pt-2"><Row label="Subtotal" value={subtotal} /></div>
              {discRate > 0 && (
                <div className="flex justify-between text-sm py-0.5" data-testid="discount-row">
                  <span className="text-[#16A34A]">Tier {selCust.tier} discount ({discRate}%)</span>
                  <span className="font-mono text-[#16A34A]">-{currency(discount)}</span>
                </div>
              )}
              <Row label={`Tax (${form.tax_rate || 0}%)`} value={tax} muted />
              <div className="border-t border-border mt-2 pt-2"><Row label="Total" value={total} bold /></div>
              {isEstimate && Number(form.commission_rate || 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border text-xs font-mono text-muted-foreground space-y-1">
                  <div className="flex justify-between"><span>Commission base (all cost)</span><span>{currency(subtotal)}</span></div>
                  <div className="flex justify-between"><span>Rate</span><span>{Number(form.commission_rate)}%</span></div>
                  <div className="flex justify-between text-[#A21CAF]"><span>Commission</span><span>{currency(commission)}</span></div>
                  <div className="flex justify-between text-foreground"><span>Net after commission</span><span>{currency(total - commission)}</span></div>
                </div>
              )}
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

function Cell({ value, onChange, testid }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />;
}

function Row({ label, value, bold, muted }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className={bold ? "font-display font-semibold" : muted ? "text-muted-foreground text-xs" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold text-base" : muted ? "text-xs" : ""}`}>{currency(value)}</span>
    </div>
  );
}
