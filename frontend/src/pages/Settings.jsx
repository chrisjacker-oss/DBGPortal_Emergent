import { useEffect, useRef, useState } from "react";
import api, { currency } from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn } from "@/components/kit";
import { Inp } from "@/pages/Customers";
import AdminDeleteDialog from "@/components/AdminDeleteDialog";
import {
  ArrowCounterClockwise,
  Database,
  DownloadSimple,
  Gear,
  Trash,
  UploadSimple,
  Warning,
} from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const LOGO_URL = `${process.env.REACT_APP_BACKEND_URL}/api/pub/logo`;

export default function Settings() {
  const [form, setForm] = useState(null);
  const [logoTs, setLogoTs] = useState(Date.now());
  const fileRef = useRef(null);
  const backupFileRef = useRef(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backupFile, setBackupFile] = useState(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [vaultBackups, setVaultBackups] = useState([]);
  const [vaultRunning, setVaultRunning] = useState(false);
  const [vaultDelete, setVaultDelete] = useState(null);

  const loadVault = () => api.get("/settings/backup-vault")
    .then((response) => setVaultBackups(response.data))
    .catch(() => setVaultBackups([]));
  useEffect(() => {
    api.get("/settings").then((r) => setForm(r.data));
    loadVault();
  }, []);
  if (!form) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    try {
      await api.put("/settings", {
        shop_rate_per_hr: Number(form.shop_rate_per_hr),
        shop_sqft_per_hr: Number(form.shop_sqft_per_hr),
        machine_rate_per_hr: Number(form.machine_rate_per_hr),
        machine_sqft_per_hr: Number(form.machine_sqft_per_hr),
        laminator_rate_per_hr: Number(form.laminator_rate_per_hr),
        laminator_sqft_per_hr: Number(form.laminator_sqft_per_hr),
        cnc_rate_per_min: Number(form.cnc_rate_per_min),
        design_rate_per_min: Number(form.design_rate_per_min),
        default_markup: Number(form.default_markup),
        default_tax_rate: Number(form.default_tax_rate),
        card_surcharge_enabled: !!form.card_surcharge_enabled,
        card_surcharge_pct: Number(form.card_surcharge_pct || 0),
        low_margin_threshold: Number(form.low_margin_threshold || 0),
        idle_timeout_min: Number(form.idle_timeout_min || 90),
        company_name: form.company_name || "",
        company_address: form.company_address || "",
        company_phone: form.company_phone || "",
        company_web: form.company_web || "",
        company_email: form.company_email || "",
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
  const downloadBackup = async () => {
    try {
      const response = await api.get("/settings/backup", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `dbg-signs-crm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("CRM backup downloaded");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Backup export failed");
    }
  };
  const closeRestore = () => {
    if (restoring) return;
    setRestoreOpen(false);
    setBackupFile(null);
    setRestorePassword("");
    setRestoreConfirmation("");
  };
  const restoreBackup = async () => {
    if (!backupFile) {
      toast.error("Choose a CRM backup file");
      return;
    }
    if (restoreConfirmation.trim().toUpperCase() !== "RESTORE") {
      toast.error('Type "RESTORE" to confirm');
      return;
    }
    setRestoring(true);
    const formData = new FormData();
    formData.append("file", backupFile);
    formData.append("password", restorePassword);
    formData.append("confirmation", restoreConfirmation);
    try {
      await api.post("/settings/restore", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("CRM restore completed. Signing out for a fresh session…");
      window.setTimeout(() => window.location.assign("/login"), 900);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Restore failed before any data was changed");
      setRestoring(false);
    }
  };
  const runVaultBackup = async () => {
    setVaultRunning(true);
    try {
      const { data } = await api.post("/settings/backup-vault/run");
      toast.success(`Backup saved · ${data.filename}`);
      loadVault();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not create the vault backup");
    } finally {
      setVaultRunning(false);
    }
  };
  const downloadVaultBackup = async (backup) => {
    try {
      const response = await api.get(`/settings/backup-vault/${backup.id}/download`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Vault backup downloaded");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Backup download failed");
    }
  };
  const removeVaultBackup = async (password) => {
    try {
      await api.delete(`/settings/backup-vault/${vaultDelete.id}`, { data: { password } });
      toast.success("Backup removed from the vault");
      setVaultDelete(null);
      loadVault();
      return true;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not remove backup");
      return false;
    }
  };
  const formatBytes = (bytes) => {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

        <div className="border border-border bg-card p-8 space-y-4" data-testid="backup-card">
          <div className="flex items-start gap-3">
            <Database size={22} weight="bold" className="mt-0.5 text-[#0E7490]" />
            <div>
              <div className="overline text-muted-foreground">CRM backup & restore</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Download a complete JSON copy of the CRM database for safe keeping.
                Restoring replaces the current CRM data with the selected backup.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Btn variant="outline" onClick={downloadBackup} data-testid="download-crm-backup-btn">
              <DownloadSimple size={16} weight="bold" /> Download backup
            </Btn>
            <Btn
              variant="danger"
              onClick={() => setRestoreOpen(true)}
              data-testid="open-crm-restore-btn"
            >
              <ArrowCounterClockwise size={16} weight="bold" /> Restore backup
            </Btn>
          </div>
        </div>

        <div className="border border-border bg-card p-8 space-y-4" data-testid="backup-vault-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Database size={22} weight="bold" className="mt-0.5 text-[#0E7490]" />
              <div>
                <div className="overline text-muted-foreground">Automatic backup vault</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  A complete CRM backup runs on the first of every month at 8:00 UTC.
                  Every saved copy stays here until an admin removes it.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  8:00 UTC is 2:00 AM Central Standard Time and 3:00 AM during daylight saving.
                </p>
              </div>
            </div>
            <Btn
              variant="outline"
              onClick={runVaultBackup}
              disabled={vaultRunning}
              data-testid="run-vault-backup-btn"
            >
              <UploadSimple size={16} weight="bold" />
              {vaultRunning ? "Saving…" : "Run backup now"}
            </Btn>
          </div>

          <div className="border border-border divide-y divide-border" data-testid="backup-vault-list">
            {vaultBackups.map((backup) => (
              <div
                key={backup.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                data-testid={`vault-backup-${backup.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm" data-testid={`vault-backup-name-${backup.id}`}>
                    {backup.filename}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(backup.created_at).toLocaleString()} · {formatBytes(backup.size)} ·
                    {" "}{backup.collection_count} collections · {backup.document_count} records ·
                    {" "}{backup.source === "monthly" ? "monthly" : "manual"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Btn
                    variant="outline"
                    onClick={() => downloadVaultBackup(backup)}
                    data-testid={`download-vault-backup-${backup.id}`}
                  >
                    <DownloadSimple size={16} weight="bold" /> Download
                  </Btn>
                  <Btn
                    variant="ghost"
                    onClick={() => setVaultDelete(backup)}
                    data-testid={`remove-vault-backup-${backup.id}`}
                  >
                    <Trash size={16} />
                  </Btn>
                </div>
              </div>
            ))}
            {vaultBackups.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="backup-vault-empty">
                No vault backups yet. The first monthly backup will appear here automatically.
              </div>
            )}
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
        </div>

        <div className="border border-border bg-card p-8 space-y-4" data-testid="security-card">
          <div className="overline text-muted-foreground">Security</div>
          <Inp label="Auto sign-out after inactivity (minutes)" type="number" value={form.idle_timeout_min ?? 90} onChange={set("idle_timeout_min")} testid="set-idle-timeout" />
          <div className="text-xs text-muted-foreground -mt-2">Signed-in users get a 1-minute warning, then are signed out after this many idle minutes. Applies to everyone.</div>
        </div>

        <div className="border border-border bg-card p-8 space-y-5">
          <div className="overline text-muted-foreground">Global rates used across all estimates</div>
          <div className="grid grid-cols-2 gap-4">
            <Inp label="Shop labor rate ($/hr)" type="number" value={form.shop_rate_per_hr} onChange={set("shop_rate_per_hr")} testid="set-shop-rate" />
            <Inp label="Shop throughput (sqft/hr)" type="number" value={form.shop_sqft_per_hr} onChange={set("shop_sqft_per_hr")} testid="set-shop-sqft" />
            <Inp label="Machine rate ($/hr)" type="number" value={form.machine_rate_per_hr} onChange={set("machine_rate_per_hr")} testid="set-machine-rate" />
            <Inp label="Machine throughput (sqft/hr)" type="number" value={form.machine_sqft_per_hr} onChange={set("machine_sqft_per_hr")} testid="set-machine-sqft" />
            <Inp label="Laminator rate ($/hr)" type="number" value={form.laminator_rate_per_hr} onChange={set("laminator_rate_per_hr")} testid="set-laminator-rate" />
            <Inp label="Laminator throughput (sqft/hr)" type="number" value={form.laminator_sqft_per_hr} onChange={set("laminator_sqft_per_hr")} testid="set-laminator-sqft" />
            <Inp label="CNC Router rate ($/min)" type="number" value={form.cnc_rate_per_min} onChange={set("cnc_rate_per_min")} testid="set-cnc-rate" />
            <Inp label="Design Time rate ($/min)" type="number" value={form.design_rate_per_min} onChange={set("design_rate_per_min")} testid="set-design-rate" />
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

      <Dialog open={restoreOpen} onOpenChange={(open) => !open && closeRestore()}>
        <DialogContent className="rounded-none max-w-lg" data-testid="crm-restore-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Restore CRM backup</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              This permanently replaces current CRM database records with the selected backup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div
              className="flex gap-3 border border-[#DC2626]/30 bg-[#DC2626]/5 p-3 text-sm"
              data-testid="crm-restore-warning"
            >
              <Warning size={20} weight="fill" className="shrink-0 text-[#DC2626]" />
              <span>Back up current data first. You will need to sign in again after restoring.</span>
            </div>
            <label className="block">
              <span className="overline text-muted-foreground">Backup file (.json)</span>
              <input
                ref={backupFileRef}
                type="file"
                accept=".json,application/json"
                disabled={restoring}
                onChange={(event) => setBackupFile(event.target.files?.[0] || null)}
                data-testid="crm-restore-file-input"
                className="mt-1 w-full border border-input bg-card px-3 py-2 text-sm rounded-none file:mr-3 file:border-0 file:bg-foreground file:text-primary-foreground file:px-3 file:py-1 file:text-xs"
              />
              {backupFile && (
                <div className="mt-1 text-xs text-muted-foreground" data-testid="crm-restore-file-name">
                  {backupFile.name}
                </div>
              )}
            </label>
            <Inp
              label="Admin password"
              type="password"
              value={restorePassword}
              onChange={(event) => setRestorePassword(event.target.value)}
              testid="crm-restore-password"
            />
            <Inp
              label='Type "RESTORE" to confirm'
              value={restoreConfirmation}
              onChange={(event) => setRestoreConfirmation(event.target.value)}
              testid="crm-restore-confirmation"
            />
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={closeRestore} disabled={restoring} data-testid="cancel-crm-restore-btn">
              Cancel
            </Btn>
            <Btn
              variant="danger"
              onClick={restoreBackup}
              disabled={restoring || !backupFile || !restorePassword}
              data-testid="confirm-crm-restore-btn"
            >
              {restoring ? "Restoring…" : "Replace CRM data"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AdminDeleteDialog
        open={!!vaultDelete}
        label={vaultDelete?.filename || "backup"}
        onClose={() => setVaultDelete(null)}
        onConfirm={removeVaultBackup}
      />
    </div>
  );
}
