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
  paid_total?: number; // soma dos pagamentos parciais (calculado no service)
}

export interface ChargePayment {
  id: string;
  owner_id: string;
  charge_id: string;
  amount: number;
  paid_date: string;
  created_at: string;
}

export interface NegotiationContact {
  id: string;
  owner_id: string;
  negotiation_id: string;
  contact_date: string;
  note: string;
  created_at: string;
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
  agreed_amount: number | null;
  agreed_installments: number | null;
  agreed_due: string | null;
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

export interface AgreementInstallment {
  id: string;
  owner_id: string;
  negotiation_id: string;
  installment_no: number;
  amount: number;
  due_date: string;
  paid_at: string | null;
  created_at: string;
}
