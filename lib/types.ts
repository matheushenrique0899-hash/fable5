export type ChargeStatus = "pendente" | "pago" | "atrasado";
export type NegotiationStatus =
  | "em_negociacao"
  | "aguardando_retorno"
  | "aceitou"
  | "recusou"
  | "nao_localizado";

export interface Client {
  id: string;
  owner_id: string;
  name: string;
  document: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

export interface Charge {
  id: string;
  owner_id: string;
  client_id: string;
  amount: number;
  due_date: string;
  sale_date: string | null;
  installments: number;
  status: ChargeStatus;
  description: string | null;
  paid_at: string | null;
  created_at: string;
  clients?: { name: string; document: string; phone?: string | null } | null;
}

export interface Negotiation {
  id: string;
  owner_id: string;
  client_id: string;
  status: NegotiationStatus;
  responsible: string | null;
  first_contact: string | null;
  last_contact: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  clients?: Pick<Client, "name" | "document"> | null;
}

export const NEGOTIATION_LABELS: Record<NegotiationStatus, string> = {
  em_negociacao: "Em negociação",
  aguardando_retorno: "Aguardando retorno",
  aceitou: "Aceitou",
  recusou: "Recusou",
  nao_localizado: "Não localizado",
};
