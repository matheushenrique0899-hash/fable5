import { cn } from "@/lib/utils";
import type { ChargeStatus } from "@/lib/types";

const styles: Record<ChargeStatus, string> = {
  pendente: "bg-warn-soft text-warn border-warn/25",
  pago: "bg-accent-soft text-accent border-accent/25",
  atrasado: "bg-danger-soft text-danger border-danger/25",
};

const labels: Record<ChargeStatus, string> = {
  pendente: "Pendente",
  pago: "Pago",
  atrasado: "Atrasado",
};

export function StatusBadge({ status, className }: { status: ChargeStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[status],
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  );
}
