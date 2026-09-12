-- ============================================================
-- MIGRAÇÃO 02 — Histórico de contatos, pagamentos parciais e acordo
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Seguro para rodar em banco já existente (não apaga nada).
-- ============================================================

-- ---------- 1. HISTÓRICO DE CONTATOS DA NEGOCIAÇÃO ----------
create table if not exists public.negotiation_contacts (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  negotiation_id  uuid not null references public.negotiations(id) on delete cascade,
  contact_date    date not null default current_date,
  note            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_neg_contacts_owner on public.negotiation_contacts(owner_id);
create index if not exists idx_neg_contacts_neg   on public.negotiation_contacts(negotiation_id, contact_date desc);

alter table public.negotiation_contacts enable row level security;

drop policy if exists "neg_contacts_select_own" on public.negotiation_contacts;
create policy "neg_contacts_select_own" on public.negotiation_contacts
  for select using (auth.uid() = owner_id);

drop policy if exists "neg_contacts_insert_own" on public.negotiation_contacts;
create policy "neg_contacts_insert_own" on public.negotiation_contacts
  for insert with check (auth.uid() = owner_id);

drop policy if exists "neg_contacts_delete_own" on public.negotiation_contacts;
create policy "neg_contacts_delete_own" on public.negotiation_contacts
  for delete using (auth.uid() = owner_id);

-- ---------- 2. PAGAMENTOS PARCIAIS ----------
create table if not exists public.charge_payments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  charge_id   uuid not null references public.charges(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  paid_date   date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists idx_payments_owner  on public.charge_payments(owner_id);
create index if not exists idx_payments_charge on public.charge_payments(charge_id);
create index if not exists idx_payments_date   on public.charge_payments(owner_id, paid_date);

alter table public.charge_payments enable row level security;

drop policy if exists "payments_select_own" on public.charge_payments;
create policy "payments_select_own" on public.charge_payments
  for select using (auth.uid() = owner_id);

drop policy if exists "payments_insert_own" on public.charge_payments;
create policy "payments_insert_own" on public.charge_payments
  for insert with check (auth.uid() = owner_id);

drop policy if exists "payments_delete_own" on public.charge_payments;
create policy "payments_delete_own" on public.charge_payments
  for delete using (auth.uid() = owner_id);

-- ---------- 3. ACORDO NA NEGOCIAÇÃO ----------
alter table public.negotiations
  add column if not exists agreed_amount numeric(14,2) check (agreed_amount is null or agreed_amount > 0),
  add column if not exists agreed_installments int check (agreed_installments is null or agreed_installments >= 1),
  add column if not exists agreed_due date;

comment on column public.negotiations.agreed_amount is 'Valor total do acordo fechado';
comment on column public.negotiations.agreed_installments is 'Em quantas parcelas o acordo foi fechado';
comment on column public.negotiations.agreed_due is 'Vencimento da primeira parcela do acordo';

-- ---------- 4. PARCELAS DO ACORDO ----------
-- Quando a negociação fecha em "aceitou" com N parcelas, o sistema
-- gera N linhas nesta tabela. Cada linha é quitada individualmente.
create table if not exists public.agreement_installments (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  negotiation_id  uuid not null references public.negotiations(id) on delete cascade,
  installment_no  int not null,          -- 1, 2, 3 ...
  amount          numeric(14,2) not null check (amount > 0),
  due_date        date not null,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_agree_inst_owner on public.agreement_installments(owner_id);
create index if not exists idx_agree_inst_neg   on public.agreement_installments(negotiation_id);

alter table public.agreement_installments enable row level security;

drop policy if exists "agree_inst_select" on public.agreement_installments;
create policy "agree_inst_select" on public.agreement_installments
  for select using (auth.uid() = owner_id);

drop policy if exists "agree_inst_insert" on public.agreement_installments;
create policy "agree_inst_insert" on public.agreement_installments
  for insert with check (auth.uid() = owner_id);

drop policy if exists "agree_inst_update" on public.agreement_installments;
create policy "agree_inst_update" on public.agreement_installments
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "agree_inst_delete" on public.agreement_installments;
create policy "agree_inst_delete" on public.agreement_installments
  for delete using (auth.uid() = owner_id);
