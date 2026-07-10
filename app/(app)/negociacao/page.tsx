"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Handshake, Pencil, Trash2, History, Plus, CheckCircle2, RotateCcw, Receipt, MessageCircle, ArrowRight } from "lucide-react";
import {
  listNegotiations,
  updateNegotiation,
  deleteNegotiation,
  listContacts,
  addContact,
  listInstallments,
  generateInstallments,
  payInstallment,
  unpayInstallment,
  applyAgreementToCharges,
  listCollectionPriorities,
} from "@/lib/services/negotiations";
import { refreshOverdue, markAsPaid, ensureNegotiationForClient } from "@/lib/services/charges";
import { listAllClientsLite } from "@/lib/services/clients";
import type { Negotiation, NegotiationStatus, NegotiationContact, AgreementInstallment, NegotiationArgument, Charge } from "@/lib/types";
import { NEGOTIATION_LABELS, ARGUMENT_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, daysOverdue, formatBRL, formatDate } from "@/lib/utils";

type Filter = NegotiationStatus | "todas";

const STATUS_ORDER: NegotiationStatus[] = [
  "em_negociacao",
  "aguardando_retorno",
  "aceitou",
  "recusou",
  "nao_localizado",
];

const STATUS_STYLE: Record<NegotiationStatus, { badge: string; bar: string }> = {
  em_negociacao:      { badge: "bg-info-soft text-info border-info/25",       bar: "bg-info" },
  aguardando_retorno: { badge: "bg-warn-soft text-warn border-warn/25",       bar: "bg-warn" },
  aceitou:            { badge: "bg-accent-soft text-accent border-accent/25", bar: "bg-accent" },
  recusou:            { badge: "bg-danger-soft text-danger border-danger/25", bar: "bg-danger" },
  nao_localizado:     { badge: "bg-raised text-muted border-border",          bar: "bg-faint" },
};

const emptyForm = {
  client_id: "",
  status: "em_negociacao" as NegotiationStatus,
  responsible: "",
  first_contact: "",
  last_contact: "",
  notes: "",
  argument: "" as "" | NegotiationArgument,
  agreed_amount: "",
  agreed_installments: "",
  agreed_due: "",
};

