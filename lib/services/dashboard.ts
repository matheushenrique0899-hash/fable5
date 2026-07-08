import { createClient } from "@/lib/supabase/client";
import { computeAging, type AgingBucket } from "@/lib/services/charges";
import type { Charge } from "@/lib/types";

export interface FunnelStage {
  label: string;
  count: number;
  pct: number;
  href: string;
  color: string;
}

export interface DashboardData {
  overdueAmount: number;
  overdueCount: number;
  receivedThisMonth: number;
  recoveryRate: number | null;
  activeNegotiations: number;
  negotiationsOpenValue: number;
  aging: AgingBucket[];
  funnel: FunnelStage[];
  clientsTotal: number;
  priorities: Charge[];
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

  const [clientsRes, openRes, paidMonthRes, negRes, prioritiesRes] = await Promise.all([
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
      .select("*, clients(name, document, phone)")
      .eq("status", "atrasado")
      .order("due_date", { ascending: true })
      .limit(5),
  ]);

  const clientsTotal = clientsRes.count ?? 0;
  const open = openRes.data ?? [];
  const paidMonth = paidMonthRes.data ?? [];
  const negotiations = negRes.data ?? [];

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
    funnel,
    clientsTotal,
    priorities: (prioritiesRes.data ?? []) as Charge[],
  };
}
