import { createClient } from "@/lib/supabase/client";
import type { Negotiation, NegotiationStatus } from "@/lib/types";

export async function listNegotiations(status?: NegotiationStatus | "todas") {
  const supabase = createClient();
  let query = supabase
    .from("negotiations")
    .select("*, clients(name, document)")
    .order("updated_at", { ascending: false });
  if (status && status !== "todas") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Negotiation[];
}

export interface NegotiationInput {
  client_id: string;
  status: NegotiationStatus;
  responsible?: string;
  first_contact?: string;
  last_contact?: string;
  notes?: string;
}

export async function createNegotiation(input: NegotiationInput) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");
  const { error } = await supabase.from("negotiations").insert({
    owner_id: user.id,
    client_id: input.client_id,
    status: input.status,
    responsible: input.responsible?.trim() || null,
    first_contact: input.first_contact || null,
    last_contact: input.last_contact || null,
    notes: input.notes?.trim() || null,
  });
  if (error) throw error;
}

export async function updateNegotiation(id: string, input: Partial<NegotiationInput>) {
  const supabase = createClient();
  const { error } = await supabase.from("negotiations").update({
    ...(input.status && { status: input.status }),
    responsible: input.responsible?.trim() || null,
    first_contact: input.first_contact || null,
    last_contact: input.last_contact || null,
    notes: input.notes?.trim() || null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteNegotiation(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("negotiations").delete().eq("id", id);
  if (error) throw error;
}

// IDs dos clientes com negociação ativa (para o indicador na aba Cobranças)
export async function listActiveNegotiationClientIds(): Promise<Set<string>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("negotiations")
    .select("client_id")
    .in("status", ["em_negociacao", "aguardando_retorno"]);
  if (error) throw error;
  return new Set((data ?? []).map((n) => n.client_id));
}
