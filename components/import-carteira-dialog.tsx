"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Upload, Download, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle,
  Trash2, Sparkles, FileSpreadsheet, ClipboardList,
} from "lucide-react";
import {
  parseTable, autoDetectMapping, missingRequired, buildImportRows,
  checkDuplicates, importNegotiations, readCsvFile,
  listImportBatches, deleteImportBatch,
  IMPORT_FIELDS, NEG_CSV_TEMPLATE,
  type ImportMapping, type ImportNegRow, type ImportNegResult,
} from "@/lib/services/import-negotiations";
import type { ImportBatch } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatBRL, formatDate } from "@/lib/utils";

type Step = "input" | "map" | "review" | "done";

export function ImportCarteiraDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const [step, setStep] = useState<Step>("input");
  const [fileName, setFileName] = useState("");
  const [pasted, setPasted] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [preview, setPreview] = useState<ImportNegRow[]>([]);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [stats, setStats] = useState<{ lines: number; charges: number; clients: number } | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportNegResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("input"); setFileName(""); setPasted(""); setHeaders([]); setRawRows([]);
    setMapping(null); setPreview([]); setPreviewErrors([]); setStats(null);
    setSkipDuplicates(true); setBusy(false); setProgress(null); setResult(null); setError(null);
  }, []);

  useEffect(() => {
    if (open) {
      reset();
      listImportBatches().then(setBatches).catch(() => {});
    }
  }, [open, reset]);

  function ingest(text: string, name: string) {
    setError(null);
    const table = parseTable(text);
    if (table.headers.length === 0 || table.rows.length === 0) {
      setError("Não encontrei dados. Confira se a planilha tem cabeçalho e ao menos uma linha.");
      return;
    }
    setFileName(name);
    setHeaders(table.headers);
    setRawRows(table.rows);
    setMapping(autoDetectMapping(table.headers));
    setStep("map");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await readCsvFile(file);
      ingest(text, file.name);
    } catch {
      setError("Não consegui ler o arquivo. Salve como CSV e tente de novo.");
    }
  }

  function usePasted() {
    if (pasted.trim().length < 3) {
      setError("Cole as linhas da planilha (com o cabeçalho na primeira linha).");
      return;
    }
    ingest(pasted, "colado da planilha");
  }

  function downloadTemplate() {
    const blob = new Blob(["\uFEFF" + NEG_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-importacao-cobrancas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function goReview() {
    if (!mapping) return;
    const missing = missingRequired(mapping);
    if (missing.length > 0) {
      setError(`Falta apontar: ${missing.join(", ")}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const built = buildImportRows(rawRows, mapping);
      const checked = await checkDuplicates(built.rows);
      setPreview(checked);
      setPreviewErrors(built.errors);
      setStats(built.stats);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao processar as linhas.");
    } finally {
      setBusy(false);
    }
  }

  const dupCount = preview.filter((r) => r.isDuplicate).length;
  const willImport = skipDuplicates ? preview.length - dupCount : preview.length;

  async function confirmImport() {
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: willImport });
    try {
      const res = await importNegotiations(preview, fileName, skipDuplicates, (done, total) =>
        setProgress({ done, total })
      );
      res.errors = [...previewErrors, ...res.errors];
      setResult(res);
      setStep("done");
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function removeBatch(id: string) {
    setDeletingBatch(id);
    try {
      await deleteImportBatch(id);
      setBatches((b) => b.filter((x) => x.id !== id));
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao excluir importação.");
    } finally {
      setDeletingBatch(null);
    }
  }

  const stepIndex = { input: 1, map: 2, review: 3, done: 3 }[step];

  return (
    <Dialog open={open} onClose={onClose} title="Importar carteira de cobrança" className="max-w-2xl">
      {/* Stepper */}
      {step !== "done" && (
        <div className="mb-5 flex items-center gap-2">
          {[
            { n: 1, label: "Enviar" },
            { n: 2, label: "Conferir colunas" },
            { n: 3, label: "Revisar" },
          ].map((s, i) => (
            <div key={s.n} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs",
                  s.n < stepIndex && "bg-accent-soft text-accent",
                  s.n === stepIndex && "bg-accent text-white",
                  s.n > stepIndex && "border border-border bg-surface text-faint"
                )}
              >
                {s.n < stepIndex ? <CheckCircle2 size={14} /> : s.n}
              </div>
              <span className={cn("text-xs", s.n === stepIndex ? "font-medium text-fg" : "text-muted")}>
                {s.label}
              </span>
              {i < 2 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* STEP 1 — ENVIAR */}
      {step === "input" && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Exporte a carteira do ERP e envie do jeito que estiver — o Cifra reconhece as colunas sozinho.
            Aceita <span className="font-mono text-xs text-fg">.csv</span> ou colar direto do Excel.
            O sistema agrupa por código, cria uma cobrança por linha e soma na carteira do cliente.
          </p>

          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface px-4 py-6 text-center transition-colors hover:bg-raised">
            <Upload size={26} className="text-accent" />
            <span className="text-sm text-fg">
              Arraste o arquivo ou <span className="font-medium text-accent">escolha do computador</span>
            </span>
            <span className="text-xs text-faint">.csv ou .txt · até 10.000 linhas</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-faint">ou cole da planilha</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Selecione as linhas no Excel (com o cabeçalho), copie com Ctrl+C e cole aqui com Ctrl+V"
            className="min-h-[72px] font-mono text-xs"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download size={14} /> Baixar modelo
            </Button>
            <Button size="sm" onClick={usePasted} disabled={pasted.trim().length < 3}>
              Usar texto colado <ArrowRight size={14} />
            </Button>
          </div>

          {batches.length > 0 && (
            <div className="mt-2 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
                Importações anteriores
              </p>
              <div className="space-y-2">
                {batches.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-md bg-raised px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-fg">{b.file_name ?? "Importação"}</p>
                      <p className="text-xs text-muted">
                        {formatDate(b.created_at)} · {b.row_count} cobranças ·{" "}
                        <span className="font-mono">{formatBRL(Number(b.total_amount))}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => removeBatch(b.id)}
                      disabled={deletingBatch === b.id}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Excluir
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">
                Excluir uma importação remove todas as cobranças dela.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 — DE-PARA */}
      {step === "map" && mapping && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            O Cifra já ligou as colunas da sua planilha aos campos do sistema. Confira e ajuste se algo
            estiver trocado. Campos com <span className="text-danger">*</span> são obrigatórios.
          </p>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-2 gap-3 bg-raised px-3 py-2 text-xs font-medium text-muted">
              <span>Campo no Cifra</span>
              <span>Coluna da sua planilha</span>
            </div>
            {IMPORT_FIELDS.map((f) => {
              const detected = mapping[f.key] >= 0;
              return (
                <div key={f.key} className="grid grid-cols-2 items-center gap-3 border-t border-border px-3 py-2">
                  <div className="text-sm text-fg">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                    {f.hint && <span className="ml-1 text-xs text-faint">({f.hint})</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={mapping[f.key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [f.key]: parseInt(e.target.value) })
                      }
                    >
                      <option value={-1}>— não usar —</option>
                      {headers.map((h, idx) => (
                        <option key={idx} value={idx}>{h || `Coluna ${idx + 1}`}</option>
                      ))}
                    </Select>
                    {detected && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[11px] text-accent">
                        <Sparkles size={11} /> detectado
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-faint">
            Prévia da 1ª linha:{" "}
            <span className="font-mono text-muted">{rawRows[0]?.slice(0, 6).join(" · ")}</span>
          </p>

          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setStep("input")} disabled={busy}>
              <ArrowLeft size={14} /> Voltar
            </Button>
            <Button size="sm" onClick={goReview} disabled={busy}>
              {busy ? "Processando…" : <>Continuar <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3 — REVISAR */}
      {step === "review" && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Linhas lidas" value={String(stats.lines)} />
            <Stat label="Clientes" value={String(stats.clients)} />
            <Stat label="Cobranças" value={String(stats.charges)} tone="accent" />
          </div>

          <p className="text-sm text-muted">
            {stats.charges} cobrança(s) de {stats.clients} cliente(s).{" "}
            Cobranças do mesmo código são somadas na carteira do cliente.
          </p>

          {dupCount > 0 && (
            <label className="flex items-start gap-2 rounded-md bg-raised px-3 py-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
                className="mt-1 accent-[#159A63]"
              />
              <span>
                Pular {dupCount} já importada(s) antes — importar {willImport} nova(s).
              </span>
            </label>
          )}

          {previewErrors.length > 0 && (
            <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              <div className="flex items-center gap-1 font-medium">
                <AlertTriangle size={14} /> {previewErrors.length} linha(s) ficam de fora
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {previewErrors.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
                {previewErrors.length > 4 && <li>e mais {previewErrors.length - 4}…</li>}
              </ul>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-raised text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Código</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((r, i) => (
                  <tr key={i} className={cn("border-t border-border", r.isDuplicate && skipDuplicates && "opacity-40")}>
                    <td className="px-3 py-2 font-mono text-xs text-fg">{r.code}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-fg">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{formatBRL(r.total)}</td>
                    <td className="px-3 py-2 text-muted">{formatDate(r.newest_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 50 && (
              <p className="border-t border-border px-3 py-2 text-xs text-faint">
                Mostrando 50 de {preview.length} cobranças.
              </p>
            )}
          </div>

          {busy && progress && progress.total > 0 && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-raised">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setStep("map")} disabled={busy}>
              <ArrowLeft size={14} /> Voltar
            </Button>
            <Button size="sm" onClick={confirmImport} disabled={busy || willImport === 0}>
              {busy
                ? progress ? `Importando ${progress.done}/${progress.total}…` : "Importando…"
                : <><CheckCircle2 size={14} /> Importar {willImport} cobrança(s)</>}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4 — CONCLUÍDO */}
      {step === "done" && result && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
            <CheckCircle2 size={26} className="text-accent" />
          </div>
          <div>
            <p className="text-lg font-medium text-fg">
              {result.created} {result.created === 1 ? "cobrança importada" : "cobranças importadas"}
            </p>
            {result.skipped > 0 && (
              <p className="text-sm text-warn">{result.skipped} ficaram de fora.</p>
            )}
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-left text-xs text-warn">
              {result.errors.slice(0, 3).map((e, i) => <p key={i}>{e}</p>)}
              {result.errors.length > 3 && <p>e mais {result.errors.length - 3}…</p>}
            </div>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => { reset(); listImportBatches().then(setBatches).catch(() => {}); }}>
              <ClipboardList size={14} /> Importar outra
            </Button>
            <Button size="sm" onClick={onClose}>Concluir</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className={cn("rounded-md px-3 py-2", tone === "accent" ? "bg-accent-soft" : "bg-raised")}>
      <div className={cn("text-xs", tone === "accent" ? "text-accent" : "text-muted")}>{label}</div>
      <div className={cn("font-mono text-xl font-medium", tone === "accent" ? "text-accent" : "text-fg")}>{value}</div>
    </div>
  );
}
