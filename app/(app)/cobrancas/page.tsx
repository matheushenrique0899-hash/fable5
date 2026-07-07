"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt, Plus, CheckCircle2, Trash2 } from "lucide-react";
import {
  listCharges,
  createCharge,
  markAsPaid,
  deleteCharge,
  refreshOverdue,
} from "@/lib/services/charges";
import { listAllClientsLite } from "@/lib/services/clients";
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

const emptyForm = { client_id: "", amount: "", due_date: "", sale_date: "", installments: "1", description: "" };

export default function CobrancasPage() {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Charge | null>(null);

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

  const openTotal = charges
    .filter((c) => c.status !== "pago")
    .reduce((s, c) => s + Number(c.amount), 0);

  async function handleCreate() {
    setFormError(null);
    const amount = Number(form.amount.replace(",", "."));
    if (!form.client_id) return setFormError("Selecione o cliente.");
    if (!amount || amount <= 0) return setFormError("Informe um valor maior que zero.");
    if (!form.due_date) return setFormError("Informe a data de vencimento.");

    setSaving(true);
    try {
      await createCharge({
        client_id: form.client_id,
        amount,
        due_date: form.due_date,
        sale_date: form.sale_date || undefined,
        installments: Math.max(parseInt(form.installments) || 1, 1),
        description: form.description,
      });
      setDialogOpen(false);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao criar cobrança.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkPaid(id: string) {
    await markAsPaid(id);
    await load();
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteCharge(deleting.id);
    setDeleting(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cobranças</h1>
          <p className="mt-1 text-sm text-muted">
            {formatBRL(openTotal)} em aberto {filter !== "todas" && "(filtro aplicado)"}
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setFormError(null); setDialogOpen(true); }}>
          <Plus size={15} /> Nova cobrança
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
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
      </div>

      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-raised" />
            ))}
          </div>
        ) : charges.length === 0 ? (
          <EmptyState
            icon={<Receipt size={18} />}
            title="Nenhuma cobrança aqui"
            description={
              filter === "todas"
                ? "Crie a primeira cobrança vinculada a um cliente."
                : "Nenhuma cobrança com esse status no momento."
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
                <TH className="hidden md:table-cell">Descrição</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {charges.map((c) => {
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
                        <span className="ml-2 font-mono text-xs text-danger">
                          +{overdue}d
                        </span>
                      )}
                    </TD>
                    <TD className="hidden max-w-[220px] truncate text-muted md:table-cell">
                      {c.description || "—"}
                    </TD>
                    <TD><StatusBadge status={c.status} /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {c.status !== "pago" && (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => handleMarkPaid(c.id)}
                          >
                            <CheckCircle2 size={13} /> Marcar pago
                          </Button>
                        )}
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nova cobrança">
        <div className="space-y-4">
          <div>
            <Label htmlFor="ch-client">Cliente</Label>
            <Select
              id="ch-client"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
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
              placeholder="Ex.: Parcela 2/6 — consultoria de crédito"
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
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Criando..." : "Criar cobrança"}
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
