import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Plus, PencilSimple, Trash, Wrench, FilePdf } from "@phosphor-icons/react";
import { downloadFile } from "@/lib/download";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";

const EQUIPMENT = ["Trailer", "Box Truck", "Vehicle", "Tractor", "Outside Sign", "Other"];
const CUSTOMERS = ["J.B. Hunt", "Duval", "Hotline", "Target Trailer", "JetEx", "Deep Blue Commercial", "Avid", "Milestone", "AER", "DSV"];
const today = () => new Date().toISOString().slice(0, 10);
const empty = () => ({ customer_name: "", date: today(), work_performed: "", unit_vin: "", equipment_type: "Trailer", equipment_other: "", mileage_start: "", mileage_end: "" });

export default function WorkOrders() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [custOther, setCustOther] = useState(false);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fCust, setFCust] = useState("");
  const [fVin, setFVin] = useState("");
  const [delRow, setDelRow] = useState(null);
  const [sel, setSel] = useState({});
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = () => api.get("/work-orders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const custOptions = Array.from(new Set(rows.map((r) => r.customer_name).filter(Boolean))).sort();
  const visible = rows.filter((r) =>
    (!fFrom || (r.date || "") >= fFrom) &&
    (!fTo || (r.date || "") <= fTo) &&
    (!fCust || r.customer_name === fCust) &&
    (!fVin || String(r.unit_vin || "").toLowerCase().includes(fVin.toLowerCase()))
  );
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = visible.length > 0 && visible.every((r) => sel[r.id]);
  const toggleAll = () => { if (allChecked) setSel({}); else { const n = {}; visible.forEach((r) => { n[r.id] = true; }); setSel(n); } };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const openNew = () => { setForm(empty()); setCustOther(false); setEditing(null); setOpen(true); };
  const openEdit = (r) => {
    setForm({ ...empty(), ...r, mileage_start: r.mileage_start ?? "", mileage_end: r.mileage_end ?? "" });
    setCustOther(!!r.customer_name && !CUSTOMERS.includes(r.customer_name));
    setEditing(r.id); setOpen(true);
  };
  const onCustomerSelect = (v) => {
    if (v === "Other") { setCustOther(true); setForm({ ...form, customer_name: "" }); }
    else { setCustOther(false); setForm({ ...form, customer_name: v }); }
  };

  const save = async () => {
    if (!form.work_performed.trim()) { toast.error("Please describe the work performed"); return; }
    const payload = {
      customer_name: form.customer_name || null, date: form.date, work_performed: form.work_performed,
      unit_vin: form.unit_vin, equipment_type: form.equipment_type,
      equipment_other: form.equipment_type === "Other" ? form.equipment_other : "",
      mileage_start: form.mileage_start === "" ? null : Number(form.mileage_start),
      mileage_end: form.mileage_end === "" ? null : Number(form.mileage_end),
    };
    try {
      if (editing) await api.put(`/work-orders/${editing}`, payload);
      else await api.post("/work-orders", payload);
      toast.success("Work order saved"); setOpen(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  const confirmDelete = async (password) => {
    try {
      await api.delete(`/work-orders/${delRow.id}`, { data: { password } });
      toast.success("Work order deleted"); setDelRow(null); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const bulkDelete = async (password) => {
    try {
      const { data } = await api.post("/work-orders/bulk-delete", { ids: selIds, password });
      toast.success(`Deleted ${data.deleted} work order(s)`); setBulkOpen(false); setSel({}); load(); return true;
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); return false; }
  };

  const miles = (r) => (r.mileage_start != null && r.mileage_end != null ? Math.max(0, r.mileage_end - r.mileage_start) : null);

  return (
    <div>
      <PageHeader overline="Service · Installation" title="Work Orders">
        {isAdmin && selIds.length > 0 && <Btn variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-delete-wo-btn"><Trash size={16} weight="bold" /> Delete {selIds.length}</Btn>}
        <Btn onClick={openNew} data-testid="add-work-order-btn"><Plus size={16} weight="bold" /> New Work Order</Btn>
      </PageHeader>

      <div className="p-8">
        <div className="flex flex-wrap items-end gap-3 mb-4" data-testid="wo-filters">
          <label className="block"><span className="overline text-muted-foreground">From</span>
            <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} data-testid="wo-filter-from" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
          <label className="block"><span className="overline text-muted-foreground">To</span>
            <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} data-testid="wo-filter-to" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
          <label className="block"><span className="overline text-muted-foreground">Customer</span>
            <select value={fCust} onChange={(e) => setFCust(e.target.value)} data-testid="wo-filter-customer" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All customers</option>
              {custOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="block"><span className="overline text-muted-foreground">Unit / VIN</span>
            <input type="text" value={fVin} onChange={(e) => setFVin(e.target.value)} data-testid="wo-filter-vin" placeholder="Search unit / VIN" className="mt-1 block border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" /></label>
          {(fFrom || fTo || fCust || fVin) && <Btn variant="outline" onClick={() => { setFFrom(""); setFTo(""); setFCust(""); setFVin(""); }} data-testid="wo-filter-clear">Clear</Btn>}
          <div className="ml-auto text-sm text-muted-foreground font-mono self-center">{visible.length} of {rows.length}</div>
        </div>
        <div className="border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                {isAdmin && <th className="px-5 py-3 w-10"><input type="checkbox" checked={allChecked} onChange={toggleAll} data-testid="wo-select-all" className="h-4 w-4 accent-[#0A0A0A]" /></th>}
                <th className="px-5 py-3 font-mono">#</th>
                <th className="px-5 py-3 font-mono">Date</th>
                <th className="px-5 py-3 font-mono">Customer</th>
                <th className="px-5 py-3 font-mono">Equipment</th>
                <th className="px-5 py-3 font-mono">Unit / VIN</th>
                <th className="px-5 py-3 font-mono">Work Performed</th>
                {isAdmin && <th className="px-5 py-3 font-mono">Worker</th>}
                <th className="px-5 py-3 font-mono text-right">Miles</th>
                <th className="px-5 py-3 font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="work-orders-table">
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50 align-top">
                  {isAdmin && <td className="px-5 py-3"><input type="checkbox" checked={!!sel[r.id]} onChange={() => setSel((s) => ({ ...s, [r.id]: !s[r.id] }))} data-testid={`wo-select-${r.id}`} className="h-4 w-4 accent-[#0A0A0A]" /></td>}
                  <td className="px-5 py-3 font-mono">{r.number}</td>
                  <td className="px-5 py-3 font-mono text-muted-foreground">{r.date}</td>
                  <td className="px-5 py-3">{r.customer_name || "—"}</td>
                  <td className="px-5 py-3">{r.equipment_type === "Other" ? `Other: ${r.equipment_other || ""}` : r.equipment_type}</td>
                  <td className="px-5 py-3 font-mono text-xs">{r.unit_vin || "—"}</td>
                  <td className="px-5 py-3 max-w-[280px] text-muted-foreground">{r.work_performed}</td>
                  {isAdmin && <td className="px-5 py-3 text-muted-foreground">{r.worker_name || "—"}</td>}
                  <td className="px-5 py-3 text-right font-mono">{miles(r) != null ? miles(r) : "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" onClick={() => downloadFile(`/work-orders/${r.id}/pdf`, `${r.number}.pdf`, "application/pdf")} data-testid={`pdf-work-order-${r.id}`} title="Print / download PDF"><FilePdf size={16} /></Btn>
                      <Btn variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-work-order-${r.id}`}><PencilSimple size={16} /></Btn>
                      {isAdmin && <Btn variant="ghost" onClick={() => setDelRow(r)} data-testid={`delete-work-order-${r.id}`}><Trash size={16} /></Btn>}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={isAdmin ? 10 : 8} className="px-6 py-12 text-center text-muted-foreground"><Wrench size={22} className="mx-auto mb-2 opacity-50" />No work orders match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none max-w-lg max-h-[90vh] overflow-y-auto" data-testid="work-order-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? "Edit" : "New"} Work Order</DialogTitle>
            <DialogDescription className="font-mono text-xs">Log the service / installation work performed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <span className="overline text-muted-foreground">Customer</span>
              <select value={custOther ? "Other" : form.customer_name} onChange={(e) => onCustomerSelect(e.target.value)} data-testid="wo-customer" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">— Select customer —</option>
                {CUSTOMERS.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other…</option>
              </select>
              {custOther && (
                <input value={form.customer_name} onChange={set("customer_name")} data-testid="wo-customer-other" placeholder="Enter customer name" className="mt-2 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
              )}
            </div>
            <Inp label="Date" type="date" value={form.date} onChange={set("date")} testid="wo-date" />
            <label className="block">
              <span className="overline text-muted-foreground">Work performed</span>
              <textarea value={form.work_performed} onChange={set("work_performed")} data-testid="wo-work" rows={3} className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <Inp label="Unit / VIN" value={form.unit_vin} onChange={set("unit_vin")} testid="wo-unit-vin" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="overline text-muted-foreground">Equipment type</span>
                <select value={form.equipment_type} onChange={set("equipment_type")} data-testid="wo-equipment" className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none focus:outline-none focus:ring-2 focus:ring-ring">
                  {EQUIPMENT.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {form.equipment_type === "Other" && (
                <Inp label="Describe equipment" value={form.equipment_other} onChange={set("equipment_other")} testid="wo-equipment-other" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Mileage start" type="number" value={form.mileage_start} onChange={set("mileage_start")} testid="wo-mileage-start" />
              <Inp label="Mileage end" type="number" value={form.mileage_end} onChange={set("mileage_end")} testid="wo-mileage-end" />
            </div>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn onClick={save} data-testid="save-work-order-btn">Save</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminDeleteDialog open={!!delRow} label={`work order ${delRow?.number || ""}`} onClose={() => setDelRow(null)} onConfirm={confirmDelete} />
      <AdminDeleteDialog open={bulkOpen} label={`${selIds.length} selected work order(s)`} onClose={() => setBulkOpen(false)} onConfirm={bulkDelete} />
    </div>
  );
}
