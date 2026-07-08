"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, Receipt, Handshake, LogOut, Menu, X, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/cobrancas", label: "Cobranças", icon: Receipt },
  { href: "/negociacao", label: "Negociação", icon: Handshake },
];

const ADMIN_EMAIL = "matheushenrique.0899@gmail.com";

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-raised hover:text-fg"
            )}
          >
            <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-border p-3">
      <p className="truncate px-3 pb-2 font-mono text-xs text-faint" title={email}>
        {email}
      </p>
      <button
        onClick={handleLogout}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <LogOut size={16} />
        Sair
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <button
          onClick={() => setOpen(!open)}
          aria-label="Abrir menu"
          className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-fg"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-x-0 top-[49px] z-40 flex flex-col border-b border-border bg-surface md:hidden">
          {nav}
          {footer}
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface md:flex">
        <div className="border-b border-border px-6 py-5">
          <Brand />
        </div>
        {nav}
        {footer}
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-baseline gap-1.5">
      <span className="text-base font-semibold tracking-tight text-fg">Cifra</span>
      <span className="font-mono text-sm font-bold text-accent">Cobranças</span>
    </Link>
  );
}
