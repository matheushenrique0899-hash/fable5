"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt, Plus, CheckCircle2, Trash2, Pencil, Handshake } from "lucide-react";
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
  { value: "d30", label: "1\u201330 dias", min: 1, max: 30 },
  { value: "d60", label: "31\u201360 dias", min: 31, max: 60 },
  { value: "d90", label: "61\u201390 dias", min: 61, max: 90 },
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
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
      return setFormError("A data da venda n\u00e3o pode ser depois do vencimento.");

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
      setFormError(e instanceof Error ? e.message : "Erro ao salvar cobran\u00e7a.");
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
      const res = await ensureNegotiationForClient(c.client_id);
      setToast(
        res === "criada"
          ? `Negocia\u00e7\u00e3o criada para ${c.clients?.name ?? "o cliente"}.`
          : `${c.clients?.name ?? "O cliente"} j\u00e1 tem uma negocia\u00e7\u00e3o ativa.`
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Erro ao criar negocia\u00e7\u00e3o.");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cobran\u00e7as</h1>
          <p className="mt-1 text-sm text-muted">
            {formatBRL(openTotal)} em aberto
            {(filter !== "todas" || agingFilter !== "todas") && " (filtro aplicado)"}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={15} /> Nova cobran\u00e7a
        </Button>
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
            title="Nenhuma cobran\u00e7a aqui"
            description={
              filter === "todas" && agingFilter === "todas"
                ? "Crie a primeira cobran\u00e7a ou importe a carteira na aba Negocia\u00e7\u00e3o."
                : "Nenhuma cobran\u00e7a com esses filtros no momento."
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
                <TH className="text-right">A\u00e7\u00f5es</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((c) => {
                const overdue = c.status === "atrasado" ? daysOverdue(c.due_date) : 0;
                return (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.clients?.name ?? "\u2014"}</TD>
                    <TD className="font-mono">{formatBRL(Number(c.amount))}</TD>
                    <TD className="hidden text-muted lg:table-cell">
                      {c.sale_date ? formatDate(c.sale_date) : "\u2014"}
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
                              aria-label="Criar negocia\u00e7\u00e3o"
                              title="Criar negocia\u00e7\u00e3o para este cliente"
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar cobran\u00e7a" : "Nova cobran\u00e7a"}
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
                Cadastre um cliente antes de criar cobran\u00e7as.
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
            <Label htmlFor="ch-desc">Descri\u00e7\u00e3o</Label>
            <Textarea
              id="ch-desc"
              placeholder="Ex.: Parcela 2/6 \u2014 venda de insumos"
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
              {saving ? "Salvando..." : editing ? "Salvar altera\u00e7\u00f5es" : "Criar cobran\u00e7a"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!paying} onClose={() => setPaying(null)} title="Registrar pagamento">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Cobran\u00e7a de{" "}
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

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir cobran\u00e7a">
        <p className="text-sm text-muted">
          Excluir a cobran\u00e7a de{" "}
          <span className="font-mono text-fg">{deleting && formatBRL(Number(deleting.amount))}</span>{" "}
          de <span className="font-medium text-fg">{deleting?.clients?.name}</span>? Essa a\u00e7\u00e3o n\u00e3o
          pode ser desfeita.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Excluir cobran\u00e7a</Button>
        </div>
      </Dialog>
    </div>
  );
}
