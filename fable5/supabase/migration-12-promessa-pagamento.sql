-- ============================================================
-- MIGRAÇÃO 12 — Promessa de pagamento na negociação
-- Rode no SQL Editor do Supabase.
--
-- Adiciona um campo PRÓPRIO para a promessa informal de pagamento
-- (data + valor que o cliente disse que vai pagar), separado do
-- acordo formal já existente (agreed_amount/agreed_due, usado só
-- quando o status vira "Aceitou"). A promessa pode existir em
-- qualquer status — é o que o cliente falou, não o que foi fechado.
-- ============================================================

alter table public.negotiations
  add column if not exists promised_payment_date date,
  add column if not exists promised_payment_amount numeric(14,2);

alter table public.negotiations
  drop constraint if exists promised_payment_amount_check;
alter table public.negotiations
  add constraint promised_payment_amount_check
  check (promised_payment_amount is null or promised_payment_amount > 0);

comment on column public.negotiations.promised_payment_date is
  'Data que o cliente prometeu pagar (informal, qualquer status) — distinta do acordo formal (agreed_due)';
comment on column public.negotiations.promised_payment_amount is
  'Valor que o cliente prometeu pagar (informal, qualquer status) — distinto do acordo formal (agreed_amount)';
