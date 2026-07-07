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
    .select("*, clients(name, document)")
    .order("due_date", { ascending: true });
  if (status && status !== "todas") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Charge[];
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

export async function markAsPaid(id: string, paidDate?: string) {
  const supabase = createClient();
  // paidDate vem como YYYY-MM-DD; guarda ao meio-dia para evitar troca de fuso
  const paid_at = paidDate
    ? new Date(paidDate + "T12:00:00").toISOString()
    : new Date().toISOString();
  const { error } = await supabase
    .from("charges")
    .update({ status: "pago", paid_at })
    .eq("id", id);
  if (error) throw error;
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

  const { data: existing } = await supabase
    .from("negotiations")
    .select("id")
    .eq("owner_id", user.id)
    .eq("client_id", clientId)
    .in("status", ["em_negociacao", "aguardando_retorno"])
    .maybeSingle();

  if (existing) return "existente";

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
