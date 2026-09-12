"use client";

import { formatBRL } from "@/lib/utils";

export function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-48 items-end gap-3">
      {data.map((d) => {
        const h = Math.max((d.value / max) * 100, d.value > 0 ? 4 : 1.5);
        return (
          <div key={d.label} className="group flex flex-1 flex-col items-center gap-2">
            <span className="font-mono text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
              {formatBRL(d.value)}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-sm bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${h}%` }}
              />
            </div>
            <span className="text-xs capitalize text-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
