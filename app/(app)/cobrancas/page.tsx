"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, CheckCircle2, Trash2, Pencil, Handshake, Upload, Download, MessageCircle, FileDown, Search, RotateCcw, ChevronRight } from "lucide-react";
import {
  listCharges,
  createCharge,
  updateCharge,
  registerPayment,
  deleteCharge,
  undoPayment,
  refreshOverdue,
  ensureNegotiationForClient,
  listPayments,
  deletePayment,
} from "@/lib/services/charges";
import { listAllClientsLite, updateClientPhone } from "@/lib/services/clients";
import { listActiveNegotiationClientIds } from "@/lib/services/negotiations";
import Link from "next/link";
import {
  parseNegotiationsCSV,
  importNegotiations,
  checkDuplicates,
  readCsvFile,
  listImportBatches,
  deleteImportBatch,
  NEG_CSV_TEMPLATE,
  type ImportNegRow,
  type ImportNegResult,
} from "@/lib/services/import-negotiations";
import type { ImportBatch } from "@/lib/types";
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
  phone: "",
  observation: "",
};

export default function CobrancasPage() {
  const router = useRouter();
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [agingFilter, setAgingFilter] = useState<AgingFilter>("todas");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"oldest" | "newest" | "highest" | "lowest">("newest");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Charge | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Charge | null>(null);
  const [undoing, setUndoing] = useState<Charge | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  const [viewingClientId, setViewingClientId] = useState<string | null>(null);

  const [paying, setPaying] = useState<Charge | null>(null);
  const [payDate, setPayDate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [payHistory, setPayHistory] = useState<{ id: string; amount: number; paid_date: string }[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  const [negotiatingIds, setNegotiatingIds] = useState<Set<string>>(new Set());

  // Importação CSV com preview
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportNegRow[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportNegResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Reset página quando filtro ou busca muda
  useEffect(() => { setPage(1); }, [filter, agingFilter, search, sortBy]);

  // Busca todas as cobranças uma única vez; a troca de aba (Todas/Pendentes/
  // Atrasadas/Pagas) filtra em memória, sem nova consulta ao Supabase.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshOverdue();
      const [chargesData, negIds] = await Promise.all([
        listCharges("todas"),
        listActiveNegotiationClientIds(),
      ]);
      setCharges(chargesData);
      setNegotiatingIds(negIds);
    } finally {
      setLoading(false);
    }
  }, []);

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
    if (filter !== "todas" && c.status !== filter) return false;
    if (agingFilter === "todas") return true;
    if (c.status === "pago") return false;
    const d = daysOverdue(c.due_date);
    const band = AGING.find((a) => a.value === agingFilter)!;
    return d >= band.min && d <= band.max;
  });

  // Busca por nome do cliente (parcial, case-insensitive)
  const searched = search.trim()
    ? visible.filter((c) =>
        (c.clients?.name ?? "").toLowerCase().includes(search.trim().toLowerCase())
      )
    : visible;

  // Ordenação dinâmica (nível de cobrança individual — usada no CSV e nos cálculos)
  const sorted = [...searched].sort((a, b) => {
    if (sortBy === "oldest") return a.due_date.localeCompare(b.due_date);
    if (sortBy === "newest") return b.due_date.localeCompare(a.due_date);
    if (sortBy === "highest") return Number(b.amount) - Number(a.amount);
    if (sortBy === "lowest") return Number(a.amount) - Number(b.amount);
    return 0;
  });

  // Agrupa por cliente: um cliente com várias cobranças vira uma linha só,
  // com o total em aberto e um indicador "+N". Cliente com 1 cobrança
  // só aparece normal, sem agrupamento (não precisa abrir nada).
  const groups = useMemo(() => {
    const map = new Map<string, Charge[]>();
    for (const c of sorted) {
      const arr = map.get(c.client_id) ?? [];
      arr.push(c);
      map.set(c.client_id, arr);
    }
    return Array.from(map.values()).map((groupCharges) => {
      const allPaid = groupCharges.every((c) => c.status === "pago");
      const total = allPaid
        ? groupCharges.reduce((s, c) => s + Number(c.amount), 0)
        : groupCharges.reduce(
            (s, c) => s + (c.status === "pago" ? 0 : Number(c.amount) - (c.paid_total ?? 0)),
            0
          );
      const worstStatus: ChargeStatus = groupCharges.some((c) => c.status === "atrasado")
        ? "atrasado"
        : groupCharges.some((c) => c.status === "pendente")
        ? "pendente"
        : "pago";
      const earliestDue = groupCharges.reduce(
        (min, c) => (c.due_date < min ? c.due_date : min),
        groupCharges[0].due_date
      );
      return {
        clientId: groupCharges[0].client_id,
        charges: groupCharges,
        total,
        allPaid,
        worstStatus,
        earliestDue,
      };
    });
  }, [sorted]);

  // Mesma ordenação escolhida pelo usuário, só que aplicada ao grupo
  const groupsSorted = [...groups].sort((a, b) => {
    if (sortBy === "oldest") return a.earliestDue.localeCompare(b.earliestDue);
    if (sortBy === "newest") return b.earliestDue.localeCompare(a.earliestDue);
    if (sortBy === "highest") return b.total - a.total;
    if (sortBy === "lowest") return a.total - b.total;
    return 0;
  });

  const totalPages = Math.max(Math.ceil(groupsSorted.length / PAGE_SIZE), 1);
  const paginatedGroups = groupsSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Deriva do estado atual (não é um snapshot) — se uma ação dentro do modal
  // mudar/zerar as cobranças do cliente, o modal reflete na hora.
  const viewingGroup = viewingClientId ? groups.find((g) => g.clientId === viewingClientId) ?? null : null;

  // Ordena as cobranças dentro do modal: em aberto primeiro (mais atrasada
  // primeiro), pagas por último (mais recente primeiro).
  const viewingCharges = viewingGroup
    ? [...viewingGroup.charges].sort((a, b) => {
        if (a.status === "pago" && b.status !== "pago") return 1;
        if (b.status === "pago" && a.status !== "pago") return -1;
        if (a.status === "pago" && b.status === "pago") {
          return (b.paid_at ?? "").localeCompare(a.paid_at ?? "");
        }
        return a.due_date.localeCompare(b.due_date);
      })
    : [];

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
      phone: c.clients?.phone ?? "",
      observation: c.observation ?? "",
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
        observation: form.observation,
      };
      if (editing) {
        await updateCharge(editing.id, payload);
        // Atualiza o telefone do cliente vinculado (agilidade para o cobrador)
        if (form.phone.replace(/\D/g, "") !== (editing.clients?.phone ?? "")) {
          await updateClientPhone(editing.client_id, form.phone);
        }
      } else {
        await createCharge(payload);
      }
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
    const remaining = Number(c.amount) - (c.paid_total ?? 0);
    setPayAmount(remaining.toFixed(2).replace(".", ","));
    setPayError(null);
    setPayHistory([]);
    listPayments(c.id).then((p) => setPayHistory(p as any)).catch(() => {});
  }

  async function handleDeletePayment(paymentId: string) {
    if (!paying) return;
    await deletePayment(paymentId, paying.id);
    const updated = await listPayments(paying.id);
    setPayHistory(updated as any);
    await load();
    // Atualiza o "paying" com o novo saldo
    const fresh = charges.find((c) => c.id === paying.id);
    if (fresh) setPaying(fresh);
  }

  async function confirmPay() {
    if (!paying) return;
    setPayError(null);
    const amount = Number(payAmount.replace(/\./g, "").replace(",", "."));
    if (!amount || amount <= 0) return setPayError("Informe o valor recebido.");
    try {
      const { settled, remaining } = await registerPayment(paying.id, amount, payDate || undefined);
      setPaying(null);
      setToast(
        settled
          ? "Cobrança quitada."
          : `Pagamento parcial registrado. Saldo: ${formatBRL(remaining)}.`
      );
      await load();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Erro ao registrar pagamento.");
    }
  }

  async function handleUndo() {
    if (!undoing) return;
    setUndoLoading(true);
    try {
      await undoPayment(undoing.id);
      setUndoing(null);
      setToast("Pagamento desfeito. A cobrança voltou a ficar em aberto.");
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Erro ao desfazer pagamento.");
    } finally {
      setUndoLoading(false);
    }
  }

  // Ações de uma cobrança individual — usada tanto na linha simples da
  // tabela quanto dentro do modal de cobranças agrupadas por cliente.
  function chargeActions(c: Charge) {
    return (
      <div className="flex justify-end gap-1 whitespace-nowrap">
        {c.status !== "pago" && (
          <>
            {c.clients?.phone && (
              <a
                href={`https://wa.me/55${c.clients.phone}?text=${encodeURIComponent(
                  `Olá ${c.clients?.name ?? ""}! Consta em aberto o valor de ${formatBRL(
                    Number(c.amount) - (c.paid_total ?? 0)
                  )} com vencimento em ${formatDate(c.due_date)}. Podemos conversar sobre a regularização?`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cobrar no WhatsApp"
                  title="Cobrar no WhatsApp"
                  className="hover:bg-accent-soft hover:text-accent"
                >
                  <MessageCircle size={14} />
                </Button>
              </a>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={negotiatingIds.has(c.client_id) ? "Cliente em negociação" : "Criar negociação"}
              title={
                negotiatingIds.has(c.client_id)
                  ? "Já está em negociação — alguém está cuidando"
                  : "Criar negociação para este cliente"
              }
              className={negotiatingIds.has(c.client_id) ? "bg-warn-soft text-warn hover:bg-warn/20" : ""}
              onClick={() => handleCreateNegotiation(c)}
            >
              <Handshake size={14} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openPay(c)}>
              <CheckCircle2 size={13} /> Receber
            </Button>
          </>
        )}
        {c.status === "pago" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Desfazer pagamento"
            title="Desfazer pagamento (marcado errado)"
            className="hover:bg-warn-soft hover:text-warn"
            onClick={() => setUndoing(c)}
          >
            <RotateCcw size={14} />
          </Button>
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
    );
  }

  function exportCSV() {
    const header = "Cliente;Documento;Telefone;Valor;Pago;Saldo;Venda;Parcelas;Vencimento;Status;Dias em atraso";
    const rows = visible.map((c) => {
      const paid = c.paid_total ?? 0;
      const saldo = Number(c.amount) - paid;
      const dias = c.status === "atrasado" ? daysOverdue(c.due_date) : 0;
      const fmt = (v: number) => v.toFixed(2).replace(".", ",");
      return [
        c.clients?.name ?? "",
        c.clients?.document ?? "",
        c.clients?.phone ?? "",
        fmt(Number(c.amount)),
        fmt(paid),
        fmt(saldo),
        c.sale_date ? c.sale_date.split("-").reverse().join("/") : "",
        c.installments,
        c.due_date.split("-").reverse().join("/"),
        c.status,
        dias || "",
      ].join(";");
    });
    const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cobrancas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    setImportFileName("");
    listImportBatches().then(setBatches).catch(() => setBatches([]));
  }

  async function handleImportFile(file: File) {
    setPreview(null);
    setImportResult(null);
    setImportError(null);
    setImportFileName(file.name);
    try {
      const text = await readCsvFile(file);
      const { rows, errors } = parseNegotiationsCSV(text);
      if (rows.length === 0) {
        setImportError(errors[0] ?? "Nenhuma linha válida encontrada no arquivo.");
        return;
      }
      const checked = await checkDuplicates(rows);
      setPreview(checked);
      setPreviewErrors(errors);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro ao ler o arquivo.");
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    setProgress({ done: 0, total: 0 });
    try {
      const result = await importNegotiations(
        preview,
        importFileName,
        skipDuplicates,
        (done, total) => setProgress({ done, total })
      );
      result.errors = [...previewErrors, ...result.errors];
      setImportResult(result);
      setPreview(null);
      setToast(`${result.created} cobrança(s) importada(s).`);
      await load();
      listImportBatches().then(setBatches).catch(() => {});
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro ao importar.");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function handleDeleteBatch(batchId: string) {
    setDeletingBatch(batchId);
    try {
      const removed = await deleteImportBatch(batchId);
      setToast(`Importação excluída: ${removed} cobrança(s) removida(s).`);
      setBatches(await listImportBatches());
      await load();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Erro ao excluir importação.");
    } finally {
      setDeletingBatch(null);
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
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCSV} disabled={visible.length === 0}>
            <FileDown size={15} /> Exportar
          </Button>
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

      {/* Busca + ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            className="pl-9 h-9 text-sm"
            placeholder="Buscar cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="h-9 w-auto text-xs"
        >
          <option value="newest">Vencimento mais recente</option>
          <option value="oldest">Vencimento mais antigo</option>
          <option value="highest">Maior valor</option>
          <option value="lowest">Menor valor</option>
        </Select>
      </div>

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

      {/* Filtros ativos combinados (item 4) */}
      {(filter !== "todas" || agingFilter !== "todas" || search.trim()) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-faint">Filtros ativos:</span>
          {search.trim() && (
            <button
              onClick={() => setSearch("")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-fg hover:border-border-strong"
            >
              Busca: “{search.trim()}” <span className="text-faint">×</span>
            </button>
          )}
          {filter !== "todas" && (
            <button
              onClick={() => setFilter("todas")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-fg hover:border-border-strong"
            >
              {FILTERS.find((f) => f.value === filter)?.label} <span className="text-faint">×</span>
            </button>
          )}
          {agingFilter !== "todas" && (
            <button
              onClick={() => setAgingFilter("todas")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-fg hover:border-border-strong"
            >
              {AGING.find((a) => a.value === agingFilter)?.label} <span className="text-faint">×</span>
            </button>
          )}
          <button
            onClick={() => { setFilter("todas"); setAgingFilter("todas"); setSearch(""); }}
            className="text-accent hover:underline"
          >
            Limpar tudo
          </button>
        </div>
      )}

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
            title={search.trim() ? "Nenhum resultado" : "Nenhuma cobrança aqui"}
            description={
              search.trim()
                ? `Nenhum cliente com "${search.trim()}" nos filtros atuais.`
                : filter === "todas" && agingFilter === "todas"
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
                <TH className="hidden 2xl:table-cell">Parc.</TH>
                <TH>Vencimento</TH>
                <TH className="hidden 2xl:table-cell">Obs.</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {paginatedGroups.map((g) => {
                // Cliente com 1 cobrança só: linha normal, sem agrupar.
                if (g.charges.length === 1) {
                  const c = g.charges[0];
                  const overdue = c.status === "atrasado" ? daysOverdue(c.due_date) : 0;
                  return (
                    <TR key={c.id}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">
                            {c.clients?.name ?? "—"}
                            {c.clients?.phone && (
                              <span className="block font-mono text-[11px] font-normal text-faint">
                                {c.clients.phone}
                              </span>
                            )}
                          </span>
                        </span>
                      </TD>
                      <TD className="font-mono">
                        {formatBRL(Number(c.amount))}
                        {(c.paid_total ?? 0) > 0 && c.status !== "pago" && (
                          <span className="block text-[11px] text-accent">
                            {formatBRL(c.paid_total ?? 0)} pago
                          </span>
                        )}
                      </TD>
                      <TD className="hidden text-muted lg:table-cell">
                        {c.sale_date ? formatDate(c.sale_date) : "—"}
                      </TD>
                      <TD className="hidden font-mono text-muted 2xl:table-cell">
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
                      <TD className="hidden max-w-[140px] 2xl:table-cell">
                        {c.observation ? (
                          <span className="block truncate text-xs text-muted" title={c.observation}>
                            {c.observation}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </TD>
                      <TD><StatusBadge status={c.status} hasPaidPartial={(c.paid_total ?? 0) > 0} /></TD>
                      <TD>{chargeActions(c)}</TD>
                    </TR>
                  );
                }

                // Cliente com várias cobranças: linha agrupada com o total
                // e um "+N" — clicar abre o modal com cada cobrança.
                const first = g.charges[0];
                return (
                  <TR
                    key={g.clientId}
                    className="cursor-pointer hover:bg-raised/60"
                    onClick={() => setViewingClientId(g.clientId)}
                  >
                    <TD>
                      <span className="flex items-center gap-2">
                        <span className="font-medium">
                          {first.clients?.name ?? "—"}
                          {first.clients?.phone && (
                            <span className="block font-mono text-[11px] font-normal text-faint">
                              {first.clients.phone}
                            </span>
                          )}
                        </span>
                        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                          +{g.charges.length - 1}
                        </span>
                      </span>
                    </TD>
                    <TD className="font-mono">
                      {formatBRL(g.total)}
                      <span className="block text-[11px] text-muted">
                        {g.allPaid ? "recebido" : "em aberto"}
                      </span>
                    </TD>
                    <TD className="hidden text-muted lg:table-cell">—</TD>
                    <TD className="hidden font-mono text-muted 2xl:table-cell">—</TD>
                    <TD className="text-muted">{g.charges.length} cobranças</TD>
                    <TD className="hidden max-w-[140px] 2xl:table-cell">
                      <span className="text-faint">—</span>
                    </TD>
                    <TD><StatusBadge status={g.worstStatus} /></TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingClientId(g.clientId);
                          }}
                        >
                          Ver cobranças <ChevronRight size={13} />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        {!loading && paginatedGroups.length > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-raised/40 px-5 py-3">
            <span className="text-xs font-medium text-muted">
              Total desta página ({paginatedGroups.reduce((s, g) => s + g.charges.length, 0)} cobranças de{" "}
              {paginatedGroups.length} {paginatedGroups.length === 1 ? "cliente" : "clientes"})
            </span>
            <span className="font-mono text-sm font-semibold text-fg">
              {formatBRL(
                paginatedGroups.reduce(
                  (sum, g) => sum + g.charges.reduce((s, c) => s + Number(c.amount), 0),
                  0
                )
              )}
            </span>
          </div>
        )}
      </Card>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-xs text-faint">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, groupsSorted.length)} de{" "}
            {groupsSorted.length} {groupsSorted.length === 1 ? "cliente" : "clientes"}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Anterior
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima →
            </Button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-up rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-fg shadow-pop">
          {toast}
        </div>
      )}

      {/* Importar planilha do ERP (com preview + lotes) */}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar carteira de cobrança"
        className="max-w-3xl"
      >
        <div className="space-y-4">
          {!preview && !importResult && (
            <>
              <p className="text-sm text-muted">
                Exporte do ERP, ajuste os cabeçalhos para{" "}
                <span className="font-mono text-xs text-fg">Código; Nome; Total; Data da Venda; Vencimento; Telefone; Observação</span>{" "}
                e salve como CSV. Telefone e Observação são opcionais. O sistema agrupa por
                código, soma o saldo e usa a data mais recente.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={downloadNegTemplate}>
                  <Download size={14} /> Baixar modelo
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover">
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

              {/* Histórico de lotes */}
              {batches.length > 0 && (
                <div className="mt-2 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
                    Importações anteriores
                  </p>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {batches.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">
                            {b.file_name || "Importação"}
                          </p>
                          <p className="text-xs text-faint">
                            {formatDate(b.created_at)} · {b.row_count} cobranças ·{" "}
                            <span className="font-mono">{formatBRL(Number(b.total_amount))}</span>
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 hover:bg-danger-soft hover:text-danger"
                          disabled={deletingBatch === b.id}
                          onClick={() => handleDeleteBatch(b.id)}
                        >
                          {deletingBatch === b.id ? "Excluindo..." : <><Trash2 size={13} /> Excluir</>}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Excluir uma importação remove todas as cobranças dela.
                  </p>
                </div>
              )}
            </>
          )}

          {importError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {importError}
            </p>
          )}

          {/* PREVIEW */}
          {preview && (() => {
            const dupCount = preview.filter((r) => r.isDuplicate).length;
            const willImport = skipDuplicates ? preview.filter((r) => !r.isDuplicate).length : preview.length;
            return (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium text-fg">
                    Prévia: {preview.length} {preview.length === 1 ? "cliente" : "clientes"}
                  </p>
                  <p className="font-mono text-sm text-accent">
                    {formatBRL(preview.reduce((s, r) => s + r.total, 0))}
                  </p>
                </div>

                {dupCount > 0 && (
                  <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm">
                    <p className="font-medium text-warn">
                      {dupCount} {dupCount === 1 ? "cobrança idêntica já existe" : "cobranças idênticas já existem"} (mesmo nome, valor, venda e vencimento).
                    </p>
                    <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-fg">
                      <input
                        type="checkbox"
                        checked={skipDuplicates}
                        onChange={(e) => setSkipDuplicates(e.target.checked)}
                        className="h-3.5 w-3.5 accent-[#159A63]"
                      />
                      Pular as duplicadas (recomendado) — importar apenas {willImport} nova(s)
                    </label>
                  </div>
                )}

                <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-border bg-surface">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Cód.</th>
                        <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Nome</th>
                        <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-faint">Total</th>
                        <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint">Venc.</th>
                        <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-faint"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {preview.map((r) => (
                        <tr key={r.code} className={r.isDuplicate ? "opacity-50" : ""}>
                          <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                          <td className="px-3 py-2 text-fg">{r.name}</td>
                          <td className="px-3 py-2 text-right font-mono text-fg">{formatBRL(r.total)}</td>
                          <td className="px-3 py-2 font-mono text-muted">{formatDate(r.newest_due)}</td>
                          <td className="px-3 py-2">
                            {r.isDuplicate && (
                              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium text-warn">
                                já existe
                              </span>
                            )}
                          </td>
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
                {importing && progress && progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-center text-xs text-faint">
                      {Math.round((progress.done / progress.total) * 100)}% concluído
                    </p>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" onClick={resetImport} disabled={importing}>Escolher outro arquivo</Button>
                  <Button onClick={confirmImport} disabled={importing || willImport === 0}>
                    {importing
                      ? progress && progress.total > 0
                        ? `Importando ${progress.done} de ${progress.total}...`
                        : "Preparando..."
                      : `Confirmar importação (${willImport})`}
                  </Button>
                </div>
              </>
            );
          })()}

          {/* RESULTADO */}
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
          {editing && (
            <div>
              <Label htmlFor="ch-phone">Telefone / WhatsApp do cliente</Label>
              <Input
                id="ch-phone"
                className="font-mono"
                inputMode="tel"
                placeholder="65999990000"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <p className="mt-1.5 text-xs text-faint">
                Salvar aqui atualiza o cadastro do cliente e libera o botão de WhatsApp.
              </p>
            </div>
          )}
          <div>
            <Label htmlFor="ch-desc">Descrição</Label>
            <Textarea
              id="ch-desc"
              placeholder="Ex.: Parcela 2/6 — venda de insumos"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="ch-obs">Observação</Label>
            <Textarea
              id="ch-obs"
              placeholder="Ex.: cliente pediu para ligar após as 18h"
              value={form.observation}
              onChange={(e) => setForm({ ...form, observation: e.target.value })}
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
            de <span className="font-medium text-fg">{paying?.clients?.name}</span>
            {(paying?.paid_total ?? 0) > 0 && (
              <>
                {" "}— já recebido{" "}
                <span className="font-mono text-accent">
                  {formatBRL(paying?.paid_total ?? 0)}
                </span>
              </>
            )}
            .
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pay-amount">Valor recebido (R$)</Label>
              <Input
                id="pay-amount"
                className="font-mono"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-faint">
                Menor que o saldo = pagamento parcial.
              </p>
            </div>
            <div>
              <Label htmlFor="pay-date">Data do pagamento</Label>
              <Input
                id="pay-date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
          </div>
          {payError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {payError}
            </p>
          )}

          {/* Histórico de pagamentos desta cobrança */}
          {payHistory.length > 0 && (
            <div className="rounded-md border border-border bg-bg">
              <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint">
                Pagamentos registrados
              </p>
              <ul className="divide-y divide-border/60">
                {payHistory.map((pmt) => (
                  <li key={pmt.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-muted">{formatDate(pmt.paid_date)}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-accent">{formatBRL(Number(pmt.amount))}</span>
                      <button
                        onClick={() => handleDeletePayment(pmt.id)}
                        className="text-faint transition-colors hover:text-danger"
                        title="Remover este pagamento"
                        aria-label="Remover pagamento"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-border px-3 py-2 text-right text-xs">
                <span className="text-faint">Total recebido: </span>
                <span className="font-mono font-semibold text-accent">
                  {formatBRL(payHistory.reduce((s, p) => s + Number(p.amount), 0))}
                </span>
              </p>
              {paying && (() => {
                const remaining = Number(paying.amount) - payHistory.reduce((s, p) => s + Number(p.amount), 0);
                return remaining > 0.009 ? (
                  <p className="border-t border-border px-3 py-2 text-right text-xs">
                    <span className="text-faint">Falta receber: </span>
                    <span className="font-mono font-semibold text-warn">
                      {formatBRL(remaining)}
                    </span>
                  </p>
                ) : null;
              })()}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setPaying(null)}>Fechar</Button>
            <Button variant="success" onClick={confirmPay}>
              <CheckCircle2 size={14} /> Registrar pagamento
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!viewingGroup}
        onClose={() => setViewingClientId(null)}
        title={viewingGroup ? `${viewingGroup.charges[0].clients?.name ?? "Cliente"}` : "Cobranças"}
        className="max-w-lg"
      >
        {viewingGroup && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md bg-raised px-3 py-2">
              <span className="text-xs text-muted">
                {viewingGroup.charges.length} cobranças
              </span>
              <span className="font-mono text-sm font-semibold text-fg">
                {formatBRL(viewingGroup.total)}
                <span className="ml-1 text-[11px] font-normal text-muted">
                  {viewingGroup.allPaid ? "recebido" : "em aberto"}
                </span>
              </span>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {viewingCharges.map((c) => {
                const overdue = c.status === "atrasado" ? daysOverdue(c.due_date) : 0;
                return (
                  <div key={c.id} className="space-y-2 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-sm font-semibold text-fg">
                          {formatBRL(Number(c.amount))}
                        </span>
                        {(c.paid_total ?? 0) > 0 && c.status !== "pago" && (
                          <span className="ml-2 text-[11px] text-accent">
                            {formatBRL(c.paid_total ?? 0)} pago
                          </span>
                        )}
                        <span className={cn("ml-2 text-xs", c.status === "atrasado" ? "text-danger" : "text-muted")}>
                          venc. {formatDate(c.due_date)}
                        </span>
                        {overdue > 0 && (
                          <span className="ml-1 font-mono text-xs text-danger">+{overdue}d</span>
                        )}
                        {c.status === "pago" && c.paid_at && (
                          <span className="ml-2 font-mono text-xs text-accent">
                            pago {formatDate(c.paid_at)}
                          </span>
                        )}
                      </div>
                      <StatusBadge status={c.status} hasPaidPartial={(c.paid_total ?? 0) > 0} />
                    </div>
                    {c.observation && (
                      <p className="text-xs text-muted">{c.observation}</p>
                    )}
                    {chargeActions(c)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!undoing} onClose={() => setUndoing(null)} title="Desfazer pagamento">
        <p className="text-sm text-muted">
          Desfazer o pagamento de{" "}
          <span className="font-mono text-fg">{undoing && formatBRL(Number(undoing.amount))}</span>{" "}
          de <span className="font-medium text-fg">{undoing?.clients?.name}</span>? A cobrança volta
          a ficar em aberto (pendente ou atrasada, conforme o vencimento) e o histórico de pagamento
          desta cobrança é apagado.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setUndoing(null)}>Cancelar</Button>
          <Button variant="danger" disabled={undoLoading} onClick={handleUndo}>
            {undoLoading ? "Desfazendo..." : "Desfazer pagamento"}
          </Button>
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
