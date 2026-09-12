-- ============================================================
-- MIGRAÇÃO 01 — Cobranças (pós-venda) + Módulo de Negociação
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Seguro para rodar em banco já existente (não apaga nada).
-- ============================================================

-- ---------- 1. CHARGES: contexto da venda ----------
alter table public.charges
  add column if not exists sale_date date,
  add column if not exists installments int not null default 1
    check (installments >= 1);

comment on column public.charges.sale_date is 'Data em que a venda foi realizada';
comment on column public.charges.installments is 'Em quantas parcelas a venda foi negociada';

-- ---------- 2. NEGOTIATIONS: acompanhamento da cobrança ----------
create table if not exists public.negotiations (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  status         text not null default 'em_negociacao'
                 check (status in (
                   'em_negociacao',
                   'aguardando_retorno',
                   'aceitou',
                   'recusou',
                   'nao_localizado'
                 )),
  responsible    text,                    -- funcionário responsável pela cobrança
  first_contact  date,                    -- data do primeiro contato
  last_contact   date,                    -- data do último contato
  notes          text,                    -- o que foi negociado
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_negotiations_owner  on public.negotiations(owner_id);
create index if not exists idx_negotiations_status on public.negotiations(owner_id, status);
create index if not exists idx_negotiations_client on public.negotiations(owner_id, client_id);

-- Mantém updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists negotiations_touch on public.negotiations;
create trigger negotiations_touch
  before update on public.negotiations
  for each row execute function public.touch_updated_at();

-- ---------- 3. RLS ----------
alter table public.negotiations enable row level security;

drop policy if exists "negotiations_select_own" on public.negotiations;
create policy "negotiations_select_own" on public.negotiations
  for select using (auth.uid() = owner_id);

drop policy if exists "negotiations_insert_own" on public.negotiations;
create policy "negotiations_insert_own" on public.negotiations
  for insert with check (auth.uid() = owner_id);

drop policy if exists "negotiations_update_own" on public.negotiations;
create policy "negotiations_update_own" on public.negotiations
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "negotiations_delete_own" on public.negotiations;
create policy "negotiations_delete_own" on public.negotiations
  for delete using (auth.uid() = owner_id);

-- ---------- 4. Módulo de crédito descontinuado ----------
-- A tabela credit_requests deixa de ser usada pelo app.
-- Se quiser removê-la de vez (não tem volta), descomente a linha:
-- drop table if exists public.credit_requests cascade;
