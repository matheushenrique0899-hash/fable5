"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, CheckCircle2, Trash2, Pencil, Handshake, Upload, Download } from "lucide-react";
import {
  listCharges,
  createCharge,
  updateCharge,
  markAsPaid,
  deleteCharge,
  refreshOverdue,
  ensureNegotiationForClient,
} from "@/lib/services/charges";
import { listAllClientsLite } from "@/lib/services/clients";
import {
  parseNegotiationsCSV,
  importNegotiations,
  readCsvFile,
  NEG_CSV_TEMPLATE,
  type ImportNegRow,
  type ImportNegResult,
} from "@/lib/services/import-negotiations";
import type { Charge, ChargeStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, daysOverdue, formatBRL, formatDate } from "@/lib/utils";

type Filter = ChargeStatus | "todas";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "pendente", label: "Pendentes" },
  { value: "atrasado", label: "Atrasadas" },
  { value: "pago", label: "Pagas" },
];

type AgingFilter = "todas" | "d30" | "d60" | "d90" | "d90p";
const AGING: { value: AgingFilter; label: string; min: number; max: number }[] = [
  { value: "todas", label: "Qualquer atraso", min: -Infinity, max: Infinity },
  { value: "d30", label: "1–30 dias", min: 1, max: 30 },
  { value: "d60", label: "31–60 dias", min: 31, max: 60 },
  { value: "d90", label: "61–90 dias", min: 61, max: 90 },
  { value: "d90p", label: "+90 dias", min: 91, max: Infinity },
];

const emptyForm = {
  client_id: "",
  amount: "",
  due_date: "",
  sale_date: "",
  installments: "1",
  description: "",
};

export default function CobrancasPage() {
  const router = useRouter();
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [agingFilter, setAgingFilter] = useState<AgingFilter>("todas");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Charge | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Charge | null>(null);

  const [paying, setPaying] = useState<Charge | null>(null);
  const [payDate, setPayDate] = useState("");

  const [toast, setToast] = useState<string | null>(null);

  // Importação CSV com preview
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportNegRow[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportNegResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshOverdue();
      setCharges(await listCharges(filter));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listAllClientsLite().then(setClients); }, []);

  // Deep link vindo do Dashboard: /cobrancas?status=atrasado&aging=d90p
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const st = params.get("status");
    if (st && ["pendente", "atrasado", "pago"].includes(st)) setFilter(st as Filter);
    const ag = params.get("aging");
    if (ag && ["d30", "d60", "d90", "d90p"].includes(ag)) setAgingFilter(ag as AgingFilter);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
