"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Receipt, TrendingUp, Handshake, AlertTriangle, ArrowRight } from "lucide-react";
import { getDashboardData, type DashboardData } from "@/lib/services/dashboard";
import { StatCard } from "@/components/stat-card";
import { BarChart } from "@/components/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBRL, formatDate } from "@/lib/utils";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardData().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        Não foi possível carregar o dashboard: {error}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Visão geral da sua operação financeira.</p>
      </header>

      {!data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Clientes"
              value={String(data.totalClients)}
              hint="Total cadastrado"
              icon={<Users size={15} />}
            />
            <StatCard
              label="Em aberto"
              value={formatBRL(data.openAmount)}
              hint={
                data.overdueAmount > 0
                  ? `${formatBRL(data.overdueAmount)} em atraso`
                  : "Nada em atraso"
              }
              icon={data.overdueAmount > 0 ? <AlertTriangle size={15} /> : <Receipt size={15} />}
              tone={data.overdueAmount > 0 ? "danger" : "default"}
            />
            <StatCard
              label="Recebido no mês"
              value={formatBRL(data.receivedThisMonth)}
              hint="Cobranças pagas"
              icon={<TrendingUp size={15} />}
              tone="accent"
            />
            <StatCard
              label="Em negociação"
              value={String(data.activeNegotiations)}
              hint="Tratativas ativas"
              icon={<Handshake size={15} />}
              tone={data.activeNegotiations > 0 ? "warn" : "default"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Recebidos por mês</CardTitle>
                <span className="font-mono text-xs text-faint">últimos 6 meses</span>
              </CardHeader>
              <CardContent>
                <BarChart data={data.monthlySeries} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Cobranças recentes</CardTitle>
                <Link
                  href="/cobrancas"
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  Ver todas <ArrowRight size={12} />
                </Link>
              </CardHeader>
              {data.recentCharges.length === 0 ? (
                <EmptyState
                  icon={<Receipt size={18} />}
                  title="Nenhuma cobrança ainda"
                  description="Crie a primeira cobrança para acompanhar seus recebíveis aqui."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Cliente</TH>
                      <TH>Valor</TH>
                      <TH>Vencimento</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.recentCharges.map((c) => (
                      <TR key={c.id}>
                        <TD className="font-medium">{c.clients?.name ?? "—"}</TD>
                        <TD className="font-mono">{formatBRL(Number(c.amount))}</TD>
                        <TD className="text-muted">{formatDate(c.due_date)}</TD>
                        <TD><StatusBadge status={c.status} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
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
      <div className="h-72 animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
