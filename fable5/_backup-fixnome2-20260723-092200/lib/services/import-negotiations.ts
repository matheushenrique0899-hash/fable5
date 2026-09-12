import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/services/fetch-all";
import type { ImportBatch } from "@/lib/types";

export interface ImportNegRow {
  code: string;
  name: string;
  total: number;
  sale_date: string;      // YYYY-MM-DD (data da venda)
  newest_due: string;     // YYYY-MM-DD (vencimento)
  phone: string | null;
  observation: string | null;
  isDuplicate?: boolean;  // marcado no preview se já existe no banco
}

export interface ImportNegResult {
  created: number;
  skipped: number;
  errors: string[];
  batchId: string | null;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Lê o arquivo tentando UTF-8 e caindo para Windows-1252 (Excel BR antigo)
export async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (!utf8Text.includes("\uFFFD")) return utf8Text;
  return new TextDecoder("windows-1252").decode(buffer);
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const parts = raw.trim().split(/[\/\-]/);
  if (parts.length !== 3) return null;
  const d = parts[0].length === 4
    ? new Date(`${parts[0]}-${parts[1]}-${parts[2]}`)
    : new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  return isNaN(d.getTime()) ? null : d;
}

// ============================================================
// DE-PARA (mapeamento de colunas) — o que resolve a dor de
// "minha planilha não é igual ao modelo".
// ============================================================

export type ImportField = "code" | "name" | "total" | "sale" | "due" | "phone" | "obs";

export const IMPORT_FIELDS: {
  key: ImportField;
  label: string;
  required: boolean;
  hint: string;
}[] = [
  { key: "code",  label: "Código",        required: true,  hint: "chave do cliente" },
  { key: "name",  label: "Nome",          required: true,  hint: "" },
  { key: "total", label: "Total",         required: true,  hint: "valor da cobrança" },
  { key: "sale",  label: "Data da Venda", required: true,  hint: "" },
  { key: "due",   label: "Vencimento",    required: true,  hint: "" },
  { key: "phone", label: "Telefone",      required: false, hint: "opcional" },
  { key: "obs",   label: "Observação",    required: false, hint: "opcional" },
];

// -1 = coluna não encontrada (o usuário escolhe no de-para)
export type ImportMapping = Record<ImportField, number>;

function detectSep(firstLine: string): string {
  if (firstLine.includes("\t")) return "\t"; // colado direto do Excel
  if (firstLine.includes(";")) return ";";
  return ",";
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  sep: string;
}

// Divide o texto (CSV ou colado do Excel) em cabeçalho + linhas.
export function parseTable(text: string): ParsedTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [], sep: "," };
  const sep = detectSep(lines[0]);
  const cut = (l: string) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
  return { headers: cut(lines[0]), rows: lines.slice(1).map(cut), sep };
}

// Adivinha, para cada campo do Cifra, qual coluna da planilha corresponde.
//
// IMPORTANTE: cada coluna só pode ser usada por UM campo. Cabeçalhos como
// "Código Cliente" contêm "codigo" (bate com código) E "cliente" (bate com
// nome) ao mesmo tempo — sem essa trava, os dois campos apontavam pra essa
// mesma coluna, e o nome do cliente virava o próprio código (ex.: cliente
// salvo com o nome "C00999" em vez do nome de verdade). Por isso os campos
// são resolvidos em ordem de prioridade, e uma coluna já usada por um campo
// sai da disputa para os campos seguintes.
export function autoDetectMapping(headers: string[]): ImportMapping {
  const h = headers.map(normalize);
  const used = new Set<number>();

  function find(fn: (x: string) => boolean): number {
    const idx = h.findIndex((x, i) => !used.has(i) && fn(x));
    if (idx >= 0) used.add(idx);
    return idx;
  }

  // Ordem importa: campos mais específicos primeiro, para reservar sua
  // coluna antes que um campo mais "genérico" (como nome, que casa com
  // várias palavras comuns) possa roubá-la.
  const code = find((x) => x.startsWith("cod") || x === "code"); // cobre "codigo", "cod", "cod.", "cód. cliente" etc.
  const due = find((x) => x.includes("vencimento") || x.includes("venc") || x === "due");
  const sale = find((x) => x.includes("venda") || x === "sale" || x.includes("emissao"));
  const total = find((x) => x.includes("total") || x.includes("receber") || x.includes("saldo") || x.includes("valor"));
  const phone = find((x) => x.includes("telefone") || x.includes("fone") || x.includes("celular") || x === "phone" || x.includes("whats"));
  const obs = find((x) => x.includes("observacao") || x.includes("obs") || x === "observation");
  const name = find((x) => x.includes("nome") || x === "name" || x.includes("cliente"));

  return { code, name, total, sale, due, phone, obs };
}

