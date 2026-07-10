import { createClient } from "@/lib/supabase/client";
import { computeAging, computeOverdueHealth, type AgingBucket, type OverdueHealth } from "@/lib/services/charges";
import type { Charge } from "@/lib/types";

export interface FunnelStage {
  label: string;
  count: number;
  pct: number;
  href: string;
  color: string;
}

export interface RecoveryMonth {
  label: string;   // "Ago/2026"
  amount: number;
  count: number;
}

export interface DashboardData {
  overdueAmount: number;
  overdueCount: number;
  receivedThisMonth: number;
  recoveryRate: number | null;
  activeNegotiations: number;
  negotiationsOpenValue: number;
  aging: AgingBucket[];
  overdueHealth: OverdueHealth;
  funnel: FunnelStage[];
  clientsTotal: number;
  recoveryTimeline: RecoveryMonth[]; // últimos 12 meses, mais recente primeiro
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = createClient();
  await supabase.rpc("refresh_overdue_charges");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartISO = monthStart.toISOString();
  const monthStartDate = monthStartISO.slice(0, 10);
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

  const [clientsRes, openRes, paidMonthRes, negRes, paidYearRes] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase
      .from("charges")
      .select("amount, status, due_date, client_id")
      .in("status", ["pendente", "atrasado"]),
    supabase
      .from("charges")
      .select("amount, paid_at, client_id")
      .eq("status", "pago")
      .gte("paid_at", monthStartISO),
    supabase
      .from("negotiations")
      .select("client_id")
      .in("status", ["em_negociacao", "aguardando_retorno"]),
    supabase
      .from("charges")
      .select("amount, paid_at")
      .eq("status", "pago")
      .gte("paid_at", twelveMonthsAgo),
  ]);

  const clientsTotal = clientsRes.count ?? 0;
  const open = openRes.data ?? [];
  const paidMonth = paidMonthRes.data ?? [];
  const negotiations = negRes.data ?? [];
  const paidYear = paidYearRes.data ?? [];

  // Em atraso
  const overdue = open.filter((c) => c.status === "atrasado");
  const overdueAmount = overdue.reduce((s, c) => s + Number(c.amount), 0);

  // Recebido no mês
  const receivedThisMonth = paidMonth.reduce((s, c) => s + Number(c.amount), 0);

  // Taxa de recuperação: recebido no mês ÷ (recebido no mês + total ainda em atraso hoje)
  // Responde: "do que estava devendo, quanto recuperamos este mês?"
  const totalOverdue = overdue.reduce((s, c) => s + Number(c.amount), 0);
  const denom = receivedThisMonth + totalOverdue;
  const recoveryRate = denom > 0 ? Math.round((receivedThisMonth / denom) * 100) : null;

  // Em negociação
  const negClientIds = new Set(negotiations.map((n) => n.client_id));
  const negotiationsOpenValue = open
    .filter((c) => negClientIds.has(c.client_id))
    .reduce((s, c) => s + Number(c.amount), 0);

  // Aging
  const aging = computeAging(open as Charge[]);
  const overdueHealth = computeOverdueHealth(aging);

  // Funil de inadimplência (por CLIENTES, não cobranças)
  const withOpenIds = new Set(open.map((c) => c.client_id));
  const overdueIds = new Set(overdue.map((c) => c.client_id));
  const recoveredIds = new Set(paidMonth.map((c) => c.client_id));

  const pct = (n: number) =>
    clientsTotal > 0 ? Math.round((n / clientsTotal) * 100) : 0;

  const funnel: FunnelStage[] = [
    {
      label: "Total de clientes",
      count: clientsTotal,
      pct: clientsTotal > 0 ? 100 : 0,
      href: "/clientes",
      color: "#5B6372",
    },
    {
      label: "Com cobranças em aberto",
      count: withOpenIds.size,
      pct: pct(withOpenIds.size),
      href: "/cobrancas",
      color: "#F5B94E",
    },
    {
      label: "Em atraso",
      count: overdueIds.size,
      pct: pct(overdueIds.size),
      href: "/cobrancas?status=atrasado",
      color: "#F0645C",
    },
    {
      label: "Em negociação",
      count: negClientIds.size,
      pct: pct(negClientIds.size),
      href: "/negociacao",
      color: "#E8853D",
    },
    {
      label: "Recuperados no mês",
      count: recoveredIds.size,
      pct: pct(recoveredIds.size),
      href: "/cobrancas?status=pago",
      color: "#3ECF8E",
    },
  ];

  return {
    overdueAmount,
    overdueCount: overdue.length,
    receivedThisMonth,
    recoveryRate,
    activeNegotiations: negotiations.length,
    negotiationsOpenValue,
    aging,
    overdueHealth,
    funnel,
    clientsTotal,
    recoveryTimeline: buildRecoveryTimeline(paidYear, now),
  };
}

// Monta a lista dos últimos 12 meses (mais recente primeiro) com o valor
// e a quantidade de cobranças recuperadas em cada um.
function buildRecoveryTimeline(
  paidYear: { amount: number; paid_at: string | null }[],
  now: Date
): RecoveryMonth[] {
  const months: RecoveryMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d
      .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
      .replace(".", "")
      .replace(/^(\w)/, (m) => m.toUpperCase())
      .replace(" de ", "/");
    const inMonth = paidYear.filter((c) => {
      if (!c.paid_at) return false;
      const p = new Date(c.paid_at);
      return p.getFullYear() === d.getFullYear() && p.getMonth() === d.getMonth();
    });
    months.push({
      label,
      amount: inMonth.reduce((s, c) => s + Number(c.amount), 0),
      count: inMonth.length,
    });
  }
  return months;
}
