import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/services/fetch-all";
import type { ImportBatch } from "@/lib/types";

export interface ImportNegRow {
  code: string;
  name: string;
  total: number;
  sale_date: string;      // YYYY-MM-DD (data da venda mais recente)
  newest_due: string;     // YYYY-MM-DD (vencimento mais recente)
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

// CSV: Código, Nome, Total, Data da Venda, Vencimento, Telefone, Observação
// Agrupa por código: soma Total, usa venda/vencimento MAIS RECENTES.
export function parseNegotiationsCSV(text: string): {
  rows: ImportNegRow[];
  errors: string[];
} {
  const sep = text.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["Arquivo vazio."] };

  const header = lines[0].split(sep).map((h) => normalize(h.replace(/^"|"$/g, "")));
  const iCode = header.findIndex((h) => h.includes("codigo") || h === "code");
  const iName = header.findIndex((h) => h.includes("nome") || h === "name");
  const iTotal = header.findIndex((h) => h.includes("total") || h.includes("receber") || h.includes("saldo"));
  const iSale = header.findIndex((h) => h.includes("venda") || h === "sale");
  const iDue = header.findIndex((h) => h.includes("vencimento") || h.includes("venc") || h === "due");
  const iPhone = header.findIndex((h) => h.includes("telefone") || h.includes("fone") || h.includes("celular") || h === "phone");
  const iObs = header.findIndex((h) => h.includes("observacao") || h.includes("obs") || h === "observation");

  if (iCode === -1 || iName === -1 || iTotal === -1 || iSale === -1 || iDue === -1) {
    errors.push(
      `Cabeçalho não reconhecido (${header.join(", ")}). Esperado: Código, Nome, Total, Data da Venda, Vencimento`
    );
    return { rows: [], errors };
  }

  const map = new Map<string, {
    name: string; total: number; sale: Date; newest: Date;
    phone: string | null; observation: string | null;
  }>();

  lines.slice(1).forEach((line, i) => {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const code = cols[iCode]?.trim();
    const name = cols[iName]?.trim();
    const rawTotal = cols[iTotal]?.replace(/[R$\s.]/g, "").replace(",", ".").trim();

    if (!code || !name) { errors.push(`Linha ${i + 2}: código ou nome vazio`); return; }

    // Aceita valor 0 (>= 0)
    const total = parseFloat(rawTotal ?? "");
    if (isNaN(total) || total < 0) { errors.push(`Linha ${i + 2}: valor inválido (${cols[iTotal]})`); return; }

    const sale = parseDate(cols[iSale]);
    const due = parseDate(cols[iDue]);
    if (!due) { errors.push(`Linha ${i + 2}: vencimento inválido (${cols[iDue]})`); return; }
    if (!sale) { errors.push(`Linha ${i + 2}: data da venda inválida (${cols[iSale]})`); return; }

    const rawPhone = iPhone !== -1 ? (cols[iPhone] ?? "").replace(/\D/g, "") : "";
    const phone = rawPhone.length >= 10 ? rawPhone : null;
    const obs = iObs !== -1 ? (cols[iObs] ?? "").trim() || null : null;

    const existing = map.get(code);
    if (existing) {
      existing.total += total;
      // Usa venda e vencimento MAIS RECENTES
      if (due > existing.newest) existing.newest = due;
      if (sale > existing.sale) existing.sale = sale;
      if (!existing.phone && phone) existing.phone = phone;
      // Observação: concatena se houver mais de uma
      if (obs) existing.observation = existing.observation ? `${existing.observation}; ${obs}` : obs;
    } else {
      map.set(code, { name, total, sale, newest: due, phone, observation: obs });
    }
  });

  const rows: ImportNegRow[] = Array.from(map.entries()).map(([code, v]) => ({
    code,
    name: v.name,
    total: Math.round(v.total * 100) / 100,
    sale_date: v.sale.toISOString().slice(0, 10),
    newest_due: v.newest.toISOString().slice(0, 10),
    phone: v.phone,
    observation: v.observation,
  }));

  return { rows, errors };
}

