import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const formatDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR");

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export const formatDocument = (doc: string) => {
  const d = onlyDigits(doc);
  if (d.length === 11)
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14)
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
};

export const daysOverdue = (dueDate: string) => {
  const due = new Date(dueDate + "T23:59:59");
  const diff = Date.now() - due.getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
};
