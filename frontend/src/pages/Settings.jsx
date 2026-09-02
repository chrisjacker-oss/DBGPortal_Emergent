import { useEffect, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import { Gear } from "@phosphor-icons/react";

export default function Settings() {
  const [form, setForm] = useState(null);

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
      });
      toast.success("Shop settings saved");
    } catch { toast.error("Save failed"); }
  };

  return (
    <div>
      <PageHeader overline="Configuration" title="Shop Settings">
        <Btn onClick={save} data-testid="save-settings-btn"><Gear size={16} weight="bold" /> Save</Btn>
      </PageHeader>
      <div className="p-8 max-w-2xl">
        <div className="border border-border bg-card p-8 space-y-5">
          <div className="overline text-muted-foreground">Global rates used across all estimates</div>
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Shop labor rate ($/hr)" type="number" value={form.shop_rate_per_hr} onChange={set("shop_rate_per_hr")} testid="set-shop-rate" />
            <Inp label="Shop throughput (sqft/hr)" type="number" value={form.shop_sqft_per_hr} onChange={set("shop_sqft_per_hr")} testid="set-shop-sqft" />
            <Inp label="Machine rate ($/hr)" type="number" value={form.machine_rate_per_hr} onChange={set("machine_rate_per_hr")} testid="set-machine-rate" />
            <Inp label="Machine throughput (sqft/hr)" type="number" value={form.machine_sqft_per_hr} onChange={set("machine_sqft_per_hr")} testid="set-machine-sqft" />
          </div>
          <Inp label="Default material markup (%)" type="number" value={form.default_markup} onChange={set("default_markup")} testid="set-default-markup" />
          <div className="border-t border-border pt-4 text-sm text-muted-foreground font-mono">
            Per line: labor hrs = area ÷ {form.shop_sqft_per_hr} sqft/hr, machine hrs = area ÷ {form.machine_sqft_per_hr} sqft/hr. Line = (price/sqft × area) + ({currency(form.shop_rate_per_hr)} × labor hrs) + ({currency(form.machine_rate_per_hr)} × machine hrs)
          </div>
        </div>
      </div>
    </div>
  );
}
