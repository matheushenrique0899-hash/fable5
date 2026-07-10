import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/types";
import { onlyDigits } from "@/lib/utils";
import { fetchAllRows } from "@/lib/services/fetch-all";

const PAGE_SIZE = 10;

export async function listClients(opts: { search?: string; page?: number }) {
  const supabase = createClient();
  const page = opts.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("clients")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (opts.search?.trim()) {
    const s = opts.search.trim();
    query = query.or(`name.ilike.%${s}%,document.ilike.%${onlyDigits(s) || s}%,email.ilike.%${s}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { clients: (data ?? []) as Client[], total: count ?? 0, pageSize: PAGE_SIZE };
}

export async function listAllClientsLite() {
  const supabase = createClient();
  return fetchAllRows<{ id: string; name: string; document: string }>((from, to) =>
    supabase
      .from("clients")
      .select("id, name, document")
      .order("name")
      .range(from, to)
  );
}

export async function createClientRecord(input: {
  name: string; document: string; email?: string; phone?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");
  const { error } = await supabase.from("clients").insert({
    owner_id: user.id,
    name: input.name.trim(),
    document: onlyDigits(input.document),
    email: input.email?.trim() || null,
    phone: input.phone ? onlyDigits(input.phone) : null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Já existe um cliente com este CPF/CNPJ.");
    if (error.code === "23514") throw new Error("CPF/CNPJ inválido: use 11 ou 14 dígitos.");
    throw error;
  }
}

export async function updateClientRecord(id: string, input: {
  name: string; document: string; email?: string; phone?: string;
}) {
  const supabase = createClient();
  const { error } = await supabase.from("clients").update({
    name: input.name.trim(),
    document: onlyDigits(input.document),
    email: input.email?.trim() || null,
    phone: input.phone ? onlyDigits(input.phone) : null,
  }).eq("id", id);
  if (error) {
    if (error.code === "23505") throw new Error("Já existe um cliente com este CPF/CNPJ.");
    if (error.code === "23514") throw new Error("CPF/CNPJ inválido: use 11 ou 14 dígitos.");
    throw error;
  }
}

export async function deleteClientRecord(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Importação em massa (CSV) ----------

// Excel no Windows salva CSV como Windows-1252/ANSI, não UTF-8.
// Lê como UTF-8 primeiro; se aparecer o caractere de substituição (�),
// refaz a leitura como Windows-1252.
export async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (!utf8Text.includes("\uFFFD")) return utf8Text;
  return new TextDecoder("windows-1252").decode(buffer);
}

export interface ImportRow {
  name: string;
  document: string;
  email?: string;
  phone?: string;
}

export interface ImportResult {
  inserted: number;
  duplicates: number;
  invalid: { line: number; reason: string }[];
}

export function parseClientsCSV(text: string): { rows: ImportRow[]; invalid: { line: number; reason: string }[] } {
  const sep = text.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ImportRow[] = [];
  const invalid: { line: number; reason: string }[] = [];

  lines.forEach((line, i) => {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    // pula cabeçalho
    if (i === 0 && /nome/i.test(cols[0] ?? "")) return;

    const [name, document, email, phone] = cols;
    const digits = onlyDigits(document ?? "");
    if (!name) {
      invalid.push({ line: i + 1, reason: "nome vazio" });
      return;
    }
    if (digits.length !== 11 && digits.length !== 14) {
      invalid.push({ line: i + 1, reason: `documento inválido (${document ?? "vazio"})` });
      return;
    }
    rows.push({ name, document: digits, email: email || undefined, phone: phone ? onlyDigits(phone) : undefined });
  });

  return { rows, invalid };
}

export async function importClients(rows: ImportRow[]): Promise<ImportResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  let inserted = 0;
  let duplicates = 0;
  const invalid: { line: number; reason: string }[] = [];

  // Insere em lotes de 50; duplicados (mesmo CPF/CNPJ) são ignorados um a um
  const batchSize = 50;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((r) => ({
      owner_id: user.id,
      name: r.name,
      document: r.document,
      email: r.email || null,
      phone: r.phone || null,
    }));
    const { error, count } = await supabase
      .from("clients")
      .insert(batch, { count: "exact" });

    if (!error) {
      inserted += count ?? batch.length;
    } else if (error.code === "23505") {
      // lote com duplicado: insere um a um para aproveitar os válidos
      for (const row of batch) {
        const { error: e } = await supabase.from("clients").insert(row);
        if (!e) inserted += 1;
        else if (e.code === "23505") duplicates += 1;
        else invalid.push({ line: 0, reason: e.message });
      }
    } else {
      throw error;
    }
  }

  return { inserted, duplicates, invalid };
}

export const CSV_TEMPLATE =
  "nome;documento;email;telefone\n" +
  "Agro Silva Ltda;12345678000190;contato@agrosilva.com.br;65999990000\n" +
  "Maria Souza;12345678901;maria@email.com;65988887777\n";

// Atualiza só o telefone de um cliente (usado no editar cobrança para agilidade)
export async function updateClientPhone(clientId: string, phone: string) {
  const supabase = createClient();
  const digits = phone.replace(/\D/g, "");
  const { error } = await supabase
    .from("clients")
    .update({ phone: digits || null })
    .eq("id", clientId);
  if (error) throw error;
}
