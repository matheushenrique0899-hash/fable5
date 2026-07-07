import { createClient } from "@/lib/supabase/client";

export interface ImportNegRow {
  code: string;
  name: string;
  total: number;
  sale_date: string;   // YYYY-MM-DD
  oldest_due: string;  // YYYY-MM-DD (vencimento mais antigo)
}

export interface ImportNegResult {
  created: number;
  skipped: number;
  errors: string[];
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

// CSV: Código, Nome, Total, Venda, Vencimento
// Agrupa por código: soma Total, pega venda mais antiga e vencimento mais antigo
export function parseNegotiationsCSV(text: string): {
  rows: ImportNegRow[];
  errors: string[];
} {
  const sep = text.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["Arquivo vazio."] };

  const header = lines[0].split(sep).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const iCode = header.findIndex((h) => h.includes("c\u00f3digo") || h === "codigo" || h === "code");
  const iName = header.findIndex((h) => h.includes("nome") || h === "name");
  const iTotal = header.findIndex((h) => h.includes("total") || h.includes("receber") || h.includes("saldo"));
  const iSale = header.findIndex((h) => h.includes("venda") || h === "sale");
  const iDue = header.findIndex((h) => h.includes("vencimento") || h.includes("venc") || h === "due");

  if (iCode === -1 || iName === -1 || iTotal === -1 || iSale === -1 || iDue === -1) {
    errors.push(
      `Cabe\u00e7alho n\u00e3o reconhecido (${header.join(", ")}). Esperado: C\u00f3digo, Nome, Total, Venda, Vencimento`
    );
    return { rows: [], errors };
  }

  const map = new Map<string, { name: string; total: number; sale: Date; oldest: Date }>();

  lines.slice(1).forEach((line, i) => {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const code = cols[iCode]?.trim();
    const name = cols[iName]?.trim();
    const rawTotal = cols[iTotal]?.replace(/[R$\s.]/g, "").replace(",", ".").trim();

    if (!code || !name) { errors.push(`Linha ${i + 2}: c\u00f3digo ou nome vazio`); return; }

    const total = parseFloat(rawTotal ?? "");
    if (isNaN(total) || total <= 0) { errors.push(`Linha ${i + 2}: valor inv\u00e1lido (${cols[iTotal]})`); return; }

    const sale = parseDate(cols[iSale]);
    const due = parseDate(cols[iDue]);
    if (!due) { errors.push(`Linha ${i + 2}: vencimento inv\u00e1lido (${cols[iDue]})`); return; }
    if (!sale) { errors.push(`Linha ${i + 2}: data de venda inv\u00e1lida (${cols[iSale]})`); return; }

    const existing = map.get(code);
    if (existing) {
      existing.total += total;
      if (due < existing.oldest) existing.oldest = due;
      if (sale < existing.sale) existing.sale = sale;
    } else {
      map.set(code, { name, total, sale, oldest: due });
    }
  });

  const rows: ImportNegRow[] = Array.from(map.entries()).map(([code, v]) => ({
    code,
    name: v.name,
    total: Math.round(v.total * 100) / 100,
    sale_date: v.sale.toISOString().slice(0, 10),
    oldest_due: v.oldest.toISOString().slice(0, 10),
  }));

  return { rows, errors };
}

// Importa: cria cliente (se não existir) + cobrança com o saldo total.
// A negociação NÃO é criada aqui — nasce do botão "Iniciar negociação" na cobrança.
export async function importNegotiations(rows: ImportNegRow[]): Promise<ImportNegResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada. Faça login novamente.");

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const docKey = row.code.replace(/\D/g, "").padStart(11, "0").slice(0, 11);

      // 1. Cliente (cria se não existir)
      let clientId: string;
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("owner_id", user.id)
        .eq("document", docKey)
        .maybeSingle();

      if (existing) {
        clientId = existing.id;
      } else {
        const { data: newClient, error: ce } = await supabase
          .from("clients")
          .insert({ owner_id: user.id, name: row.name, document: docKey })
          .select("id")
          .single();
        if (ce) { errors.push(`${row.name}: ${ce.message}`); skipped++; continue; }
        clientId = newClient.id;
      }

      // 2. Cobrança: saldo total, data da venda, vencimento mais antigo.
      //    Parcelas fica 1 (padrão) — usuário ajusta depois pelo Editar.
      const { error: che } = await supabase.from("charges").insert({
        owner_id: user.id,
        client_id: clientId,
        amount: row.total,
        due_date: row.oldest_due,
        sale_date: row.sale_date,
        installments: 1,
        description: `Saldo devedor importado (c\u00f3d. ${row.code})`,
      });
      if (che) { errors.push(`${row.name}: cobran\u00e7a (${che.message})`); skipped++; continue; }

      created++;
    } catch (e) {
      errors.push(`${row.name}: ${e instanceof Error ? e.message : "erro"}`);
      skipped++;
    }
  }

  return { created, skipped, errors };
}

export const NEG_CSV_TEMPLATE =
  "C\u00f3digo;Nome;Total;Venda;Vencimento\n" +
  "3091;EDIELY FAVETTI LOPES;555,00;10/11/2019;10/12/2019\n" +
  "3266;SIMONE CRISTINA MENEZES;169,85;09/01/2019;09/02/2019\n";
