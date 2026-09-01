import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/Layout";
import { Btn, StatusBadge } from "@/components/kit";

const NEXT = { requested: "processing", processing: "completed" };

export default function Reorders() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/reorders").then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const advance = async (r) => {
    const status = NEXT[r.status];
    if (!status) return;
    await api.patch(`/reorders/${r.id}/status`, null, { params: { status } });
    toast.success(`Marked ${status}`); load();
  };

  return (
    <div>
      <PageHeader overline="Customer Portal" title="Reorder Requests" />
      <div className="p-8">
        <div className="border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left overline text-muted-foreground">
                <th className="px-6 py-3 font-mono">Customer</th>
                <th className="px-6 py-3 font-mono">Item</th>
                <th className="px-6 py-3 font-mono">Notes</th>
                <th className="px-6 py-3 font-mono">Status</th>
                <th className="px-6 py-3 font-mono text-right">Action</th>
              </tr>
            </thead>
            <tbody data-testid="reorders-table">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
                  <td className="px-6 py-3 font-medium">{r.customer_name}</td>
                  <td className="px-6 py-3">{r.title}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.notes || "—"}</td>
                  <td className="px-6 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-6 py-3 text-right">
                    {NEXT[r.status] && <Btn variant="ghost" onClick={() => advance(r)} data-testid={`advance-reorder-${r.id}`}>Mark {NEXT[r.status]}</Btn>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No reorder requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
