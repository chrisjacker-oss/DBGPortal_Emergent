import { useEffect, useRef, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Gear, UploadSimple, Trash } from "@phosphor-icons/react";

const LOGO_URL = `${process.env.REACT_APP_BACKEND_URL}/api/pub/logo`;

export default function Settings() {
  const [form, setForm] = useState(null);
  const [logoTs, setLogoTs] = useState(Date.now());
  const fileRef = useRef(null);

  useEffect(() => { api.get("/settings").then((r) => setForm(r.data)); }, []);
  if (!form) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    try {
      await api.put("/settings", {
        shop_rate_per_hr: Number(form.shop_rate_per_hr),
        shop_sqft_per_hr: Number(form.shop_sqft_per_hr),
        machine_rate_per_hr: Number(form.machine_rate_per_hr),
        machine_sqft_per_hr: Number(form.machine_sqft_per_hr),
        default_markup: Number(form.default_markup),
        default_tax_rate: Number(form.default_tax_rate),
        card_surcharge_enabled: !!form.card_surcharge_enabled,
        card_surcharge_pct: Number(form.card_surcharge_pct || 0),
        low_margin_threshold: Number(form.low_margin_threshold || 0),
        company_name: form.company_name || "",
        company_address: form.company_address || "",
        company_phone: form.company_phone || "",
        company_web: form.company_web || "",
        company_email: form.company_email || "",
        accounting_email: form.accounting_email || "",
      });
      toast.success("Shop settings saved");
    } catch { toast.error("Save failed"); }
  };
  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post("/settings/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setLogoTs(Date.now());
      toast.success("Logo uploaded — it will appear on all quotes, sales orders and invoices");
    } catch (err) { toast.error(err.response?.data?.detail || "Upload failed"); }
  };
  const resetLogo = async () => {
    try { await api.delete("/settings/logo"); setLogoTs(Date.now()); toast.success("Reverted to default logo"); }
    catch { toast.error("Failed"); }
  };

  return (
    <div>
      <PageHeader overline="Configuration" title="Shop Settings">
        <Btn onClick={save} data-testid="save-settings-btn"><Gear size={16} weight="bold" /> Save</Btn>
      </PageHeader>
      <div className="p-8 max-w-2xl space-y-6">
        <div className="border border-border bg-card p-8 space-y-4" data-testid="logo-card">
          <div className="overline text-muted-foreground">Company logo (shown on all quotes, sales orders & invoices)</div>
          <div className="flex items-center gap-6">
            <div className="border border-border bg-secondary/40 h-24 w-48 flex items-center justify-center overflow-hidden">
              <img src={`${LOGO_URL}?ts=${logoTs}`} alt="Logo" className="max-h-20 max-w-44 object-contain" data-testid="logo-preview" />
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept="image/*" onChange={uploadLogo} className="hidden" data-testid="logo-file-input" />
              <Btn variant="outline" onClick={() => fileRef.current?.click()} data-testid="upload-logo-btn"><UploadSimple size={16} weight="bold" /> Upload logo</Btn>
              <Btn variant="ghost" onClick={resetLogo} data-testid="reset-logo-btn"><Trash size={16} /> Use default</Btn>
            </div>
          </div>
        </div>

        <div className="border border-border bg-card p-8 space-y-4" data-testid="company-card">
          <div className="overline text-muted-foreground">Company info (shown on quotes, sales orders & invoices)</div>
          <Inp label="Company name" value={form.company_name || ""} onChange={set("company_name")} testid="set-company-name" />
          <Inp label="Address" value={form.company_address || ""} onChange={set("company_address")} testid="set-company-address" />
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Phone" value={form.company_phone || ""} onChange={set("company_phone")} testid="set-company-phone" />
            <Inp label="Email" value={form.company_email || ""} onChange={set("company_email")} testid="set-company-email" />
          </div>
          <Inp label="Web address" value={form.company_web || ""} onChange={set("company_web")} testid="set-company-web" />
          <Inp label="Accounting / Xero email" value={form.accounting_email || ""} onChange={set("accounting_email")} testid="set-accounting-email" />
          <div className="text-xs text-muted-foreground -mt-2">Default recipient when you send an invoice + payment record to accounting.</div>
        </div>

        <div className="border border-border bg-card p-8 space-y-5">
          <div className="overline text-muted-foreground">Global rates used across all estimates</div>
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Shop labor rate ($/hr)" type="number" value={form.shop_rate_per_hr} onChange={set("shop_rate_per_hr")} testid="set-shop-rate" />
            <Inp label="Shop throughput (sqft/hr)" type="number" value={form.shop_sqft_per_hr} onChange={set("shop_sqft_per_hr")} testid="set-shop-sqft" />
            <Inp label="Machine rate ($/hr)" type="number" value={form.machine_rate_per_hr} onChange={set("machine_rate_per_hr")} testid="set-machine-rate" />
            <Inp label="Machine throughput (sqft/hr)" type="number" value={form.machine_sqft_per_hr} onChange={set("machine_sqft_per_hr")} testid="set-machine-sqft" />
          </div>
          <Inp label="Default material markup (× multiplier)" type="number" value={form.default_markup} onChange={set("default_markup")} testid="set-default-markup" />
          <Inp label="Default tax rate (%)" type="number" value={form.default_tax_rate ?? 0} onChange={set("default_tax_rate")} testid="set-default-tax-rate" />
          <div className="text-xs text-muted-foreground -mt-2">Applied automatically to new quotes, sales orders and invoices (editable per document).</div>
          <Inp label="Low-margin alert threshold (%)" type="number" value={form.low_margin_threshold ?? 0} onChange={set("low_margin_threshold")} testid="set-low-margin-threshold" />
          <div className="text-xs text-muted-foreground -mt-2">Estimates, sales orders and invoices whose material margin % falls below this are flagged in red. Set to 0 to disable.</div>
          <label className="flex items-center gap-2 cursor-pointer select-none pt-2" data-testid="set-surcharge-label">
            <input type="checkbox" checked={!!form.card_surcharge_enabled} onChange={(e) => setForm({ ...form, card_surcharge_enabled: e.target.checked })} data-testid="set-card-surcharge-enabled" className="h-4 w-4 accent-[#0A0A0A]" />
            <span className="text-sm">Add a card-processing surcharge to online payments</span>
          </label>
          {form.card_surcharge_enabled && (
            <Inp label="Card surcharge (%)" type="number" value={form.card_surcharge_pct ?? 0} onChange={set("card_surcharge_pct")} testid="set-card-surcharge-pct" />
          )}
          <div className="border-t border-border pt-4 text-sm text-muted-foreground font-mono">
            Per line: labor hrs = area ÷ {form.shop_sqft_per_hr} sqft/hr, machine hrs = area ÷ {form.machine_sqft_per_hr} sqft/hr. Line = (price/sqft × area) + ({currency(form.shop_rate_per_hr)} × labor hrs) + ({currency(form.machine_rate_per_hr)} × machine hrs)
          </div>
        </div>
      </div>
    </div>
  );
}
