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

const PARTIAL_STYLE = "bg-warn-soft text-warn border-warn/25";
const PARTIAL_LABEL = "Pago parcial";

export function StatusBadge({
  status,
  hasPaidPartial,
  className,
}: {
  status: ChargeStatus;
  hasPaidPartial?: boolean;
  className?: string;
}) {
  // Se há pagamento parcial registrado e a cobrança ainda não foi quitada,
  // mostra "Pago parcial" no lugar do status real (que continua controlando
  // o aging e os filtros por trás — isto é só uma sobreposição visual).
  const showPartial = hasPaidPartial && status !== "pago";
  const style = showPartial ? PARTIAL_STYLE : styles[status];
  const label = showPartial ? PARTIAL_LABEL : labels[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style,
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
