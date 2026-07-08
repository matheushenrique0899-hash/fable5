import { createClient } from "@/lib/supabase/client";
import type { Charge, ChargeStatus } from "@/lib/types";

export async function refreshOverdue() {
  const supabase = createClient();
  await supabase.rpc("refresh_overdue_charges");
}

export async function listCharges(status?: ChargeStatus | "todas") {
  const supabase = createClient();
  let query = supabase
    .from("charges")
    .select("*, clients(name, document, phone)")
    .order("due_date", { ascending: true });
  if (status && status !== "todas") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  const charges = (data ?? []) as Charge[];

  // Anexa a soma dos pagamentos parciais de cada cobrança
  if (charges.length > 0) {
    const { data: payments } = await supabase
      .from("charge_payments")
      .select("charge_id, amount")
      .in("charge_id", charges.map((c) => c.id));
    const paidMap = new Map<string, number>();
    (payments ?? []).forEach((p) => {
      paidMap.set(p.charge_id, (paidMap.get(p.charge_id) ?? 0) + Number(p.amount));
    });
    charges.forEach((c) => { c.paid_total = paidMap.get(c.id) ?? 0; });
  }
  return charges;
}

export async function createCharge(input: {
  client_id: string;
  amount: number;
  due_date: string;
  sale_date?: string;
  installments?: number;
  description?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");
  const { error } = await supabase.from("charges").insert({
    owner_id: user.id,
    client_id: input.client_id,
    amount: input.amount,
    due_date: input.due_date,
    sale_date: input.sale_date || null,
    installments: input.installments ?? 1,
    description: input.description?.trim() || null,
  });
  if (error) throw error;
}

// Registra um pagamento (total ou parcial). Quita a cobrança quando o
// acumulado atinge o valor devido. Retorna o saldo restante.
export async function registerPayment(
  chargeId: string,
  amount: number,
  paidDate?: string
): Promise<{ remaining: number; settled: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const date = paidDate || new Date().toISOString().slice(0, 10);

  const { data: charge, error: ce } = await supabase
    .from("charges")
    .select("amount")
    .eq("id", chargeId)
    .single();
  if (ce) throw ce;

  const { data: prev } = await supabase
    .from("charge_payments")
    .select("amount")
    .eq("charge_id", chargeId);
  const alreadyPaid = (prev ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const total = Number(charge.amount);

  if (amount <= 0) throw new Error("O valor do pagamento precisa ser maior que zero.");
  if (alreadyPaid + amount > total + 0.009)
    throw new Error(
      `Valor acima do saldo. Restam R$ ${(total - alreadyPaid).toFixed(2).replace(".", ",")}.`
    );

  const { error: pe } = await supabase.from("charge_payments").insert({
    owner_id: user.id,
    charge_id: chargeId,
    amount,
    paid_date: date,
  });
  if (pe) throw pe;

  const newPaid = alreadyPaid + amount;
  const settled = newPaid >= total - 0.009;

  if (settled) {
    const paid_at = new Date(date + "T12:00:00").toISOString();
    const { error } = await supabase
      .from("charges")
      .update({ status: "pago", paid_at })
      .eq("id", chargeId);
    if (error) throw error;
  }

  return { remaining: Math.max(total - newPaid, 0), settled };
}

// Quitação total em um clique (usada no Dashboard): paga o saldo restante
export async function markAsPaid(id: string, paidDate?: string) {
  const supabase = createClient();
  const { data: charge, error: ce } = await supabase
    .from("charges")
    .select("amount")
    .eq("id", id)
    .single();
  if (ce) throw ce;
  const { data: prev } = await supabase
    .from("charge_payments")
    .select("amount")
    .eq("charge_id", id);
  const alreadyPaid = (prev ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(charge.amount) - alreadyPaid;
  if (remaining <= 0.009) {
    // Já quitada por pagamentos: só garante o status
    const paid_at = new Date((paidDate || new Date().toISOString().slice(0, 10)) + "T12:00:00").toISOString();
    await supabase.from("charges").update({ status: "pago", paid_at }).eq("id", id);
    return;
  }
  await registerPayment(id, remaining, paidDate);
}

export async function updateCharge(id: string, input: {
  amount: number;
  due_date: string;
  sale_date?: string;
  installments?: number;
  description?: string;
}) {
  const supabase = createClient();
  const { error } = await supabase.from("charges").update({
    amount: input.amount,
    due_date: input.due_date,
    sale_date: input.sale_date || null,
    installments: input.installments ?? 1,
    description: input.description?.trim() || null,
  }).eq("id", id);
  if (error) throw error;
}

// Cria uma negociação para o cliente da cobrança, se ainda não houver uma ativa
export async function ensureNegotiationForClient(clientId: string): Promise<"criada" | "existente"> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const { data: existing, error: selectErr } = await supabase
    .from("negotiations")
    .select("id")
    .eq("owner_id", user.id)
    .eq("client_id", clientId)
    .in("status", ["em_negociacao", "aguardando_retorno"])
    .limit(1);

  if (selectErr) throw selectErr;
  if (existing && existing.length > 0) return "existente";

  const { error } = await supabase.from("negotiations").insert({
    owner_id: user.id,
    client_id: clientId,
    status: "em_negociacao",
  });
  if (error) throw error;
  return "criada";
}

export async function deleteCharge(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("charges").delete().eq("id", id);
  if (error) throw error;
}

// Faixas de atraso (aging) das cobranças em aberto
export interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

export function computeAging(charges: Charge[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "Em dia", amount: 0, count: 0 },
    { label: "1–30 dias", amount: 0, count: 0 },
    { label: "31–60 dias", amount: 0, count: 0 },
    { label: "61–90 dias", amount: 0, count: 0 },
    { label: "+90 dias", amount: 0, count: 0 },
  ];
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (const c of charges) {
    if (c.status === "pago") continue;
    const due = new Date(c.due_date + "T23:59:59");
    const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
    const idx = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[idx].amount += Number(c.amount);
    buckets[idx].count += 1;
  }
  return buckets;
}
