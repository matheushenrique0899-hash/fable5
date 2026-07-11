-- ============================================================
-- MIGRAÇÃO 09 — Documento vira "Código" livre (sem exigir CPF/CNPJ)
-- Rode no SQL Editor do Supabase.
-- A maioria dos clientes não tem CPF real cadastrado no sistema de
-- origem, só um código interno do ERP. O campo "document" continua
-- existindo (e continua único por conta), só deixa de exigir o
-- formato de CPF (11 dígitos) ou CNPJ (14 dígitos).
-- ============================================================

alter table public.clients drop constraint if exists document_digits;

comment on column public.clients.document is
  'Código interno do cliente (ERP) — não precisa ser CPF/CNPJ, mas precisa ser único por conta.';
