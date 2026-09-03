import { Warning } from "@phosphor-icons/react";

// Renders a <td> with the material margin %, flagging low-margin rows in red.
export function MarginCell({ row, threshold = 0, testid }) {
  const pct = Number(row.material_margin_pct || 0);
  const low = row.has_cost_data && threshold > 0 && pct < threshold;
  return (
    <td className="px-6 py-3 text-right font-mono" data-testid={testid}>
      <span className={`font-semibold inline-flex items-center justify-end gap-0.5 ${low ? "text-destructive" : "text-[#16A34A]"}`}
        data-testid={low ? `low-margin-${row.id}` : undefined}>
        {low && <Warning size={12} weight="fill" />}{pct.toFixed(0)}%{low ? " · Low" : ""}
      </span>
    </td>
  );
}
