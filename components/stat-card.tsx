import { type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger";
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md border",
            tone === "accent" && "border-accent/25 bg-accent-soft text-accent",
            tone === "warn" && "border-warn/25 bg-warn-soft text-warn",
            tone === "danger" && "border-danger/25 bg-danger-soft text-danger",
            tone === "default" && "border-border bg-raised text-muted"
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
