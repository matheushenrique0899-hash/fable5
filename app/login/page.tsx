"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("Preencha e-mail e senha.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("A senha precisa ter no mínimo 8 caracteres.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "E-mail ou senha incorretos."
            : error.message
        );
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { company: company.trim() } },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
        return;
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setNotice("Conta criada. Confirme seu e-mail para entrar.");
        setMode("login");
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-tight">
            Cifra <span className="font-mono text-accent">Cobranças</span>
          </p>
          <p className="mt-2 text-sm text-muted">
            Gestão de recebíveis e cobrança pós-venda para sua empresa.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-card">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-1">
            {(["login", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setNotice(null); }}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === m ? "bg-raised text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {m === "login" ? "Entrar" : "Criar conta"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {mode === "signup" && (
              <div>
                <Label htmlFor="company">Nome da empresa</Label>
                <Input
                  id="company"
                  placeholder="Ex.: CréditoBI Ltda"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="voce@empresa.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            {error && (
              <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
                {notice}
              </p>
            )}

            <Button className="w-full" size="lg" onClick={handleSubmit} disabled={loading}>
              {loading
                ? "Aguarde..."
                : mode === "login"
                ? "Entrar na plataforma"
                : "Criar minha conta"}
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-faint">
          Seus dados são isolados por conta com Row Level Security.
        </p>
      </div>
    </div>
  );
}