export default function NegociacaoPage() {
  const [all, setAll] = useState<Negotiation[]>([]);
  const [priorities, setPriorities] = useState<Charge[]>([]);
  const [priorityToast, setPriorityToast] = useState<string | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Negotiation | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Negotiation | null>(null);

  // Histórico de contatos
  const [historyOf, setHistoryOf] = useState<Negotiation | null>(null);
  const [contacts, setContacts] = useState<NegotiationContact[] | null>(null);
  const [newContactDate, setNewContactDate] = useState("");
  const [newContactNote, setNewContactNote] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  // Parcelas do acordo
  const [installments, setInstallments] = useState<AgreementInstallment[] | null>(null);
  const [historyTab, setHistoryTab] = useState<"contacts" | "installments">("contacts");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshOverdue();
      const [negotiations, prios] = await Promise.all([
        listNegotiations("todas"),
        listCollectionPriorities(10),
      ]);
      setAll(negotiations);
      setPriorities(prios as Charge[]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handlePriorityPay(id: string) {
    await markAsPaid(id);
    await load();
  }

  async function handlePriorityNegotiation(c: Charge) {
    try {
      await ensureNegotiationForClient(c.client_id);
      setPriorityToast(`Negociação criada para ${c.clients?.name ?? "o cliente"}.`);
      await load();
    } catch (e) {
      setPriorityToast(e instanceof Error ? e.message : "Erro ao criar negociação.");
    }
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!priorityToast) return;
    const t = setTimeout(() => setPriorityToast(null), 4000);
    return () => clearTimeout(t);
  }, [priorityToast]);
  useEffect(() => { listAllClientsLite().then(setClients); }, []);

  const filtered = filter === "todas" ? all : all.filter((n) => n.status === filter);

  // Distribuição percentual por status (sempre sobre o total)
  const distribution = useMemo(() => {
    const total = all.length || 1;
    return STATUS_ORDER.map((s) => {
      const count = all.filter((n) => n.status === s).length;
      return { status: s, count, pct: Math.round((count / total) * 100) };
    });
  }, [all]);

  function openEdit(n: Negotiation) {
    setEditing(n);
    setForm({
      client_id: n.client_id,
      status: n.status,
      responsible: n.responsible ?? "",
      first_contact: n.first_contact ?? "",
      last_contact: n.last_contact ?? "",
      notes: n.notes ?? "",
      argument: n.argument ?? "",
      agreed_amount: n.agreed_amount ? String(n.agreed_amount).replace(".", ",") : "",
      agreed_installments: n.agreed_installments ? String(n.agreed_installments) : "",
      agreed_due: n.agreed_due ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (!form.client_id) return setFormError("Selecione o cliente.");
    if (
      form.first_contact &&
      form.last_contact &&
      form.last_contact < form.first_contact
    )
      return setFormError("O último contato não pode ser anterior ao primeiro.");

    setSaving(true);
    try {
      const agreed = form.status === "aceitou";
      const agreedAmount = agreed && form.agreed_amount
        ? Number(form.agreed_amount.replace(/\./g, "").replace(",", "."))
        : null;
      const agreedInst = agreed && form.agreed_installments
        ? Math.max(parseInt(form.agreed_installments) || 1, 1)
        : null;
      const agreedDue = agreed ? form.agreed_due || null : null;

      const payload = {
        ...form,
        argument: form.argument || null,
        agreed_amount: agreedAmount,
        agreed_installments: agreedInst,
        agreed_due: agreedDue,
      };
      if (editing) {
        await updateNegotiation(editing.id, payload);
        if (payload.status === "aceitou" && agreedAmount && agreedInst && agreedDue) {
          await generateInstallments(editing.id, agreedAmount, agreedInst, agreedDue);
          // Reflete o acordo como observação nas cobranças do cliente
          await applyAgreementToCharges(editing.client_id, agreedAmount, agreedInst, agreedDue);
        }
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar negociação.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteNegotiation(deleting.id);
    setDeleting(null);
    await load();
  }

  async function openHistory(n: Negotiation) {
    setHistoryOf(n);
    setContacts(null);
    setInstallments(null);
    setNewContactDate(new Date().toISOString().slice(0, 10));
    setNewContactNote("");
    setContactError(null);
    setHistoryTab(n.status === "aceitou" && n.agreed_installments ? "installments" : "contacts");
    try {
      const [c, inst] = await Promise.all([
        listContacts(n.id),
        n.status === "aceitou" ? listInstallments(n.id) : Promise.resolve([]),
      ]);
      setContacts(c);
      setInstallments(inst);
    } catch {
      setContacts([]);
      setInstallments([]);
    }
  }

  async function handleAddContact() {
    if (!historyOf) return;
    setContactError(null);
    if (!newContactNote.trim()) return setContactError("Descreva o contato.");
    if (!newContactDate) return setContactError("Informe a data.");
    setSavingContact(true);
    try {
      await addContact(historyOf, newContactDate, newContactNote);
      setContacts(await listContacts(historyOf.id));
      setNewContactNote("");
      await load(); // atualiza primeiro/último contato na tabela
    } catch (e) {
      setContactError(e instanceof Error ? e.message : "Erro ao registrar contato.");
    } finally {
      setSavingContact(false);
    }
  }

  async function handlePayInstallment(id: string, paid: boolean) {
    if (paid) await unpayInstallment(id);
    else await payInstallment(id);
    if (historyOf) setInstallments(await listInstallments(historyOf.id));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Em negociação</h1>
          <p className="mt-1 text-sm text-muted">
            Acompanhamento das tratativas de cobrança com cada cliente.
          </p>
        </div>
      </header>

      {/* Prioridades de cobrança */}
      <Card>
        <CardHeader>
          <CardTitle>Prioridades de cobrança</CardTitle>
          <Link
            href="/cobrancas?status=atrasado"
            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            Ver todas <ArrowRight size={12} />
          </Link>
        </CardHeader>
        {priorities.length === 0 ? (
          <EmptyState
            icon={<Receipt size={18} />}
            title="Nada em atraso"
            description="Nenhuma cobrança vencida na carteira. Bom trabalho."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH className="text-right">Valor</TH>
                <TH>Atraso</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {priorities.map((c) => {
                const days = daysOverdue(c.due_date);
                const phone = c.clients?.phone ?? null;
                const waText = encodeURIComponent(
                  `Olá ${c.clients?.name ?? ""}! Consta em aberto o valor de ${formatBRL(
                    Number(c.amount)
                  )} com vencimento em ${formatDate(c.due_date)}. Podemos conversar sobre a regularização?`
                );
                return (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.clients?.name ?? "—"}</TD>
                    <TD className="text-right font-mono">{formatBRL(Number(c.amount))}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/25 bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        Atrasado há {days}d
                      </span>
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {phone ? (
                          <a href={`https://wa.me/55${phone}?text=${waText}`} target="_blank" rel="noopener noreferrer">
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
                        ) : (
                          <Button variant="ghost" size="icon" disabled aria-label="Sem telefone cadastrado" title="Cliente sem telefone cadastrado">
                            <MessageCircle size={14} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Criar negociação"
                          title="Criar negociação para este cliente"
                          onClick={() => handlePriorityNegotiation(c)}
                        >
                          <Handshake size={14} />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handlePriorityPay(c.id)}>
                          <CheckCircle2 size={13} /> Receber
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

      {priorityToast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-up rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-fg shadow-pop">
          {priorityToast}
        </div>
      )}

      {/* Distribuição por status */}
      <Card>
        <CardHeader>
          <CardTitle>Distribuição das negociações</CardTitle>
          <span className="font-mono text-xs text-faint">{all.length} no total</span>
        </CardHeader>
        <CardContent className="space-y-3">
          {distribution.map(({ status, count, pct }) => (
            <button
              key={status}
              onClick={() => setFilter(filter === status ? "todas" : status)}
              className="group block w-full text-left"
            >
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className={cn("font-medium", filter === status ? "text-fg" : "text-muted")}>
                  {NEGOTIATION_LABELS[status]}
                </span>
                <span className="font-mono text-faint">
                  {count} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div
                  className={cn("h-full rounded-full transition-all", STATUS_STYLE[status].bar,
                    filter !== "todas" && filter !== status && "opacity-30")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          ))}
          <p className="pt-1 text-xs text-faint">
            Clique em uma barra para filtrar a lista abaixo.
          </p>
        </CardContent>
      </Card>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "todas"} onClick={() => setFilter("todas")}>
          Todas
        </FilterChip>
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {NEGOTIATION_LABELS[s]}
          </FilterChip>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-raised" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Handshake size={18} />}
            title={filter === "todas" ? "Nenhuma negociação" : "Nada com esse status"}
            description={
              filter === "todas"
                ? "Registre a primeira tratativa de cobrança com um cliente."
                : "Nenhuma negociação com esse status no momento."
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH className="hidden md:table-cell">Responsável</TH>
                <TH className="hidden lg:table-cell">1º contato</TH>
                <TH className="hidden md:table-cell">Último contato</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((n) => (
                <TR key={n.id}>
                  <TD>
                    <span className="font-medium">{n.clients?.name ?? "—"}</span>
                    {n.argument && (
                      <span className="mt-0.5 block">
                        <span className="inline-block rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-muted">
                          {ARGUMENT_LABELS[n.argument]}
                        </span>
                      </span>
                    )}
                    {n.notes && (
                      <span
                        className="block max-w-[260px] truncate text-xs text-faint"
                        title={n.notes}
                      >
                        {n.notes}
                      </span>
                    )}
                  </TD>
                  <TD className="hidden text-muted md:table-cell">{n.responsible || "—"}</TD>
                  <TD className="hidden text-muted lg:table-cell">
                    {n.first_contact ? formatDate(n.first_contact) : "—"}
                  </TD>
                  <TD className="hidden text-muted md:table-cell">
                    {n.last_contact ? formatDate(n.last_contact) : "—"}
                  </TD>
                  <TD>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        STATUS_STYLE[n.status].badge
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {NEGOTIATION_LABELS[n.status]}
                    </span>
                    {n.status === "aceitou" && n.agreed_amount && (
                      <span className="mt-1 block font-mono text-[11px] text-accent">
                        {formatBRL(Number(n.agreed_amount))}
                        {n.agreed_installments ? ` em ${n.agreed_installments}x` : ""}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Histórico de contatos"
                        title="Histórico de contatos"
                        onClick={() => openHistory(n)}
                      >
                        <History size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => openEdit(n)}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir"
                        className="hover:bg-danger-soft hover:text-danger"
                        onClick={() => setDeleting(n)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Criar / editar */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar negociação" : "Nova negociação"}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="n-client">Cliente</Label>
              <Select
                id="n-client"
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                disabled={!!editing}
              >
                <option value="">Selecionar cliente...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="n-status">Status</Label>
              <Select
                id="n-status"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as NegotiationStatus })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{NEGOTIATION_LABELS[s]}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="n-resp">Funcionário responsável</Label>
            <Input
              id="n-resp"
              placeholder="Ex.: Ana Paula"
              value={form.responsible}
              onChange={(e) => setForm({ ...form, responsible: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="n-first">Primeiro contato</Label>
              <Input
                id="n-first"
                type="date"
                value={form.first_contact}
                onChange={(e) => setForm({ ...form, first_contact: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="n-last">Último contato</Label>
              <Input
                id="n-last"
                type="date"
                value={form.last_contact}
                onChange={(e) => setForm({ ...form, last_contact: e.target.value })}
              />
            </div>
          </div>
          {form.status === "aceitou" && (
            <div className="grid grid-cols-1 gap-4 rounded-md border border-accent/20 bg-accent-soft/40 p-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="n-agreed">Valor do acordo (R$)</Label>
                <Input
                  id="n-agreed"
                  className="font-mono"
                  inputMode="decimal"
                  placeholder="500,00"
                  value={form.agreed_amount}
                  onChange={(e) => setForm({ ...form, agreed_amount: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="n-inst">Parcelas</Label>
                <Input
                  id="n-inst"
                  className="font-mono"
                  type="number"
                  min={1}
                  placeholder="3"
                  value={form.agreed_installments}
                  onChange={(e) => setForm({ ...form, agreed_installments: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="n-due">1º vencimento</Label>
                <Input
                  id="n-due"
                  type="date"
                  value={form.agreed_due}
                  onChange={(e) => setForm({ ...form, agreed_due: e.target.value })}
                />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="n-argument">Argumento do cliente</Label>
            <Select
              id="n-argument"
              value={form.argument}
              onChange={(e) => setForm({ ...form, argument: e.target.value as "" | NegotiationArgument })}
            >
              <option value="">Selecionar motivo...</option>
              {(Object.keys(ARGUMENT_LABELS) as NegotiationArgument[]).map((k) => (
                <option key={k} value={k}>{ARGUMENT_LABELS[k]}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="n-notes">O que foi negociado</Label>
            <Textarea
              id="n-notes"
              placeholder="Ex.: cliente propôs quitar em 3x de R$ 500 com entrada dia 15; aguardando comprovante"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              {saving ? "Salvando..." : editing ? "Salvar alterações" : "Registrar negociação"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Histórico de contatos + parcelas */}
      <Dialog
        open={!!historyOf}
        onClose={() => setHistoryOf(null)}
        title={`Histórico — ${historyOf?.clients?.name ?? ""}`}
        className="max-w-lg"
      >
        <div className="space-y-4">
          {/* Abas */}
          {historyOf?.status === "aceitou" && historyOf.agreed_installments && (
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-1">
              {(["contacts", "installments"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHistoryTab(tab)}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    historyTab === tab ? "bg-raised text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {tab === "contacts" ? "Linha do tempo" : `Parcelas (${historyOf.agreed_installments}x)`}
                </button>
              ))}
            </div>
          )}

          {/* ABA: PARCELAS */}
          {historyTab === "installments" && historyOf?.status === "aceitou" && (
            <div className="space-y-2">
              {historyOf.agreed_amount && (
                <p className="text-xs text-muted">
                  Acordo de{" "}
                  <span className="font-mono text-fg">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(historyOf.agreed_amount))}
                  </span>{" "}
                  em {historyOf.agreed_installments}x
                  {(() => {
                    const paid = (installments ?? []).filter((i) => i.paid_at).length;
                    const total = (installments ?? []).length;
                    return total > 0
                      ? ` — ${paid} paga${paid !== 1 ? "s" : ""}, ${total - paid} em aberto`
                      : "";
                  })()}
                </p>
              )}
              {installments === null ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-raised" />
                  ))}
                </div>
              ) : installments.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted">
                  Nenhuma parcela gerada. Salve o acordo com valor, parcelas e 1º vencimento.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border">
                      <tr>
                        <th className="py-2 text-left text-xs uppercase tracking-wide text-faint">Parcela</th>
                        <th className="py-2 text-left text-xs uppercase tracking-wide text-faint">Vencimento</th>
                        <th className="py-2 text-right text-xs uppercase tracking-wide text-faint">Valor</th>
                        <th className="py-2 text-right text-xs uppercase tracking-wide text-faint">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {installments.map((inst) => (
                        <tr key={inst.id}>
                          <td className="py-2.5 font-mono text-muted">{inst.installment_no}ª</td>
                          <td className="py-2.5 text-fg">
                            {inst.due_date.split("-").reverse().join("/")}
                            {!inst.paid_at && new Date(inst.due_date + "T23:59:59") < new Date() && (
                              <span className="ml-2 text-xs text-danger">vencida</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right font-mono">
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(inst.amount))}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              onClick={() => handlePayInstallment(inst.id, !!inst.paid_at)}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                inst.paid_at
                                  ? "border-accent/25 bg-accent-soft text-accent hover:bg-danger-soft hover:text-danger hover:border-danger/25"
                                  : "border-border bg-raised text-muted hover:border-accent/25 hover:bg-accent-soft hover:text-accent"
                              }`}
                              title={inst.paid_at ? "Clique para desfazer" : "Clique para marcar pago"}
                            >
                              {inst.paid_at ? (
                                <><CheckCircle2 size={11} /> Paga</>
                              ) : (
                                <><RotateCcw size={11} /> Em aberto</>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ABA: CONTATOS */}
          {(historyTab === "contacts" || historyOf?.status !== "aceitou" || !historyOf?.agreed_installments) && (
            <div className="space-y-4">
              <div className="space-y-3 rounded-md border border-border bg-bg p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
                  <div>
                    <Label htmlFor="hc-date">Data</Label>
                    <Input
                      id="hc-date"
                      type="date"
                      value={newContactDate}
                      onChange={(e) => setNewContactDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hc-note">O que aconteceu</Label>
                    <Input
                      id="hc-note"
                      placeholder="Ex.: liguei, prometeu pagar dia 15"
                      value={newContactNote}
                      onChange={(e) => setNewContactNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddContact()}
                    />
                  </div>
                </div>
                {contactError && (
                  <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                    {contactError}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddContact} disabled={savingContact}>
                    <Plus size={13} /> {savingContact ? "Salvando..." : "Registrar contato"}
                  </Button>
                </div>
              </div>

              {contacts === null ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-9 animate-pulse rounded bg-raised" />
                  ))}
                </div>
              ) : contacts.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted">
                  Nenhum contato registrado ainda.
                </p>
              ) : (
                <ol className="max-h-64 space-y-0 overflow-y-auto">
                  {contacts.map((c, i) => (
                    <li key={c.id} className="relative flex gap-3 pb-4">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                        {i < contacts.length - 1 && (
                          <span className="w-px flex-1 bg-border" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-faint">
                          {formatDate(c.contact_date)}
                        </p>
                        <p className="text-sm text-fg">{c.note}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Confirmar exclusão */}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir negociação">
        <p className="text-sm text-muted">
          Excluir a negociação com{" "}
          <span className="font-medium text-fg">{deleting?.clients?.name}</span>? O histórico do
          que foi tratado será perdido.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Excluir negociação</Button>
        </div>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-border text-muted hover:border-border-strong hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