// Campos obrigatórios que ainda não foram mapeados (para bloquear o avanço)
export function missingRequired(mapping: ImportMapping): string[] {
  return IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] < 0).map((f) => f.label);
}

export interface BuildResult {
  rows: ImportNegRow[];
  errors: string[];
  stats: { lines: number; charges: number; clients: number };
}

// Constrói as cobranças a partir das linhas + do mapeamento escolhido.
// Cada linha = uma cobrança. Só soma linhas que são EXATAMENTE a mesma venda
// (mesmo código + mesma data de venda + mesmo vencimento), evitando contar
// duas vezes uma linha repetida — sem juntar vendas diferentes do mesmo
// cliente. Mesmo código com datas diferentes = cobranças separadas na
// carteira daquele cliente (é o comportamento de "somar por código").
export function buildImportRows(rows: string[][], mapping: ImportMapping): BuildResult {
  const errors: string[] = [];
  let lines = 0;
  const map = new Map<string, {
    code: string; name: string; total: number; sale: Date; due: Date;
    phone: string | null; observation: string | null;
  }>();

  rows.forEach((cols, i) => {
    const ln = i + 2; // +2: linha 1 é cabeçalho, humano conta a partir de 1
    if (cols.every((c) => c === "")) return; // linha totalmente em branco: ignora
    const get = (f: ImportField) => (mapping[f] >= 0 ? (cols[mapping[f]] ?? "").trim() : "");

    const code = get("code");
    const name = get("name");
    if (!code) { errors.push(`Linha ${ln}: código vazio`); lines++; return; }
    if (!name) { errors.push(`Linha ${ln}: nome vazio`); lines++; return; }

    const rawTotal = get("total").replace(/[R$\s.]/g, "").replace(",", ".");
    const total = parseFloat(rawTotal);
    if (isNaN(total) || total < 0) { errors.push(`Linha ${ln}: valor inválido (${get("total")})`); lines++; return; }

    const sale = parseDate(get("sale"));
    const due = parseDate(get("due"));
    if (!due) { errors.push(`Linha ${ln}: vencimento inválido (${get("due")})`); lines++; return; }
    if (!sale) { errors.push(`Linha ${ln}: data da venda inválida (${get("sale")})`); lines++; return; }

    const rawPhone = get("phone").replace(/\D/g, "");
    const phone = rawPhone.length >= 10 ? rawPhone : null;
    const obs = get("obs") || null;

    lines++;
    const key = `${code}|${sale.toISOString().slice(0, 10)}|${due.toISOString().slice(0, 10)}`;
    const existing = map.get(key);
    if (existing) {
      existing.total += total;
      if (!existing.phone && phone) existing.phone = phone;
      if (obs) existing.observation = existing.observation ? `${existing.observation}; ${obs}` : obs;
    } else {
      map.set(key, { code, name, total, sale, due, phone, observation: obs });
    }
  });

  const out: ImportNegRow[] = Array.from(map.values()).map((v) => ({
    code: v.code,
    name: v.name,
    total: Math.round(v.total * 100) / 100,
    sale_date: v.sale.toISOString().slice(0, 10),
    newest_due: v.due.toISOString().slice(0, 10),
    phone: v.phone,
    observation: v.observation,
  }));

  const clients = new Set(out.map((r) => r.code)).size;
  return { rows: out, errors, stats: { lines, charges: out.length, clients } };
}

