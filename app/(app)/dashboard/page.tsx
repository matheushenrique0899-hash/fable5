"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Users,
  Handshake,
  AlertTriangle,
  Percent,
} from "lucide-react";
import { getDashboardData, type DashboardData } from "@/lib/services/dashboard";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatBRL } from "@/lib/utils";

// Cores dos segmentos do aging: verde → amarelo → laranja → vermelho
const AGING_COLORS = ["#3ECF8E", "#F5B94E", "#E8853D", "#F0645C", "#C0392B"];
const AGING_LINKS = [
  "/cobrancas",
  "/cobrancas?aging=d30",
  "/cobrancas?aging=d60",
  "/cobrancas?aging=d90",
  "/cobrancas?aging=d90p",
];

const PERIOD_OPTIONS = [
  { value: 3, label: "Últimos 3 meses" },
  { value: 6, label: "Últimos 6 meses" },
  { value: 12, label: "Últimos 12 meses" },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timelineMonths, setTimelineMonths] = useState(6);

  const load = useCallback(() => {
    getDashboardData().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const periodLabel = now
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(" de ", "/");

  if (error) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        Não foi possível carregar o dashboard: {error}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Visão geral da operação de cobrança.</p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-xs capitalize text-muted">
          {periodLabel}
        </span>
      </header>

      {!data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Em atraso"
              value={formatBRL(data.overdueAmount)}
              hint={
                <>
                  {data.overdueCount} {data.overdueCount === 1 ? "cobrança vencida" : "cobranças vencidas"}
                  {" · "}
                  <span
                    className={cn(
                      "font-medium",
                      data.overdueHealth.criticality === "saudavel" && "text-accent",
                      data.overdueHealth.criticality === "alerta" && "text-warn",
                      data.overdueHealth.criticality === "critico" && "text-danger"
                    )}
                  >
                    {data.overdueHealth.label} ({data.overdueHealth.over90Pct}% acima de 90d)
                  </span>
                </>
              }
              icon={<AlertTriangle size={15} />}
              tone={
                data.overdueHealth.criticality === "critico"
                  ? "danger"
                  : data.overdueHealth.criticality === "alerta"
                  ? "warn"
                  : data.overdueAmount > 0 ? "danger" : "default"
              }
              href="/cobrancas?status=atrasado"
            />
            <StatCard
              label="Recebido no mês"
              value={formatBRL(data.receivedThisMonth)}
              hint="Cobranças pagas"
              icon={<TrendingUp size={15} />}
              tone="accent"
              href="/cobrancas?status=pago"
            />
            <StatCard
              label="Recuperação no mês"
              value={data.recoveryRate === null ? "—" : `${data.recoveryRate}%`}
              hint={
                data.recoveryRate === null
                  ? "Sem vencimentos no período"
                  : "Recebido ÷ (recebido + vencido)"
              }
              icon={<Percent size={15} />}
              tone={
                data.recoveryRate === null
                  ? "default"
                  : data.recoveryRate >= 70
                  ? "accent"
                  : data.recoveryRate >= 40
                  ? "warn"
                  : "danger"
              }
              href="/cobrancas"
            />
            <StatCard
              label="Em negociação"
              value={String(data.activeNegotiations)}
              hint={`${formatBRL(data.negotiationsOpenValue)} em tratativa`}
              icon={<Handshake size={15} />}
              tone={data.activeNegotiations > 0 ? "warn" : "default"}
              href="/negociacao"
            />
          </div>

          {/* Aging da carteira */}
          <Card>
            <CardHeader>
              <CardTitle>Aging da carteira</CardTitle>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    data.overdueHealth.criticality === "saudavel" && "border-accent/25 bg-accent-soft text-accent",
                    data.overdueHealth.criticality === "alerta" && "border-warn/25 bg-warn-soft text-warn",
                    data.overdueHealth.criticality === "critico" && "border-danger/25 bg-danger-soft text-danger"
                  )}
                  title="Classificação baseada no % da carteira acima de 90 dias (benchmark de mercado)"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {data.overdueHealth.label} · {data.overdueHealth.over90Pct}% over 90
                </span>
                <span className="font-mono text-xs text-faint">
                  {formatBRL(data.aging.reduce((s, b) => s + b.amount, 0))} em aberto
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <AgingBar aging={data.aging} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* Funil de inadimplência */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Funil de inadimplência</CardTitle>
                <span className="font-mono text-xs text-faint">por clientes</span>
              </CardHeader>
              {data.clientsTotal === 0 ? (
                <EmptyState
                  icon={<Users size={18} />}
                  title="Sem clientes"
                  description="Cadastre clientes para ver o funil."
                  action={
                    <Link href="/clientes">
                      <Button size="sm">Cadastrar clientes</Button>
                    </Link>
                  }
                />
              ) : (
                <CardContent className="space-y-3">
                  {data.funnel.map((stage) => (
                    <Link key={stage.label} href={stage.href} className="group block">
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="text-muted transition-colors group-hover:text-fg">
                          {stage.label}
                        </span>
                        <span className="font-mono text-faint">
                          {stage.count} · {stage.pct}%
                        </span>
                      </div>
                      <div className="h-5 overflow-hidden rounded bg-raised">
                        <div
                          className="h-full rounded transition-all group-hover:opacity-80"
                          style={{
                            width: `${Math.max(stage.pct, stage.count > 0 ? 3 : 0)}%`,
                            backgroundColor: stage.color,
                          }}
                        />
                      </div>
                    </Link>
                  ))}
                </CardContent>
              )}
            </Card>

            {/* Linha do tempo de recuperação */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Linha do tempo de recuperação</CardTitle>
                <Select
                  value={timelineMonths}
                  onChange={(e) => setTimelineMonths(Number(e.target.value))}
                  className="h-8 w-auto text-xs"
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </CardHeader>
              {data.recoveryTimeline.every((m) => m.amount === 0) ? (
                <EmptyState
                  icon={<TrendingUp size={18} />}
                  title="Nenhum recebimento"
                  description="Nenhum pagamento registrado no período selecionado."
                  action={
                    <Link href="/cobrancas">
                      <Button size="sm">Registrar cobrança</Button>
                    </Link>
                  }
                />
              ) : (
                <CardContent className="space-y-3">
                  {data.recoveryTimeline.slice(0, timelineMonths).map((m) => {
                    const maxAmount = Math.max(
                      ...data.recoveryTimeline.slice(0, timelineMonths).map((x) => x.amount),
                      1
                    );
                    const pct = Math.round((m.amount / maxAmount) * 100);
                    return (
                      <div key={m.label}>
                        <div className="mb-1 flex items-baseline justify-between text-xs">
                          <span className="font-medium text-fg">{m.label}</span>
                          <span className="font-mono text-muted">
                            {formatBRL(m.amount)}
                            {m.count > 0 && (
                              <span className="ml-1.5 text-faint">
                                ({m.count} {m.count === 1 ? "cobrança" : "cobranças"})
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-raised">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${Math.max(pct, m.amount > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function AgingBar({ aging }: { aging: { label: string; amount: number; count: number }[] }) {
  const total = aging.reduce((s, b) => s + b.amount, 0);

  if (total === 0) {
    return (
      <p className="py-2 text-sm text-muted">
        Nenhum valor em aberto na carteira.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-raised">
        {aging.map((b, i) => {
          const pct = (b.amount / total) * 100;
          if (pct === 0) return null;
          return (
            <Link
              key={b.label}
              href={AGING_LINKS[i]}
              title={`${b.label}: ${formatBRL(b.amount)} (${b.count})`}
              className="h-full transition-opacity hover:opacity-80"
              style={{ width: `${pct}%`, backgroundColor: AGING_COLORS[i] }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {aging.map((b, i) => {
          const pct = total > 0 ? Math.round((b.amount / total) * 1000) / 10 : 0;
          return (
            <Link
              key={b.label}
              href={AGING_LINKS[i]}
              className={cn(
                "group flex items-center gap-2 text-xs",
                b.amount === 0 && "opacity-40"
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: AGING_COLORS[i] }}
              />
              <span className="text-muted group-hover:text-fg">{b.label}</span>
              <span className="font-mono text-faint">
                {formatBRL(b.amount)} <span className="text-faint/70">({pct}%)</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
      <div className="h-72 animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
