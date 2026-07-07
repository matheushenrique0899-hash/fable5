import { createClient } from "@/lib/supabase/client";
import { computeAging, type AgingBucket } from "@/lib/services/charges";
import type { Charge } from "@/lib/types";

export interface DashboardData {
  overdueAmount: number;
  overdueCount: number;
  receivedThisMonth: number;
  recoveryRate: number | null; // null = sem base de cálculo no mês
  activeNegotiations: number;
  negotiationsOpenValue: number;
  aging: AgingBucket[];
  monthlySeries: { label: string; value: number }[];
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
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [openRes, paidRes, negRes, prioritiesRes] = await Promise.all([
    supabase
      .from("charges")
      .select("amount, status, due_date, client_id")
      .in("status", ["pendente", "atrasado"]),
    supabase
      .from("charges")
      .select("amount, paid_at")
      .eq("status", "pago")
      .gte("paid_at", sixMonthsAgo),
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

  const open = openRes.data ?? [];
  const paid = paidRes.data ?? [];
  const negotiations = negRes.data ?? [];

  // Em atraso
  const overdue = open.filter((c) => c.status === "atrasado");
  const overdueAmount = overdue.reduce((s, c) => s + Number(c.amount), 0);

  // Recebido no mês
  const receivedThisMonth = paid
    .filter((c) => c.paid_at && c.paid_at >= monthStartISO)
    .reduce((s, c) => s + Number(c.amount), 0);

  // Taxa de recuperação: recebido no mês ÷ (recebido + vencido não pago no mês)
  const dueUnpaidThisMonth = open
    .filter((c) => c.due_date >= monthStartDate && c.due_date < nextMonthDate)
    .reduce((s, c) => s + Number(c.amount), 0);
  const denom = receivedThisMonth + dueUnpaidThisMonth;
  const recoveryRate = denom > 0 ? Math.round((receivedThisMonth / denom) * 100) : null;

  // Em negociação: qtd + valor em aberto dos clientes em tratativa
  const negClientIds = new Set(negotiations.map((n) => n.client_id));
  const negotiationsOpenValue = open
    .filter((c) => negClientIds.has(c.client_id))
    .reduce((s, c) => s + Number(c.amount), 0);

  // Aging da carteira (mesmos buckets da aba Negociação)
  const aging = computeAging(open as Charge[]);

  // Série mensal de recebidos
  const monthlySeries: { label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    const value = paid
      .filter((c) => {
        if (!c.paid_at) return false;
        const p = new Date(c.paid_at);
        return p.getFullYear() === d.getFullYear() && p.getMonth() === d.getMonth();
      })
      .reduce((s, c) => s + Number(c.amount), 0);
    monthlySeries.push({ label, value });
  }

  return {
    overdueAmount,
    overdueCount: overdue.length,
    receivedThisMonth,
    recoveryRate,
    activeNegotiations: negotiations.length,
    negotiationsOpenValue,
    aging,
    monthlySeries,
    priorities: (prioritiesRes.data ?? []) as Charge[],
  };
}