// Compatibilidade: mantém a assinatura antiga (detecta cabeçalho e constrói
// direto). Usada por quem chama parseNegotiationsCSV(text).
export function parseNegotiationsCSV(text: string): {
  rows: ImportNegRow[];
  errors: string[];
} {
  const { headers, rows } = parseTable(text);
  if (headers.length === 0) return { rows: [], errors: ["Arquivo vazio."] };
  const mapping = autoDetectMapping(headers);
  const missing = missingRequired(mapping);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        `Não reconheci as colunas: ${missing.join(", ")}. ` +
        `Cabeçalho encontrado: ${headers.join(", ")}. Use o de-para para apontar as colunas.`,
      ],
    };
  }
  const { rows: built, errors } = buildImportRows(rows, mapping);
  return { rows: built, errors };
}

// Verifica quais linhas já existem no banco.
// Regra de duplicata: mesmo NOME + VALOR + DATA DA VENDA + VENCIMENTO.
// Qualquer diferença (valor mudou, nova venda) entra como nova cobrança.
export async function checkDuplicates(rows: ImportNegRow[]): Promise<ImportNegRow[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return rows;

  const existing = await fetchAllRows<{ amount: number; due_date: string; sale_date: string | null; clients: { name: string }[] | { name: string } | null }>(
    (from, to) =>
      supabase
        .from("charges")
        .select("amount, due_date, sale_date, clients(name)")
        .eq("owner_id", user.id)
        .like("description", "Saldo devedor importado%")
        .range(from, to)
  );

  const keyOf = (name: string, amount: number, sale: string | null, due: string) =>
    `${normalize(name)}|${amount.toFixed(2)}|${sale ?? ""}|${due}`;

  const existingKeys = new Set(
    (existing ?? []).map((c: any) =>
      keyOf(
        Array.isArray(c.clients) ? c.clients[0]?.name ?? "" : c.clients?.name ?? "",
        Number(c.amount),
        c.sale_date,
        c.due_date
      )
    )
  );

  return rows.map((r) => ({
    ...r,
    isDuplicate: existingKeys.has(keyOf(r.name, r.total, r.sale_date, r.newest_due)),
  }));
}

