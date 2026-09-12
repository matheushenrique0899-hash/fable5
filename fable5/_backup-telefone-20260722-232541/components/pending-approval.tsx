"use client";

import { Clock, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function PendingApproval({ email }: { email: string }) {
  const router = useRouter();

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up text-center">
        <div className="mb-6 flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-warn/25 bg-warn-soft text-warn">
            <Clock size={26} />
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Conta aguardando aprovação</h1>
        <p className="mt-3 text-sm text-muted">
          Seu cadastro foi confirmado com sucesso. Agora ele está em análise e será
          liberado em breve. Você receberá acesso assim que a conta for aprovada.
        </p>
        <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm shadow-card">
          <p className="text-faint">Conta cadastrada</p>
          <p className="mt-0.5 font-mono text-fg">{email}</p>
        </div>
        <p className="mt-4 text-xs text-faint">
          Se precisar agilizar, entre em contato com o administrador.
        </p>
        <Button variant="secondary" className="mt-6" onClick={handleLogout}>
          <LogOut size={15} /> Sair
        </Button>
      </div>
    </div>
  );
}
