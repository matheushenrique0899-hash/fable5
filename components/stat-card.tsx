import { type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  hint?: ReactNode;
  icon: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger";
  href?: string;
}

export function StatCard({ label, value, hint, icon, tone = "default", href }: StatCardProps) {
  const inner = (
    <>
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
      <p className="mt-3 truncate font-mono text-xl font-semibold tracking-tight text-fg sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );

  const base = "block rounded-lg border border-border bg-surface p-5 shadow-card";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, "transition-colors hover:border-border-strong hover:bg-raised/40")}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
