import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/services/fetch-all";
import type { Negotiation, NegotiationStatus, NegotiationContact, NegotiationArgument } from "@/lib/types";

export async function listNegotiations(status?: NegotiationStatus | "todas") {
  const supabase = createClient();
  return fetchAllRows<Negotiation>((from, to) => {
    let query = supabase
      .from("negotiations")
      .select("*, clients(name, document)")
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (status && status !== "todas") query = query.eq("status", status);
    return query;
  });
}

export interface NegotiationInput {
  client_id: string;
  status: NegotiationStatus;
  responsible?: string;
  first_contact?: string;
  last_contact?: string;
  notes?: string;
  argument?: NegotiationArgument | null;
  agreed_amount?: number | null;
  agreed_installments?: number | null;
  agreed_due?: string | null;
  promised_payment_date?: string | null;
  promised_payment_amount?: number | null;
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
    argument: input.argument ?? null,
    agreed_amount: input.agreed_amount ?? null,
    agreed_installments: input.agreed_installments ?? null,
    agreed_due: input.agreed_due || null,
    promised_payment_date: input.promised_payment_date || null,
    promised_payment_amount: input.promised_payment_amount ?? null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteNegotiation(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("negotiations").delete().eq("id", id);
  if (error) throw error;
}

// Busca, em lote, o contato mais recente de cada negociação (para mostrar
// a última nota direto na listagem, sem precisar abrir o histórico).
// Mesmo padrão de listCharges: busca tudo em blocos de 200 ids e reduz no
// cliente, em vez de depender de window function no banco.
export async function listLastContacts(
  negotiationIds: string[]
): Promise<Map<string, NegotiationContact>> {
  const map = new Map<string, NegotiationContact>();
  const uniqueIds = Array.from(new Set(negotiationIds));
  if (uniqueIds.length === 0) return map;

  const supabase = createClient();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const { data } = await supabase
      .from("negotiation_contacts")
      .select("*")
      .in("negotiation_id", chunk);
    (data ?? []).forEach((c: any) => {
      const current = map.get(c.negotiation_id);
      const isNewer =
        !current ||
        c.contact_date > current.contact_date ||
        (c.contact_date === current.contact_date && c.created_at > current.created_at);
      if (isNewer) map.set(c.negotiation_id, c as NegotiationContact);
    });
  }
  return map;
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

// ---------- Histórico de contatos ----------
export async function listContacts(negotiationId: string): Promise<NegotiationContact[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("negotiation_contacts")
    .select("*")
    .eq("negotiation_id", negotiationId)
    .order("contact_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NegotiationContact[];
}

// Adiciona um contato e mantém first/last_contact da negociação sincronizados
export async function addContact(
  negotiation: Pick<Negotiation, "id" | "first_contact" | "last_contact">,
  contactDate: string,
  note: string
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const { error } = await supabase.from("negotiation_contacts").insert({
    owner_id: user.id,
    negotiation_id: negotiation.id,
    contact_date: contactDate,
    note: note.trim(),
  });
  if (error) throw error;

  const updates: Record<string, string> = {};
  if (!negotiation.first_contact || contactDate < negotiation.first_contact)
    updates.first_contact = contactDate;
  if (!negotiation.last_contact || contactDate > negotiation.last_contact)
    updates.last_contact = contactDate;
  if (Object.keys(updates).length > 0) {
    await supabase.from("negotiations").update(updates).eq("id", negotiation.id);
  }
}

// Registra que o operador abriu uma cobrança no WhatsApp.
// Se o cliente ainda não tiver uma negociação ativa, cria uma automaticamente.
export async function logWhatsAppContact(clientId: string, note: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  let { data: negotiation, error: negotiationError } = await supabase
    .from("negotiations")
    .select("id, first_contact, last_contact")
    .eq("owner_id", user.id)
    .eq("client_id", clientId)
    .in("status", ["em_negociacao", "aguardando_retorno"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (negotiationError) throw negotiationError;

  if (!negotiation) {
    const { data: created, error: createError } = await supabase
      .from("negotiations")
      .insert({
        owner_id: user.id,
        client_id: clientId,
        status: "em_negociacao",
      })
      .select("id, first_contact, last_contact")
      .single();
    if (createError) throw createError;
    negotiation = created;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error: contactError } = await supabase.from("negotiation_contacts").insert({
    owner_id: user.id,
    negotiation_id: negotiation.id,
    contact_date: today,
    note: note.trim(),
  });
  if (contactError) throw contactError;

  const updates: Record<string, string> = {};
  if (!negotiation.first_contact || today < negotiation.first_contact) updates.first_contact = today;
  if (!negotiation.last_contact || today > negotiation.last_contact) updates.last_contact = today;
  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("negotiations")
      .update(updates)
      .eq("id", negotiation.id);
    if (updateError) throw updateError;
  }
}

export async function deleteContact(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("negotiation_contacts").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Parcelas do acordo ----------
import type { AgreementInstallment } from "@/lib/types";

export async function listInstallments(negotiationId: string): Promise<AgreementInstallment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("agreement_installments")
    .select("*")
    .eq("negotiation_id", negotiationId)
    .order("installment_no");
  if (error) throw error;
  return (data ?? []) as AgreementInstallment[];
}

// Gera as N parcelas do acordo.
// Se já existirem parcelas para esta negociação, apaga e recria.
export async function generateInstallments(
  negotiationId: string,
  totalAmount: number,
  numInstallments: number,
  firstDue: string // YYYY-MM-DD
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada.");

  // Remove anteriores
  await supabase
    .from("agreement_installments")
    .delete()
    .eq("negotiation_id", negotiationId);

  const installmentAmount = Math.floor((totalAmount / numInstallments) * 100) / 100;
  const lastAmount = Math.round((totalAmount - installmentAmount * (numInstallments - 1)) * 100) / 100;

  const rows = Array.from({ length: numInstallments }, (_, i) => {
    const due = new Date(firstDue + "T12:00:00");
    due.setMonth(due.getMonth() + i);
    return {
      owner_id: user.id,
      negotiation_id: negotiationId,
      installment_no: i + 1,
      amount: i === numInstallments - 1 ? lastAmount : installmentAmount,
      due_date: due.toISOString().slice(0, 10),
    };
  });

  const { error } = await supabase.from("agreement_installments").insert(rows);
  if (error) throw error;
}

export async function payInstallment(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("agreement_installments")
    .update({ paid_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function unpayInstallment(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("agreement_installments")
    .update({ paid_at: null })
    .eq("id", id);
  if (error) throw error;
}

// Registra o acordo como observação nas cobranças em aberto do cliente
export async function applyAgreementToCharges(
  clientId: string,
  agreedAmount: number,
  installments: number,
  firstDue: string
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const dueBR = firstDue.split("-").reverse().join("/");
  const note = `Acordo: ${installments}x de R$ ${(agreedAmount / installments).toFixed(2).replace(".", ",")} (total R$ ${agreedAmount.toFixed(2).replace(".", ",")}), 1º venc. ${dueBR}`;

  // Aplica nas cobranças não pagas do cliente
  await supabase
    .from("charges")
    .update({ observation: note })
    .eq("owner_id", user.id)
    .eq("client_id", clientId)
    .neq("status", "pago");
}

// Prioridades de cobrança: cobranças atrasadas ordenadas pelo maior tempo de atraso.
// Usada na aba Negociação para o operador saber por onde começar.
export async function listCollectionPriorities(limit = 10) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("charges")
    .select("*, clients(name, document, phone)")
    .eq("status", "atrasado")
    .order("amount", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
