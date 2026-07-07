import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cifra Cobranças — Gestão de recebíveis",
  description:
    "CRM, cobrança pós-venda e acompanhamento de negociações em uma plataforma multi-tenant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
