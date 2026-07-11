"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Plus, Search, Pencil, Trash2, ChevronLeft, ChevronRight, Upload, Download, AlertTriangle, Merge } from "lucide-react";
import {
  listClients,
  createClientRecord,
  updateClientRecord,
  deleteClientRecord,
  parseClientsCSV,
  readCsvFile,
  importClients,
  findDuplicateClients,
  mergeClients,
  CSV_TEMPLATE,
  type ImportResult,
  type DuplicateGroup,
} from "@/lib/services/clients";
import type { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";

const emptyForm = { name: "", document: "", email: "", phone: "" };

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [primaryChoice, setPrimaryChoice] = useState<Record<string, string>>({});
  const [confirmedSame, setConfirmedSame] = useState<Record<string, boolean>>({});
  const [merging, setMerging] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listClients({ search: debounced, page });
      setClients(res.clients);
      setTotal(res.total);
      setPageSize(res.pageSize);
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { runDuplicateCheck(); }, []);

  async function runDuplicateCheck() {
    setCheckingDuplicates(true);
    try {
      const groups = await findDuplicateClients();
      setDuplicates(groups);
      const defaults: Record<string, string> = {};
      groups.forEach((g) => { defaults[g.key] = g.clients[0].id; });
      setPrimaryChoice((prev) => ({ ...defaults, ...prev }));
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function handleMerge(group: DuplicateGroup) {
    const primaryId = primaryChoice[group.key] ?? group.clients[0].id;
    const others = group.clients.filter((c) => c.id !== primaryId).map((c) => c.id);
    setMerging(group.key);
    try {
      await mergeClients(primaryId, others);
      setDuplicates((prev) => prev.filter((g) => g.key !== group.key));
      setConfirmedSame((prev) => { const n = { ...prev }; delete n[group.key]; return n; });
      await load();
    } finally {
      setMerging(null);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setForm({
      name: client.name,
      document: client.document,
      email: client.email ?? "",
      phone: client.phone ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (!form.name.trim()) return setFormError("Informe o nome do cliente.");
    if (!form.document.trim()) return setFormError("Informe o código do cliente.");

    setSaving(true);
    try {
      if (editing) await updateClientRecord(editing.id, form);
      else await createClientRecord(form);
      setDialogOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteClientRecord(deleting.id);
    setDeleting(null);
    await load();
  }

  async function handleFileSelected(file: File) {
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const text = await readCsvFile(file);
      const { rows, invalid } = parseClientsCSV(text);
      if (rows.length === 0) {
        setImportError(
          invalid.length > 0
            ? `Nenhuma linha válida. Primeiro problema: linha ${invalid[0].line} (${invalid[0].reason}).`
            : "Arquivo vazio ou em formato não reconhecido."
        );
        return;
      }
      const result = await importClients(rows);
      result.invalid = [...invalid, ...result.invalid];
      setImportResult(result);
      await load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro ao importar arquivo.");
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(["﻿" + CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-importacao-clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-1 text-sm text-muted">
            {total} {total === 1 ? "cliente cadastrado" : "clientes cadastrados"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => { setImportResult(null); setImportError(null); setImportOpen(true); }}
          >
            <Upload size={15} /> Importar
          </Button>
          <Button onClick={openCreate}>
            <Plus size={15} /> Novo cliente
          </Button>
        </div>
      </header>

      {duplicates.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} />
            {duplicates.length} {duplicates.length === 1 ? "nome repetido encontrado" : "nomes repetidos encontrados"} —
            pode ser o mesmo cliente com código errado, ou pessoas diferentes com nome igual.
          </span>
          <Button variant="secondary" size="sm" onClick={() => setDupOpen(true)}>
            <Merge size={13} /> Revisar
          </Button>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input
          className="pl-9"
          placeholder="Buscar por nome, código ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-raised" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <EmptyState
            icon={<Users size={18} />}
            title={debounced ? "Nenhum resultado" : "Nenhum cliente ainda"}
            description={
              debounced
                ? "Ajuste a busca ou limpe o filtro para ver todos."
                : "Cadastre seu primeiro cliente para começar a criar cobranças."
            }
            action={!debounced ? <Button size="sm" onClick={openCreate}><Plus size={14} /> Cadastrar cliente</Button> : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Nome</TH>
                  <TH>Código</TH>
                  <TH className="hidden md:table-cell">Contato</TH>
                  <TH className="hidden md:table-cell">Cadastro</TH>
                  <TH className="text-right">Ações</TH>
                </TR>
              </THead>
              <TBody>
                {clients.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.name}</TD>
                    <TD className="font-mono text-muted">{c.document}</TD>
                    <TD className="hidden text-muted md:table-cell">
                      <span className="block">{c.email || "—"}</span>
                      {c.phone && <span className="font-mono text-xs text-faint">{c.phone}</span>}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">{formatDate(c.created_at)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
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
                ))}
              </TBody>
            </Table>

            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <p className="text-xs text-faint">
                Página {page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={14} /> Anterior
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Criar / editar */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Editar cliente" : "Novo cliente"}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="c-name">Nome / Razão social</Label>
            <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Agro Silva Ltda" />
          </div>
          <div>
            <Label htmlFor="c-doc">Código</Label>
            <Input id="c-doc" className="font-mono" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} placeholder="Ex.: 3091" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-email">E-mail</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contato@empresa.com" />
            </div>
            <div>
              <Label htmlFor="c-phone">Telefone</Label>
              <Input id="c-phone" className="font-mono" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="65999990000" />
            </div>
          </div>
          {formError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar cliente"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Importação via planilha */}
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar clientes"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Exporte os clientes do seu ERP e salve como{" "}
            <span className="font-mono text-fg">CSV</span> (no Excel:{" "}
            <span className="text-fg">Salvar como → CSV</span>). Colunas na ordem:{" "}
            <span className="font-mono text-xs text-fg">nome; código; email; telefone</span>{" "}
            — e-mail e telefone são opcionais.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download size={14} /> Baixar modelo
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-hover">
              <Upload size={14} />
              {importing ? "Importando..." : "Escolher arquivo"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {importError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {importError}
            </p>
          )}

          {importResult && (
            <div className="space-y-1.5 rounded-md border border-border bg-bg px-3 py-2.5 text-sm">
              <p className="text-accent">
                {importResult.inserted} {importResult.inserted === 1 ? "cliente importado" : "clientes importados"}
              </p>
              {importResult.duplicates > 0 && (
                <p className="text-warn">
                  {importResult.duplicates} ignorado(s): código já cadastrado
                </p>
              )}
              {importResult.invalid.length > 0 && (
                <p className="text-danger">
                  {importResult.invalid.length} linha(s) inválida(s)
                  {importResult.invalid[0].line > 0 &&
                    ` — ex.: linha ${importResult.invalid[0].line} (${importResult.invalid[0].reason})`}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Dialog>

      {/* Nomes repetidos: revisar antes de mesclar */}
      <Dialog
        open={dupOpen}
        onClose={() => setDupOpen(false)}
        title="Nomes repetidos"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            O sistema identifica cliente pelo <span className="font-medium text-fg">código</span>, não
            pelo nome. Os cadastros abaixo têm o mesmo nome, mas podem ser a mesma pessoa (código errado
            por engano) ou pessoas diferentes de fato. Confira antes de mesclar — a ação apaga os
            cadastros não escolhidos e move as cobranças/negociações deles para o principal, e não pode
            ser desfeita.
          </p>

          {duplicates.length === 0 ? (
            <p className="rounded-md bg-raised px-3 py-4 text-center text-sm text-muted">
              Nenhum nome repetido pendente.
            </p>
          ) : (
            <div className="space-y-4">
              {duplicates.map((g) => (
                <div key={g.key} className="rounded-md border border-border p-3">
                  <p className="mb-2 text-sm font-medium text-fg">{g.clients[0].name}</p>
                  <div className="space-y-1.5">
                    {g.clients.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-raised"
                      >
                        <input
                          type="radio"
                          name={`primary-${g.key}`}
                          checked={(primaryChoice[g.key] ?? g.clients[0].id) === c.id}
                          onChange={() => setPrimaryChoice((prev) => ({ ...prev, [g.key]: c.id }))}
                        />
                        <span className="font-mono text-faint">{c.document}</span>
                        <span className="text-muted">{c.phone || "sem telefone"}</span>
                        <span className="ml-auto font-mono text-fg">
                          {c.chargeCount} {c.chargeCount === 1 ? "cobrança" : "cobranças"}
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!confirmedSame[g.key]}
                      onChange={(e) => setConfirmedSame((prev) => ({ ...prev, [g.key]: e.target.checked }))}
                    />
                    Confirmo que é a mesma pessoa (conferi telefone/código) — não são clientes diferentes
                    com nome parecido.
                  </label>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={merging === g.key || !confirmedSame[g.key]}
                      onClick={() => handleMerge(g)}
                    >
                      {merging === g.key ? "Mesclando..." : "Mesclar neste"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={runDuplicateCheck} disabled={checkingDuplicates}>
              {checkingDuplicates ? "Verificando..." : "Verificar novamente"}
            </Button>
            <Button variant="secondary" onClick={() => setDupOpen(false)}>Fechar</Button>
          </div>
        </div>
      </Dialog>

      {/* Confirmar exclusão */}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Excluir cliente">
        <p className="text-sm text-muted">
          Excluir <span className="font-medium text-fg">{deleting?.name}</span> também remove todas
          as cobranças e solicitações de crédito vinculadas. Essa ação não pode ser desfeita.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete}>Excluir cliente</Button>
        </div>
      </Dialog>
    </div>
  );
}
