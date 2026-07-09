import { createClient } from "@/lib/supabase/client";
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
  const { data: existing } = await supabase
    .from("charges")
    .select("amount, due_date, sale_date, clients(name)")
    .eq("owner_id", user.id)
    .like("description", "Saldo devedor importado%");

  // Chave normalizada: nome|valor|venda|vencimento
  const keyOf = (name: string, amount: number, sale: string | null, due: string) =>
    `${normalize(name)}|${amount.toFixed(2)}|${sale ?? ""}|${due}`;

  const existingKeys = new Set(
    (existing ?? []).map((c: any) =>
      keyOf(c.clients?.name ?? "", Number(c.amount), c.sale_date, c.due_date)
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
  skipDuplicates: boolean
): Promise<ImportNegResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  const toImport = skipDuplicates ? rows.filter((r) => !r.isDuplicate) : rows;

  // Cria o lote
  const { data: batch, error: be } = await supabase
    .from("import_batches")
    .insert({
      owner_id: user.id,
      file_name: fileName,
      row_count: toImport.length,
      total_amount: toImport.reduce((s, r) => s + r.total, 0),
    })
    .select("id")
    .single();
  if (be) throw be;
  const batchId = batch.id;

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of toImport) {
    try {
      const docKey = row.code.replace(/\D/g, "").padStart(11, "0").slice(0, 11);

      let clientId: string;
      const { data: existing } = await supabase
        .from("clients")
        .select("id, phone")
        .eq("owner_id", user.id)
        .eq("document", docKey)
        .maybeSingle();

      if (existing) {
        clientId = existing.id;
        if (!existing.phone && row.phone) {
          await supabase.from("clients").update({ phone: row.phone }).eq("id", clientId);
        }
      } else {
        const { data: newClient, error: ce } = await supabase
          .from("clients")
          .insert({ owner_id: user.id, name: row.name, document: docKey, phone: row.phone })
          .select("id")
          .single();
        if (ce) { errors.push(`${row.name}: ${ce.message}`); skipped++; continue; }
        clientId = newClient.id;
      }

      const { error: che } = await supabase.from("charges").insert({
        owner_id: user.id,
        client_id: clientId,
        amount: row.total,
        due_date: row.newest_due,
        sale_date: row.sale_date,
        installments: 1,
        description: `Saldo devedor importado (cód. ${row.code})`,
        observation: row.observation,
        import_batch_id: batchId,
      });
      if (che) { errors.push(`${row.name}: cobrança (${che.message})`); skipped++; continue; }

      created++;
    } catch (e) {
      errors.push(`${row.name}: ${e instanceof Error ? e.message : "erro"}`);
      skipped++;
    }
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