// Verifica quais linhas já existem no banco.
// Regra de duplicata: mesmo NOME + VALOR + DATA DA VENDA + VENCIMENTO.
// Qualquer diferença (valor mudou, nova venda) entra como nova cobrança.
export async function checkDuplicates(rows: ImportNegRow[]): Promise<ImportNegRow[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return rows;

  // Busca cobranças importadas com os campos que compõem a chave
  const existing = await fetchAllRows<{ amount: number; due_date: string; sale_date: string | null; clients: { name: string }[] | { name: string } | null }>(
    (from, to) =>
      supabase
        .from("charges")
        .select("amount, due_date, sale_date, clients(name)")
        .eq("owner_id", user.id)
        .like("description", "Saldo devedor importado%")
        .range(from, to)
  );

  // Chave normalizada: nome|valor|venda|vencimento
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

  // Limite de segurança: máximo de cobranças por conta
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

  // Cria o lote
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

  // ---- Passo 1: resolver clientes ----
  // O "Código" vem do ERP e não é confiável como identidade — a mesma
  // pessoa pode vir com código diferente em cada exportação. Por isso o
  // casamento de cliente aqui é pelo NOME (normalizado); o código só é
  // usado como valor técnico pro campo "documento", que é obrigatório.
  const withDoc = toImport.map((r) => ({
    row: r,
    docKey: r.code.trim(),
    nameKey: normalize(r.name),
  }));

  // Busca TODOS os clientes já existentes (para casar por nome)
  const allExisting = await fetchAllRows<{ id: string; name: string; document: string; phone: string | null }>(
    (from, to) =>
      supabase
        .from("clients")
        .select("id, name, document, phone")
        .eq("owner_id", user.id)
        .range(from, to)
  );

  const nameToClientId = new Map<string, string>();
  const clientHasPhone = new Map<string, boolean>();
  allExisting.forEach((c) => {
    nameToClientId.set(normalize(c.name), c.id);
    clientHasPhone.set(c.id, !!c.phone);
  });

  // Cria os clientes que ainda não existem (1 por nome novo neste import)
  const newByName = new Map<string, { name: string; document: string; phone: string | null }>();
  for (const w of withDoc) {
    if (nameToClientId.has(w.nameKey)) continue;
    if (!newByName.has(w.nameKey)) {
      newByName.set(w.nameKey, { name: w.row.name, document: w.docKey, phone: w.row.phone });
    }
  }

  if (newByName.size > 0) {
    const payload = Array.from(newByName.values());
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.map((p) => ({ owner_id: user.id, name: p.name, document: p.document, phone: p.phone })).slice(i, i + 500);
      const { data: inserted, error: ce } = await supabase.from("clients").insert(chunk).select("id, name");
      if (!ce) {
        (inserted ?? []).forEach((c) => nameToClientId.set(normalize(c.name), c.id));
      } else if (ce.code === "23505") {
        // Dois nomes diferentes caíram no mesmo "documento" (código
        // duplicado/vazio) — insere um a um pra não perder o lote inteiro.
        for (const p of chunk) {
          const { data: single, error: se } = await supabase.from("clients").insert(p).select("id, name").single();
          if (!se) {
            nameToClientId.set(normalize(single.name), single.id);
          } else if (se.code === "23505") {
            const fallbackDoc = String(Date.now()).padStart(11, "0").slice(-11);
            const { data: retry, error: re } = await supabase
              .from("clients")
              .insert({ ...p, document: fallbackDoc })
              .select("id, name")
              .single();
            if (!re) nameToClientId.set(normalize(retry.name), retry.id);
            else errors.push(`${p.name}: cliente não pôde ser criado (${re.message})`);
          } else {
            errors.push(`${p.name}: cliente não pôde ser criado (${se.message})`);
          }
        }
      } else {
        errors.push(`Erro ao criar clientes: ${ce.message}`);
      }
    }
  }

  // Completa telefone de clientes que existiam sem telefone
  const phoneUpdates = withDoc.filter((w) => {
    const cid = nameToClientId.get(w.nameKey);
    return cid && clientHasPhone.get(cid) === false && w.row.phone;
  });
  for (const w of phoneUpdates) {
    const cid = nameToClientId.get(w.nameKey)!;
    await supabase.from("clients").update({ phone: w.row.phone }).eq("id", cid);
    clientHasPhone.set(cid, true);
  }

  // ---- Passo 2: inserir cobranças em lote ----
  const chargesPayload = withDoc
    .map((w) => {
      const clientId = nameToClientId.get(w.nameKey);
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

// Exclui um lote inteiro e todas as cobranças dele
export async function deleteImportBatch(batchId: string): Promise<number> {
  const supabase = createClient();
  // Conta antes de apagar
  const { count } = await supabase
    .from("charges")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);

  // Apaga as cobranças do lote (as negociações ligadas ao cliente permanecem)
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
