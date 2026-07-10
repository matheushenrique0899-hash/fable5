import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Busca TODAS as linhas de uma query, superando o limite padrão de 1.000
 * linhas do PostgREST/Supabase. Sem isso, contas com carteiras grandes
 * (1.000+ cobranças) recebem resultados truncados silenciosamente,
 * causando inconsistência entre telas que ordenam de formas diferentes.
 *
 * Uso:
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase.from("charges").select("*").eq("owner_id", userId).range(from, to)
 *   );
 */
export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await queryPage(from, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break; // última página
    from += pageSize;
  }

  return all;
}
