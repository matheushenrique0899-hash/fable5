"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Ban, CheckCircle2, Users, Phone, Trash2, UserCheck, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

const ADMIN_EMAIL = "matheushenrique.0899@gmail.com";

interface TenantRow {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  approved: boolean | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TenantRow | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.email !== ADMIN_EMAIL) {
        router.replace("/dashboard");
        return;
      }
      setAllowed(true);
      await loadTenants();
      setLoading(false);
    }
    init();
  }, []);

  async function loadTenants() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("admin_users_view")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError("Sem permissão para carregar usuários. Rode o SQL da view no Supabase.");
      setTenants([]);
      return;
    }
    setTenants((data ?? []) as TenantRow[]);
  }

  async function toggleBan(tenant: TenantRow) {
    setActing(tenant.id);
    setError(null);
    try {
      const supabase = createClient();
      const isBanned = !!tenant.banned_until && new Date(tenant.banned_until) > new Date();

      if (isBanned) {
        const { error } = await supabase.rpc("admin_unban_user", { target_id: tenant.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("admin_ban_user", { target_id: tenant.id });
        if (error) throw error;
      }
      await loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alterar status.");
    } finally {
      setActing(null);
    }
  }

  async function toggleApproval(tenant: TenantRow) {
    setActing(tenant.id);
    setError(null);
    try {
      const supabase = createClient();
      const fn = tenant.approved ? "admin_revoke_user" : "admin_approve_user";
      const { error } = await supabase.rpc(fn, { target_id: tenant.id });
      if (error) throw error;
      await loadTenants();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alterar aprovação.");
    } finally {
      setActing(null);
    }
  }

  function openDelete(tenant: TenantRow) {
    setDeleting(tenant);
    setConfirmEmail("");
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    if (confirmEmail.trim().toLowerCase() !== deleting.email.toLowerCase()) {
      setDeleteError("O e-mail digitado não confere.");
      return;
    }
    setDeleteLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_delete_user", { target_id: deleting.id });
      if (error) throw error;
      setDeleting(null);
      await loadTenants();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Erro ao excluir conta.");
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 p-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (!allowed) return null;

  const active = tenants.filter((t) => !t.banned_until || new Date(t.banned_until) <= new Date()).length;
  const banned = tenants.length - active;
  const pending = tenants.filter((t) => !t.approved).length;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <ShieldAlert size={20} className="text-warn" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Painel de administração</h1>
          <p className="mt-0.5 text-sm text-muted">
            {tenants.length} conta{tenants.length !== 1 ? "s" : ""} cadastrada{tenants.length !== 1 ? "s" : ""} —{" "}
            {active} ativa{active !== 1 ? "s" : ""}{banned > 0 ? `, ${banned} desativada${banned !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {pending > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <Clock size={15} />
          {pending} {pending === 1 ? "conta aguardando aprovação" : "contas aguardando aprovação"}.
        </div>
      )}

      <Card>
        {tenants.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Users size={24} className="text-muted" />
            <p className="text-sm text-muted">Nenhuma conta cadastrada ainda.</p>
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empresa / Usuário</TH>
                <TH className="hidden md:table-cell">E-mail</TH>
                <TH className="hidden lg:table-cell">Telefone</TH>
                <TH className="hidden lg:table-cell">Cadastro</TH>
                <TH className="hidden md:table-cell">Último acesso</TH>
                <TH>Aprovação</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </TR>
            </THead>
            <TBody>
              {tenants.map((t) => {
                const isBanned = !!t.banned_until && new Date(t.banned_until) > new Date();
                const isMe = t.email === ADMIN_EMAIL;
                return (
                  <TR key={t.id} className={isBanned ? "opacity-50" : ""}>
                    <TD>
                      <span className="font-medium">{t.company || t.full_name || "—"}</span>
                      {t.company && t.full_name && (
                        <span className="block text-xs text-muted">{t.full_name}</span>
                      )}
                      {isMe && (
                        <span className="mt-0.5 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                          você
                        </span>
                      )}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">{t.email}</TD>
                    <TD className="hidden lg:table-cell">
                      {t.phone ? (
                        <span className="flex items-center gap-1 font-mono text-sm text-muted">
                          <Phone size={12} /> {t.phone}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TD>
                    <TD className="hidden text-muted lg:table-cell">
                      {formatDate(t.created_at)}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">
                      {t.last_sign_in_at ? formatDate(t.last_sign_in_at) : "Nunca"}
                    </TD>
                    <TD>
                      {t.approved ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          Aprovada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/25 bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
                          <Clock size={11} />
                          Aguardando
                        </span>
                      )}
                    </TD>
                    <TD>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          isBanned
                            ? "border-danger/25 bg-danger-soft text-danger"
                            : "border-accent/25 bg-accent-soft text-accent"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {isBanned ? "Desativada" : "Ativa"}
                      </span>
                    </TD>
                    <TD>
                      {!isMe && (
                        <div className="flex justify-end gap-1.5">
                          {!t.approved ? (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={acting === t.id}
                              onClick={() => toggleApproval(t)}
                            >
                              {acting === t.id ? "..." : <><UserCheck size={13} /> Aprovar</>}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={acting === t.id}
                              onClick={() => toggleApproval(t)}
                              title="Revogar aprovação"
                            >
                              Revogar
                            </Button>
                          )}
                          <Button
                            variant={isBanned ? "success" : "secondary"}
                            size="sm"
                            disabled={acting === t.id}
                            onClick={() => toggleBan(t)}
                          >
                            {acting === t.id ? (
                              "Aguarde..."
                            ) : isBanned ? (
                              <><CheckCircle2 size={13} /> Reativar</>
                            ) : (
                              <><Ban size={13} /> Desativar</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Excluir conta"
                            title="Excluir conta permanentemente"
                            className="hover:bg-danger-soft hover:text-danger"
                            onClick={() => openDelete(t)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Confirmação de exclusão */}
      <Dialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir conta permanentemente"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <p className="font-medium">Esta ação é irreversível.</p>
            <p className="mt-1">
              Excluir <span className="font-semibold">{deleting?.company || deleting?.full_name || deleting?.email}</span>{" "}
              apaga a conta e <span className="font-semibold">todos os dados</span>: clientes,
              cobranças, negociações e importações. Não há como recuperar.
            </p>
          </div>
          <div>
            <Label htmlFor="confirm-email">
              Para confirmar, digite o e-mail da conta:
            </Label>
            <Input
              id="confirm-email"
              className="font-mono"
              placeholder={deleting?.email}
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
            />
          </div>
          {deleteError && (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {deleteError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              variant="danger"
              disabled={deleteLoading || confirmEmail.trim().toLowerCase() !== (deleting?.email.toLowerCase() ?? "")}
              onClick={confirmDelete}
            >
              {deleteLoading ? "Excluindo..." : "Excluir permanentemente"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
