import { createClient } from "@/lib/supabase/client";
import type { Charge } from "@/lib/types";

export interface DashboardData {
  totalClients: number;
  openAmount: number;
  overdueAmount: number;
  receivedThisMonth: number;
  activeNegotiations: number;
  monthlySeries: { label: string; value: number }[];
  recentCharges: Charge[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = createClient();
  await supabase.rpc("refresh_overdue_charges");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [clientsRes, openRes, paidRes, negotiationsRes, recentRes] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("charges").select("amount, status").in("status", ["pendente", "atrasado"]),
    supabase.from("charges").select("amount, paid_at").eq("status", "pago").gte("paid_at", sixMonthsAgo),
    supabase
      .from("negotiations")
      .select("id", { count: "exact", head: true })
      .in("status", ["em_negociacao", "aguardando_retorno"]),
    supabase.from("charges").select("*, clients(name, document)").order("created_at", { ascending: false }).limit(5),
  ]);

  const open = openRes.data ?? [];
  const paid = paidRes.data ?? [];

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
    totalClients: clientsRes.count ?? 0,
    openAmount: open.reduce((s, c) => s + Number(c.amount), 0),
    overdueAmount: open.filter((c) => c.status === "atrasado").reduce((s, c) => s + Number(c.amount), 0),
    receivedThisMonth: paid
      .filter((c) => c.paid_at && c.paid_at >= monthStart)
      .reduce((s, c) => s + Number(c.amount), 0),
    activeNegotiations: negotiationsRes.count ?? 0,
    monthlySeries,
    recentCharges: (recentRes.data ?? []) as Charge[],
  };
}