return () => clearTimeout(t);
  }, [toast]);

  const visible = charges.filter((c) => {
    if (agingFilter === "todas") return true;
    if (c.status === "pago") return false;
    const d = daysOverdue(c.due_date);
    const band = AGING.find((a) => a.value === agingFilter)!;
    return d >= band.min && d <= band.max;
  });

  const openTotal = visible
    .filter((c) => c.status !== "pago")
    .reduce((s, c) => s + Number(c.amount), 0);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(c: Charge) {
    setEditing(c);
    setForm({
      client_id: c.client_id,
      amount: String(c.amount).replace(".", ","),
      due_date: c.due_date,
      sale_date: c.sale_date ?? "",
      installments: String(c.installments ?? 1),
      description: c.description ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    const amount = Number(form.amount.replace(",", "."));
    if (!form.client_id) return setFormError("Selecione o cliente.");
    if (!amount || amount <= 0) return setFormError("Informe um valor maior que zero.");
    if (!form.due_date) return setFormError("Informe a data de vencimento.");
    if (form.sale_date && form.sale_date > form.due_date)
      return setFormError("A data da venda não pode ser depois do vencimento.");

    setSaving(true);
    try {
      const payload = {
        client_id: form.client_id,
        amount,
        due_date: form.due_date,
        sale_date: form.sale_date || undefined,
        installments: Math.max(parseInt(form.installments) || 1, 1),
        description: form.description,
      };
      if (editing) await updateCharge(editing.id, payload);
      else await createCharge(payload);
      setDialogOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar cobrança.");
    } finally {
      setSaving(false);
    }
  }

  function openPay(c: Charge) {
    setPaying(c);
    setPayDate(new Date().toISOString().slice(0, 10));
  }

  async function confirmPay() {
    if (!paying) return;
    await markAsPaid(paying.id, payDate || undefined);
    setPaying(null);
    await load();
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteCharge(deleting.id);
    setDeleting(null);
    await load();
  }

  async function handleCreateNegotiation(c: Charge) {
    try {
      await ensureNegotiationForClient(c.client_id);
      // Leva direto para a aba Negociação, onde a tratativa aparece no topo
      router.push("/negociacao");
    } catch (e) {
      setToast(
        "Erro ao criar negociação: " +
          (e instanceof Error ? e.message : "erro desconhecido")
      );
    }
  }


  function resetImport() {
    setPreview(null);
    setPreviewErrors([]);
    setImportResult(null);
    setImportError(null);
  }

  async function handleImportFile(file: File) {
    resetImport();
    try {
      const text = await readCsvFile(file);
      const { rows, errors } = parseNegotiationsCSV(text);
      if (rows.length === 0) {
        setImportError(errors[0] ?? "Nenhuma linha válida encontrada no arquivo.");
        return;
      }
      setPreview(rows);
      setPreviewErrors(errors);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro ao ler o arquivo.");
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const result = await importNegotiations(preview);
      result.errors = [...previewErrors, ...result.errors];
      setImportResult(result);
      setPreview(null);
      setToast(`${result.created} cobrança(s) importada(s).`);
      await load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
    }
  }

  function downloadNegTemplate() {
    const blob = new Blob(["﻿" + NEG_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-importacao-cobrancas.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cobranças</h1>
          <p className="mt-1 text-sm text-muted">
            {formatBRL(openTotal)} em aberto
            {(filter !== "todas" || agingFilter !== "todas") && " (filtro aplicado)"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => { resetImport(); setImportOpen(true); }}
          >
            <Upload size={15} /> Importar planilha
          </Button>
          <Button onClick={openCreate}>
            <Plus size={15} /> Nova cobrança
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
              filter === f.value
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-border text-muted hover:border-border-strong hover:text-fg"
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        <Select
          value={agingFilter}
          onChange={(e) => setAgingFilter(e.target.value as AgingFilter)}
          className="h-8 w-auto text-xs"
        >
          {AGING.map((a) => (
            <option key={a.value} value={a.value}>
              {a.value === "todas" ? "Faixa de atraso: todas" : a.label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-raised" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Receipt size={18} />}
            title="Nenhuma cobrança aqui"
            description={
              filter === "todas" && agingFilter === "todas"
                ? "Crie a primeira cobrança ou importe a carteira na aba Negociação."
                : "Nenhuma cobrança com esses filtros no momento."
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Valor</TH>
                <TH className="hidden lg:table-cell">Venda</TH>
                <TH className="hidden lg:table-cell">Parcelas</TH>
                <TH>Vencimento</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((c) => {
                const overdue = c.status === "atrasado" ? daysOverdue(c.due_date) : 0;
                return (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.clients?.name ?? "—"}</TD>
                    <TD className="font-mono">{formatBRL(Number(c.amount))}</TD>
                    <TD className="hidden text-muted lg:table-cell">
                      {c.sale_date ? formatDate(c.sale_date) : "—"}
                    </TD>
                    <TD className="hidden font-mono text-muted lg:table-cell">
                      {c.installments}x
                    </TD>
                    <TD>
                      <span className={cn(c.status === "atrasado" ? "text-danger" : "text-muted")}>
                        {formatDate(c.due_date)}
                      </span>
                      {overdue > 0 && (
                        <span className="ml-2 font-mono text-xs text-danger">+{overdue}d</span>
                      )}
                      {c.status === "pago" && c.paid_at && (
                        <span className="ml-2 font-mono text-xs text-accent">
                          pago {formatDate(c.paid_at)}
                        </span>
                      )}
                    </TD>
                    <TD><StatusBadge status={c.status} /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {c.status !== "pago" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Criar negociação"
                              title="Criar negociação para este cliente"
                              onClick={() => handleCreateNegotiation(c)}
                            >
                              <Handshake size={14} />
                            </Button>
                            <Button variant="success" size="sm" onClick={() => openPay(c)}>
                              <CheckCircle2 size={13} /> Pago
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => openEdit(c)}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          className="hover:bg-danger-soft hover:text-danger"
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-up rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-fg shadow-pop">
          {toast}
        </div>
      )}

      {/* Importar planilha do ERP (com preview) */}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar carteira de cobrança"
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {!preview && !importResult && (
            <>
              <p className="text-sm text-muted">
                Exporte do ERP, ajuste os cabeçalhos para{" "}
                <span className="font-mono text-xs text-fg">Código; Nome; Total; Venda; Vencimento</span>{" "}
                e salve como CSV. O sistema agrupa por código, soma o saldo devedor e cria o
                cliente + a cobrança. Parcelas e negociação você define depois, linha a linha.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={downloadNegTemplate}>
                  <Download size={14} /> Baixar modelo
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-[#06231A] transition-colors hover:bg-accent-hover">
                  <Upload size={14} />
                  Escolher arquivo CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImportFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </>
          )}

          {importError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {importError}
            </p>
          )}

          {/* PREVIEW antes de confirmar */}
          {preview && (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium text-fg">
                  Prévia: {preview.length} {preview.length === 1 ? "cliente" : "clientes"}
                </p>
                <p className="font-mono text-sm text-accent">
                  {formatBRL(preview.reduce((s, r) => s + r.total, 0))}
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b border-border bg-surface">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Cód.</th>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Nome</th>
                      <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-faint">Total</th>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Venda</th>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Venc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {preview.map((r) => (
                      <tr key={r.code}>
                        <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                        <td className="px-3 py-2 text-fg">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{formatBRL(r.total)}</td>
                        <td className="px-3 py-2 font-mono text-muted">{formatDate(r.sale_date)}</td>
                        <td className="px-3 py-2 font-mono text-muted">{formatDate(r.oldest_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewErrors.length > 0 && (
                <p className="text-xs text-warn">
                  {previewErrors.length} linha(s) serão ignoradas — ex.: {previewErrors[0]}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={resetImport}>Escolher outro arquivo</Button>
                <Button onClick={confirmImport} disabled={importing}>
                  {importing ? "Importando..." : `Confirmar importação (${preview.length})`}
                </Button>
              </div>
            </>
          )}

          {/* Resultado */}
          {importResult && (
            <>
              <div className="space-y-1.5 rounded-md border border-border bg-bg px-3 py-2.5 text-sm">
                <p className="text-accent">
                  {importResult.created} {importResult.created === 1 ? "cobrança criada" : "cobranças criadas"}
                </p>
                {importResult.skipped > 0 && (
                  <p className="text-warn">{importResult.skipped} ignorada(s) por erro</p>
                )}
                {importResult.errors.slice(0, 3).map((e, i) => (
                  <p key={i} className="font-mono text-xs text-danger">{e}</p>
                ))}
                {importResult.errors.length > 3 && (
                  <p className="text-xs text-faint">+{importResult.errors.length - 3} outros erros</p>
                )}
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={() => setImportOpen(false)}>Fechar</Button>
              </div>
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar cobrança" : "Nova cobrança"}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="ch-client">Cliente</Label>
            <Select
              id="ch-client"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              disabled={!!editing}
            >
              <option value="">Selecionar cliente...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {clients.length === 0 && (
              <p className="mt-1.5 text-xs text-warn">
                Cadastre um cliente antes de criar cobranças.
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ch-sale">Data da venda</Label>
              <Input
                id="ch-sale"
                type="date"
                value={form.sale_date}
                onChange={(e) => setForm({ ...form, sale_date: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ch-inst">Parcelas negociadas</Label>
              <Input
                id="ch-inst"
                className="font-mono"
                type="number"
                min={1}
                value={form.installments}
                onChange={(e) => setForm({ ...form, installments: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ch-amount">Valor (R$)</Label>
              <Input
                id="ch-amount"
                className="font-mono"
                inputMode="decimal"
                placeholder="1500,00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="ch-due">Vencimento</Label>
              <Input
                id="ch-due"
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ch-desc">Descrição</Label>
            <Textarea
              id="ch-desc"
              placeholder="Ex.: Parcela 2/6 — venda de insumos"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {formError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar cobrança"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!paying} onClose={() => setPaying(null)} title="Registrar pagamento">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Cobrança de{" "}
            <span className="font-mono text-fg">{paying && formatBRL(Number(paying.amount))}</span>{" "}
            de <span className="font-medium text-fg">{paying?.clients?.name}</span>.
          </p>
          <div>
            <Label htmlFor="pay-date">Data do pagamento</Label>
            <Input
              id="pay-date"
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPaying(null)}>Cancelar</Button>
            <Button variant="success" onClick={confirmPay}>
              <CheckCircle2 size={14} /> Confirmar pagamento
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir cobrança">
        <p className="text-sm text-muted">
          Excluir a cobrança de{" "}
          <span className="font-mono text-fg">{deleting && formatBRL(Number(deleting.amount))}</span>{" "}
          de <span className="font-medium text-fg">{deleting?.clients?.name}</span>? Essa ação não
          pode ser desfeita.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Excluir cobrança</Button>
        </div>
      </Dialog>
    </div>
  );
}