// Importa criando um lote. skipDuplicates ignora os já existentes.
export async function importNegotiations(
  rows: ImportNegRow[],
  fileName: string,
  skipDuplicates: boolean,
  onProgress?: (done: number, total: number) => void
): Promise<ImportNegResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const toImport = skipDuplicates ? rows.filter((r) => !r.isDuplicate) : rows;
  const total = toImport.length;
  const errors: string[] = [];
  let skipped = 0;

  const CHARGE_LIMIT = 50000;
  const { count: currentCount } = await supabase
    .from("charges")
    .select("id", { count: "exact", head: true });
  if ((currentCount ?? 0) + total > CHARGE_LIMIT) {
    throw new Error(
      `Limite de ${CHARGE_LIMIT.toLocaleString("pt-BR")} cobranças por conta atingido. ` +
      `Você tem ${(currentCount ?? 0).toLocaleString("pt-BR")} e tentou adicionar ${total.toLocaleString("pt-BR")}. ` +
      `Exclua importações antigas ou fale com o administrador.`
    );
  }

  const { data: batch, error: be } = await supabase
    .from("import_batches")
    .insert({
      owner_id: user.id,
      file_name: fileName,
      row_count: total,
      total_amount: toImport.reduce((s, r) => s + r.total, 0),
    })
    .select("id")
    .single();
  if (be) throw be;
  const batchId = batch.id;

  // ---- Passo 1: resolver clientes (identidade = CÓDIGO) ----
  const withDoc = toImport.map((r) => ({ row: r, docKey: r.code.trim() }));
  const uniqueDocs = Array.from(new Set(withDoc.map((w) => w.docKey)));
  const docToClientId = new Map<string, string>();
  const docHasPhone = new Map<string, boolean>();

  for (let i = 0; i < uniqueDocs.length; i += 200) {
    const chunk = uniqueDocs.slice(i, i + 200);
    const { data: existing } = await supabase
      .from("clients")
      .select("id, document, phone")
      .eq("owner_id", user.id)
      .in("document", chunk);
    (existing ?? []).forEach((c) => {
      docToClientId.set(c.document, c.id);
      docHasPhone.set(c.document, !!c.phone);
    });
  }

  const newClientDocs = uniqueDocs.filter((d) => !docToClientId.has(d));
  if (newClientDocs.length > 0) {
    const newClientsPayload = newClientDocs.map((doc) => {
      const w = withDoc.find((x) => x.docKey === doc)!;
      return { owner_id: user.id, name: w.row.name, document: doc, phone: w.row.phone };
    });
    for (let i = 0; i < newClientsPayload.length; i += 500) {
      const chunk = newClientsPayload.slice(i, i + 500);
      const { data: inserted, error: ce } = await supabase
        .from("clients")
        .insert(chunk)
        .select("id, document");
      if (ce) {
        errors.push(`Erro ao criar clientes: ${ce.message}`);
      } else {
        (inserted ?? []).forEach((c) => docToClientId.set(c.document, c.id));
      }
    }
  }

  const phoneUpdates = withDoc.filter(
    (w) => docToClientId.has(w.docKey) && docHasPhone.get(w.docKey) === false && w.row.phone
  );
  for (const w of phoneUpdates) {
    await supabase.from("clients").update({ phone: w.row.phone }).eq("id", docToClientId.get(w.docKey)!);
    docHasPhone.set(w.docKey, true);
  }

  // ---- Passo 2: inserir cobranças em lote ----
  const chargesPayload = withDoc
    .map((w) => {
      const clientId = docToClientId.get(w.docKey);
      if (!clientId) {
        errors.push(`${w.row.name}: cliente não pôde ser criado`);
        skipped++;
        return null;
      }
      return {
        owner_id: user.id,
        client_id: clientId,
        amount: w.row.total,
        due_date: w.row.newest_due,
        sale_date: w.row.sale_date,
        installments: 1,
        description: `Saldo devedor importado (cód. ${w.row.code})`,
        observation: w.row.observation,
        import_batch_id: batchId,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  let created = 0;
  const BATCH = 500;
  for (let i = 0; i < chargesPayload.length; i += BATCH) {
    const chunk = chargesPayload.slice(i, i + BATCH);
    const { error: che, count } = await supabase
      .from("charges")
      .insert(chunk, { count: "exact" });
    if (che) {
      errors.push(`Erro ao inserir lote de cobranças: ${che.message}`);
      skipped += chunk.length;
    } else {
      created += count ?? chunk.length;
    }
    onProgress?.(Math.min(i + BATCH, chargesPayload.length), total);
  }

  return { created, skipped, errors, batchId };
}

// ---------- Lotes de importação ----------
export async function listImportBatches(): Promise<ImportBatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("import_batches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ImportBatch[];
}

export async function deleteImportBatch(batchId: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from("charges")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);

  const { error: ce } = await supabase.from("charges").delete().eq("import_batch_id", batchId);
  if (ce) throw ce;

  const { error: be } = await supabase.from("import_batches").delete().eq("id", batchId);
  if (be) throw be;

  return count ?? 0;
}

export const NEG_CSV_TEMPLATE =
  "Código;Nome;Total;Data da Venda;Vencimento;Telefone;Observação\n" +
  "3091;EDIELY FAVETTI LOPES;555,00;10/11/2019;10/12/2019;65999990000;Cliente antigo\n" +
  "3266;SIMONE CRISTINA MENEZES;169,85;09/01/2019;09/02/2019;65988887777;\n";
