import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, Trash } from "@phosphor-icons/react";
import SearchSelect from "@/components/SearchSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const emptyItem = { description: "", details: "", category: "", material_id: "", width_in: "", height_in: "", quantity: 1, price_per_sqft: 0, cost_per_sqft: 0, line_total_override: "", extra_labor_hours: 0, laminated: false };
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const newItem = () => ({ ...emptyItem, _key: uid() });

const areaOf = (li) => {
  const w = Number(li.width_in || 0), h = Number(li.height_in || 0), q = Number(li.quantity || 0);
  return w > 0 && h > 0 ? (w * h / 144) * q : q;
};

export default function DocBuilder({ open, onClose, onSave, initial, kind }) {
  const { user } = useAuth();
  const isInvoice = kind === "invoice";
  const isSalesOrder = kind === "sales-order";
  const isEstimate = kind === "estimate" || (!isInvoice && !isSalesOrder);
  const hasCommission = isEstimate || isSalesOrder;
  const label = isInvoice ? "Invoice" : isSalesOrder ? "Sales Order" : "Estimate";
  const statusOptions = isInvoice
    ? ["unpaid", "partial", "paid", "overdue"]
    : isSalesOrder
    ? ["open", "in_production", "fulfilled"]
    : ["draft", "sent", "approved", "rejected"];
  const isAdmin = user?.role === "admin";
  const [customers, setCustomers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [categories, setCategories] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [settings, setSettings] = useState({ shop_rate_per_hr: 0, shop_sqft_per_hr: 0, machine_rate_per_hr: 0, machine_sqft_per_hr: 0 });
  const [form, setForm] = useState(null);
  const [ncOpen, setNcOpen] = useState(false);
  const [nc, setNc] = useState({ name: "", email: "", phone: "", title: "" });

  useEffect(() => {
    if (open) {
      api.get("/customers").then((r) => setCustomers(r.data));
      api.get("/materials").then((r) => setMaterials(r.data));
      api.get("/material-categories").then((r) => setCategories(r.data.all || [])).catch(() => {});
      api.get("/settings").then((r) => {
        setSettings(r.data);
        if (!initial) setForm((f) => (f ? { ...f, tax_rate: r.data.default_tax_rate ?? 0 } : f));
      });
      if (isAdmin) api.get("/users").then((r) => setSalesmen([...r.data].sort((a, b) => (a.name || "").localeCompare(b.name || "")))).catch(() => {});
      setForm(
        initial
          ? { ...initial, line_items: (initial.line_items || []).map((li) => ({ ...emptyItem, ...li, _key: li._key || uid() })) }
          : {
              customer_id: "", contact_id: "", title: "", line_items: [newItem()], tax_rate: 0, notes: "",
              status: statusOptions[0], due_date: "",
              commission_rate: isAdmin ? 0 : (user?.commission_rate || 0), salesman_id: isAdmin ? "" : user?.id,
            }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, kind, isAdmin, user]);

  useEffect(() => {
    if (open && form?.customer_id) {
      api.get(`/customers/${form.customer_id}/contacts`).then((r) => setContacts(r.data)).catch(() => setContacts([]));
    } else {
      setContacts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form?.customer_id]);

  if (!form) return null;

  const set = (k, v) => setForm({ ...form, [k]: v });
  const catOfMaterial = (mid) => materials.find((m) => m.id === mid)?.category || "";
  const setItem = (i, k, v) => {
    const items = [...form.line_items];
    items[i] = { ...items[i], [k]: v };
    if (k === "material_id") {
      const m = materials.find((x) => x.id === v);
      if (m) { const c = m.cost_per_sqft || 0; items[i].cost_per_sqft = c; items[i].price_per_sqft = m.price_per_sqft || (c > 0 ? Number((c * 1.3).toFixed(4)) : 0); items[i].description = m.name; items[i].category = m.category || items[i].category; }
      else { items[i].price_per_sqft = 0; items[i].cost_per_sqft = 0; items[i].description = ""; }
    }
    if (k === "cost_per_sqft") {
      const c = Number(v) || 0;
      if (c > 0) items[i].price_per_sqft = Number((c * 1.3).toFixed(4));
    }
    if (k === "category") {
      const m = materials.find((x) => x.id === items[i].material_id);
      if (!m || m.category !== v) { items[i].material_id = ""; items[i].price_per_sqft = 0; items[i].cost_per_sqft = 0; items[i].description = ""; }
      const cv = String(v).trim().toLowerCase();
      if (cv === "shipping") { items[i].width_in = 0; items[i].height_in = 0; items[i].quantity = 1; items[i].material_id = ""; items[i].line_total_override = ""; if (!items[i].description) items[i].description = "Shipping"; }
      if (cv === "installation") { items[i].width_in = 0; items[i].height_in = 0; items[i].quantity = 1; items[i].material_id = ""; items[i].cost_per_sqft = 0; items[i].line_total_override = ""; if (!items[i].description) items[i].description = "Installation"; }
      if (cv === "cnc router time") { items[i].width_in = 0; items[i].height_in = 0; items[i].quantity = 1; items[i].material_id = ""; items[i].cost_per_sqft = 0; items[i].price_per_sqft = Number(settings.cnc_rate_per_min || 1.30); items[i].line_total_override = ""; if (!items[i].description) items[i].description = "CNC Router Time"; }
    }
    setForm({ ...form, line_items: items });
  };
  const addItem = () => setForm({ ...form, line_items: [...form.line_items, newItem()] });
  const rmItem = (i) => setForm({ ...form, line_items: form.line_items.filter((_, x) => x !== i) });
  const createCategoryFor = async (i) => {
    const name = window.prompt("New category name:");
    if (!name || !name.trim()) return;
    try {
      const { data } = await api.post("/material-categories", { name: name.trim() });
      const { data: cd } = await api.get("/material-categories");
      setCategories(cd.all || []);
      setItem(i, "category", data.name);
      toast.success("Category added");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not add category"); }
  };
  const saveContact = async () => {
    if (!nc.name.trim()) { toast.error("Contact name is required"); return; }
    try {
      const { data } = await api.post(`/customers/${form.customer_id}/contacts`, { name: nc.name.trim(), email: nc.email || null, phone: nc.phone || null, title: nc.title || null });
      const { data: list } = await api.get(`/customers/${form.customer_id}/contacts`);
      setContacts(list);
      setForm((f) => ({ ...f, contact_id: data.id }));
      setNcOpen(false);
      toast.success("Contact added");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not add contact"); }
  };

  const breakdown = (li) => {
    const area = areaOf(li);
    const material = Number(li.price_per_sqft || 0) * area;
    const flat = ["shipping", "installation", "cnc router time"].includes(String(li.category || "").trim().toLowerCase());
    let machineH = settings.machine_sqft_per_hr > 0 ? area / settings.machine_sqft_per_hr : 0;
    let laborH = (settings.shop_sqft_per_hr > 0 ? area / settings.shop_sqft_per_hr : 0) + Number(li.extra_labor_hours || 0);
    if (li.laminated && !flat) {
      const lamH = settings.laminator_sqft_per_hr > 0 ? area / settings.laminator_sqft_per_hr : 0;
      laborH += lamH; machineH += lamH;
    }
    const machine = flat ? 0 : (settings.machine_sqft_per_hr > 0 ? (area / settings.machine_sqft_per_hr) * settings.machine_rate_per_hr : 0) + (li.laminated && settings.laminator_sqft_per_hr > 0 ? (area / settings.laminator_sqft_per_hr) * settings.laminator_rate_per_hr : 0);
    const labor = flat ? 0 : laborH * settings.shop_rate_per_hr;
    return { area, material, machine, labor, total: material + machine + labor };
  };
  const lineTotal = (li) => {
    const ov = li.line_total_override;
    if (ov !== "" && ov != null && Number(ov) > 0) return Number(ov);
    return breakdown(li).total;
  };
  const lineMargin = (li) => {
    const b = breakdown(li);
    return lineTotal(li) - (Number(li.cost_per_sqft || 0) * areaOf(li)) - b.labor - b.machine;
  };

  const subtotal = form.line_items.reduce((s, li) => s + lineTotal(li), 0);
  const selCust = customers.find((c) => c.id === form.customer_id);
  const discRate = selCust?.tier ? ({ 1: 35, 2: 25, 3: 15 }[selCust.tier] || 0) : 0;
  const discount = subtotal * (discRate / 100);
  const taxable = subtotal - discount;
  const tax = taxable * (Number(form.tax_rate || 0) / 100);
  const total = taxable + tax;
  const totMaterial = form.line_items.reduce((s, li) => s + breakdown(li).material, 0);
  const totMargin = form.line_items.reduce((s, li) => s + lineMargin(li), 0);
  const totMarginPct = subtotal > 0 ? (totMargin / subtotal) * 100 : 0;
  const totLabor = form.line_items.reduce((s, li) => s + breakdown(li).labor, 0);
  const totMachine = form.line_items.reduce((s, li) => s + breakdown(li).machine, 0);
  const commissionBase = totMargin;
  const commission = commissionBase * (Number(form.commission_rate || 0) / 100);

  const submit = () => {
    onSave({
      ...form,
      contact_id: form.contact_id || null,
      tax_rate: Number(form.tax_rate || 0),
      due_date: form.due_date || null,
      commission_rate: Number(form.commission_rate || 0),
      salesman_id: form.salesman_id || null,
      line_items: form.line_items
        .filter((li) => li.description || li.material_id)
        .map((li) => ({
          description: li.description, details: li.details || "", category: li.category || null, material_id: li.material_id || null,
          width_in: Number(li.width_in || 0), height_in: Number(li.height_in || 0),
          quantity: Number(li.quantity || 0), price_per_sqft: Number(li.price_per_sqft || 0),
          cost_per_sqft: Number(li.cost_per_sqft || 0),
          line_total_override: (li.line_total_override === "" || li.line_total_override == null) ? null : Number(li.line_total_override),
          extra_labor_hours: Number(li.extra_labor_hours || 0),
          laminated: !!li.laminated,
        })),
    });
  };

  const cols = "grid-cols-[1fr_1.2fr_0.5fr_0.5fr_0.5fr_0.55fr_0.65fr_0.6fr_0.8fr_0.3fr]";

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="font-display">{initial ? "Edit" : "New"} {label}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Shop {currency(settings.shop_rate_per_hr)}/hr @ {settings.shop_sqft_per_hr} sqft/hr · Machine {currency(settings.machine_rate_per_hr)}/hr @ {settings.machine_sqft_per_hr} sqft/hr · hours auto-derived from area
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="block min-w-0">
              <span className="overline text-muted-foreground">Customer</span>
              <SearchSelect testid="doc-customer" value={form.customer_id} placeholder="Select customer…"
                options={customers.map((c) => ({ value: c.id, label: c.company || c.name }))}
                onChange={(v) => setForm({ ...form, customer_id: v, contact_id: "" })} />
            </div>
            <label className="block min-w-0">
              <span className="overline text-muted-foreground">Contact (Attn)</span>
              <select value={form.contact_id || ""} onChange={(e) => { if (e.target.value === "__new__") { setNc({ name: "", email: "", phone: "", title: "" }); setNcOpen(true); } else set("contact_id", e.target.value); }} data-testid="doc-contact" disabled={!form.customer_id}
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                <option value="">{contacts.length ? "No specific contact" : "No contacts on file"}</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` — ${c.title}` : ""}</option>)}
                {form.customer_id && <option value="__new__">+ Add new contact…</option>}
              </select>
            </label>
            <Inp label="Title / Job" value={form.title} onChange={(e) => set("title", e.target.value)} testid="doc-title" />
          </div>

          <div className="border border-border overflow-x-auto min-w-0 w-full">
            <div className={`grid ${cols} gap-2 px-3 py-2 border-b border-border overline text-muted-foreground bg-secondary/50 min-w-[1000px]`}>
              <div>Category</div><div>Material</div><div className="text-right">W(in)</div><div className="text-right">H(in)</div>
              <div className="text-right">Qty</div><div className="text-right">Sqft</div><div className="text-right">Sell/sqft</div><div className="text-right">Extra hrs</div>
              <div className="text-right">Total</div><div></div>
            </div>
            {form.line_items.map((li, i) => {
              const cat = li.category || catOfMaterial(li.material_id);
              const baseCats = categories.includes(cat) || !cat ? categories : [cat, ...categories];
              const catOptions = Array.from(new Set(baseCats));
              const matOptions = materials.filter((m) => !cat || m.category === cat);
              const isShip = String(cat).trim().toLowerCase() === "shipping";
              const isInstall = String(cat).trim().toLowerCase() === "installation";
              const isCnc = String(cat).trim().toLowerCase() === "cnc router time";
              return (
              <div key={li._key} className="border-b border-border last:border-0 min-w-[1000px]">
                <div className={`grid ${cols} gap-2 px-3 pt-2 items-center`}>
                <select value={cat} onChange={(e) => e.target.value === "__new__" ? createCategoryFor(i) : setItem(i, "category", e.target.value)} data-testid={`item-cat-${i}`} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">All categories</option>
                  {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  {isAdmin && <option value="__new__">+ Create category…</option>}
                </select>
                {isShip ? (
                <>
                <div style={{ gridColumn: "span 7" }} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Shipping cost $</span>
                  <input type="number" value={li.cost_per_sqft} onChange={(e) => setItem(i, "cost_per_sqft", e.target.value)} data-testid={`item-cost-${i}`} className="w-36 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">+ 30% markup</span>
                </div>
                <div className="text-right font-mono text-sm" data-testid={`item-line-${i}`}>{currency(lineTotal(li))}</div>
                </>
                ) : isInstall ? (
                <>
                <div style={{ gridColumn: "span 7" }} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Installation cost $</span>
                  <input type="number" value={li.price_per_sqft} onChange={(e) => setItem(i, "price_per_sqft", e.target.value)} data-testid={`item-install-${i}`} className="w-36 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="text-right font-mono text-sm" data-testid={`item-line-${i}`}>{currency(lineTotal(li))}</div>
                </>
                ) : isCnc ? (
                <>
                <div style={{ gridColumn: "span 7" }} className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Minutes</span>
                  <input type="number" value={li.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} data-testid={`item-cnc-min-${i}`} className="w-28 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">× {currency(li.price_per_sqft || 0)}/min</span>
                </div>
                <div className="text-right font-mono text-sm" data-testid={`item-line-${i}`}>{currency(lineTotal(li))}</div>
                </>
                ) : (
                <>
                <select value={li.material_id || ""} onChange={(e) => setItem(i, "material_id", e.target.value)} data-testid={`item-mat-${i}`} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">— select material —</option>
                  {matOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Cell value={li.width_in} onChange={(v) => setItem(i, "width_in", v)} testid={`item-w-${i}`} blankZero />
                <Cell value={li.height_in} onChange={(v) => setItem(i, "height_in", v)} testid={`item-h-${i}`} blankZero />
                <Cell value={li.quantity} onChange={(v) => setItem(i, "quantity", v)} testid={`item-qty-${i}`} />
                <div className="text-right font-mono text-sm text-muted-foreground" data-testid={`item-sqft-${i}`}>{areaOf(li).toFixed(2)}</div>
                <Cell value={li.price_per_sqft} onChange={(v) => setItem(i, "price_per_sqft", v)} testid={`item-price-${i}`} />
                <Cell value={li.extra_labor_hours} onChange={(v) => setItem(i, "extra_labor_hours", v)} testid={`item-extra-${i}`} />
                <input type="number" value={(li.line_total_override !== "" && li.line_total_override != null) ? li.line_total_override : Number(lineTotal(li).toFixed(2))} onChange={(e) => setItem(i, "line_total_override", e.target.value)} data-testid={`item-line-${i}`} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />
                </>
                )}
                <button onClick={() => rmItem(i)} data-testid={`item-remove-${i}`} className="flex justify-center text-muted-foreground hover:text-destructive"><Trash size={16} /></button>
                </div>
                <div className="px-3 pb-2 pt-1 flex items-center gap-3 min-w-[1000px]">
                  <input value={li.details || ""} onChange={(e) => setItem(i, "details", e.target.value)} placeholder="+ Additional details / specifics for this item (optional)" data-testid={`item-details-${i}`} className="flex-1 min-w-0 border border-input/60 bg-secondary/30 px-2 py-1.5 text-xs rounded-none focus:outline-none focus:ring-1 focus:ring-ring" />
                  {!(isShip || isInstall || isCnc) && (
                    <label className="flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer select-none" title="Adds laminator labor + machine time (area ÷ throughput)">
                      <input type="checkbox" checked={!!li.laminated} onChange={(e) => setItem(i, "laminated", e.target.checked)} data-testid={`item-laminate-${i}`} className="h-3.5 w-3.5 accent-[#0A0A0A]" />
                      Laminate
                    </label>
                  )}
                  <div className="text-xs font-mono whitespace-nowrap text-muted-foreground" data-testid={`item-margin-${i}`}>
                    Margin <span className="text-[#16A34A] font-semibold">{lineTotal(li) > 0 ? ((lineMargin(li) / lineTotal(li)) * 100).toFixed(0) : 0}%</span>
                  </div>
                </div>
              </div>
              );
            })}
            <div className="px-3 py-2 min-w-[1000px]"><Btn variant="ghost" onClick={addItem} data-testid="add-line-item-btn"><Plus size={16} weight="bold" /> Add line</Btn></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Inp label="Tax rate (%)" type="number" value={form.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} testid="doc-tax" />
              {isInvoice && <Inp label="Due date" type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} testid="doc-due" />}
              <label className="block">
                <span className="overline text-muted-foreground">Status</span>
                <select value={form.status} onChange={(e) => set("status", e.target.value)} data-testid="doc-status" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              {hasCommission && (
                <div className="border border-border p-3 space-y-3" data-testid="commission-block">
                  <div className="overline text-[#A21CAF]">Sales commission (on gross profit)</div>
                  {isAdmin ? (
                    <label className="block">
                      <span className="overline text-muted-foreground">Salesman</span>
                      <select value={form.salesman_id || ""} onChange={(e) => { const sid = e.target.value; const sm = salesmen.find((s) => s.id === sid); setForm({ ...form, salesman_id: sid, commission_rate: sm ? (sm.commission_rate || 0) : form.commission_rate }); }} data-testid="doc-salesman"
                        className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="">— unassigned —</option>
                        {salesmen.map((s) => <option key={s.id} value={s.id}>{`${s.name} (${s.commission_rate || 0}%)`}</option>)}
                      </select>
                    </label>
                  ) : (
                    <div className="text-sm">Salesman: <span className="font-medium">{user?.name} (you)</span></div>
                  )}
                  <Inp label="Commission rate (%)" type="number" value={form.commission_rate} onChange={(e) => set("commission_rate", e.target.value)} testid="doc-commission-rate" />
                  <div className="border-t border-border pt-2 text-sm font-mono flex justify-between" data-testid="commission-preview">
                    <span>{currency(commissionBase)} × {Number(form.commission_rate || 0)}%</span>
                    <span className="text-[#A21CAF] font-semibold">{currency(commission)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border border-border p-4 self-start">
              <Row label="Material cost" value={totMaterial} muted />
              <Row label="Shop labor" value={totLabor} muted />
              <Row label="Machine" value={totMachine} muted />
              <div className="flex justify-between text-xs py-0.5 font-mono" data-testid="doc-margin-summary">
                <span className="text-[#0E7490]">Material margin (internal)</span>
                <span className="text-[#16A34A] font-semibold">{totMarginPct.toFixed(0)}%</span>
              </div>
              <div className="border-t border-border mt-2 pt-2"><Row label="Subtotal" value={subtotal} /></div>
              {discRate > 0 && (
                <div className="flex justify-between text-sm py-0.5" data-testid="discount-row">
                  <span className="text-[#16A34A]">Tier {selCust.tier} discount ({discRate}%)</span>
                  <span className="font-mono text-[#16A34A]">-{currency(discount)}</span>
                </div>
              )}
              <Row label={`Tax (${form.tax_rate || 0}%)`} value={tax} muted />
              <div className="border-t border-border mt-2 pt-2"><Row label="Total" value={total} bold /></div>
              {hasCommission && Number(form.commission_rate || 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border text-xs font-mono text-muted-foreground space-y-1">
                  <div className="flex justify-between"><span>Commission base (gross profit)</span><span>{currency(commissionBase)}</span></div>
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

    <Dialog open={ncOpen} onOpenChange={(o) => !o && setNcOpen(false)}>
      <DialogContent className="rounded-none max-w-md" data-testid="new-contact-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Add contact</DialogTitle>
          <DialogDescription className="font-mono text-xs">New contact for this customer — becomes selectable as the document's Attn.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Inp label="Name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} testid="nc-name" />
          <Inp label="Title" value={nc.title} onChange={(e) => setNc({ ...nc, title: e.target.value })} testid="nc-title" />
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} testid="nc-email" />
            <Inp label="Phone" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} testid="nc-phone" />
          </div>
        </div>
        <DialogFooter>
          <Btn variant="outline" onClick={() => setNcOpen(false)}>Cancel</Btn>
          <Btn onClick={saveContact} data-testid="save-contact-btn">Add contact</Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Cell({ value, onChange, testid, blankZero }) {
  const shown = blankZero && (value === 0 || value === "0") ? "" : value;
  return <input type="number" value={shown} onChange={(e) => onChange(e.target.value)} data-testid={testid} className="w-full min-w-0 border border-input px-2 py-1.5 text-sm rounded-none text-right focus:outline-none focus:ring-1 focus:ring-ring" />;
}

function Row({ label, value, bold, muted }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className={bold ? "font-display font-semibold" : muted ? "text-muted-foreground text-xs" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold text-base" : muted ? "text-xs" : ""}`}>{currency(value)}</span>
    </div>
  );
}
