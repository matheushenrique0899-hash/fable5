"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Handshake, Pencil, Trash2 } from "lucide-react";
import {
  listNegotiations,
  createNegotiation,
  updateNegotiation,
  deleteNegotiation,
} from "@/lib/services/negotiations";
import { listCharges, computeAging, refreshOverdue } from "@/lib/services/charges";
import { listAllClientsLite } from "@/lib/services/clients";
import type { Negotiation, NegotiationStatus } from "@/lib/types";
import { NEGOTIATION_LABELS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatBRL, formatDate } from "@/lib/utils";
import type { AgingBucket } from "@/lib/services/charges";

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
};

export default function NegociacaoPage() {
  const [all, setAll] = useState<Negotiation[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [aging, setAging] = useState<AgingBucket[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Negotiation | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Negotiation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshOverdue();
      const [negotiations, charges] = await Promise.all([
        listNegotiations("todas"),
        listCharges("todas"),
      ]);
      setAll(negotiations);
      setAging(computeAging(charges));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
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
      if (editing) await updateNegotiation(editing.id, form);
      else await createNegotiation(form);
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

      {/* KPIs: faixas de atraso da carteira em aberto */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {aging.map((b, i) => (
          <Card key={b.label} className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {b.label}
            </p>
            <p
              className={cn(
                "mt-1.5 font-mono text-lg font-semibold",
                i === 0 ? "text-fg" : i <= 2 ? "text-warn" : "text-danger"
              )}
            >
              {formatBRL(b.amount)}
            </p>
            <p className="text-xs text-muted">
              {b.count} {b.count === 1 ? "cobrança" : "cobranças"}
            </p>
          </Card>
        ))}
      </div>

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
                  </TD>
                  <TD>
                    <div className="flex justify-end gap-1">
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
