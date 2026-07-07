-- ============================================================
-- FABLE 5 — Schema completo (Supabase / PostgreSQL)
-- Multi-tenant por owner_id (auth.uid()) com RLS em produção.
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- ============================================================

-- ---------- 1. PROFILES ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  company     text,
  created_at  timestamptz not null default now()
);

-- Cria o profile automaticamente no signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, company)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. CLIENTS (CRM) ----------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  document    text not null,                -- CPF ou CNPJ (somente dígitos)
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  constraint document_digits check (document ~ '^[0-9]{11}$|^[0-9]{14}$')
);

create index if not exists idx_clients_owner on public.clients(owner_id);
create index if not exists idx_clients_name  on public.clients(owner_id, name);
-- Evita cadastrar o mesmo CPF/CNPJ duas vezes dentro da mesma conta
create unique index if not exists uq_clients_owner_document
  on public.clients(owner_id, document);

-- ---------- 3. CHARGES (Cobranças / Recebíveis) ----------
create table if not exists public.charges (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  amount       numeric(14,2) not null check (amount > 0),
  due_date     date not null,
  status       text not null default 'pendente'
               check (status in ('pendente','pago','atrasado')),
  description  text,
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_charges_owner  on public.charges(owner_id);
create index if not exists idx_charges_status on public.charges(owner_id, status);
create index if not exists idx_charges_due    on public.charges(owner_id, due_date);

-- Atualiza automaticamente pendente -> atrasado (chamada pelo app a cada load
-- e/ou por um cron: Database > Extensions > pg_cron)
create or replace function public.refresh_overdue_charges()
returns void language sql security definer set search_path = public as $$
  update public.charges
     set status = 'atrasado'
   where status = 'pendente'
     and due_date < current_date;
$$;

-- ---------- 4. CREDIT REQUESTS (Solicitações de crédito) ----------
create table if not exists public.credit_requests (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  monthly_income  numeric(14,2) not null check (monthly_income >= 0),
  reason          text not null,
  status          text not null default 'em_analise'
                  check (status in ('em_analise','aprovado','reprovado')),
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_credit_owner  on public.credit_requests(owner_id);
create index if not exists idx_credit_status on public.credit_requests(owner_id, status);

-- ============================================================
-- 5. ROW LEVEL SECURITY — multi-tenant real
-- Regra única: cada linha pertence a auth.uid(). Sem exceções.
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.clients         enable row level security;
alter table public.charges         enable row level security;
alter table public.credit_requests enable row level security;

-- PROFILES: usuário lê/edita apenas o próprio perfil
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- CLIENTS
drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own" on public.clients
  for select using (auth.uid() = owner_id);

drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients
  for insert with check (auth.uid() = owner_id);

drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own" on public.clients
  for delete using (auth.uid() = owner_id);

-- CHARGES
drop policy if exists "charges_select_own" on public.charges;
create policy "charges_select_own" on public.charges
  for select using (auth.uid() = owner_id);

drop policy if exists "charges_insert_own" on public.charges;
create policy "charges_insert_own" on public.charges
  for insert with check (auth.uid() = owner_id);

drop policy if exists "charges_update_own" on public.charges;
create policy "charges_update_own" on public.charges
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "charges_delete_own" on public.charges;
create policy "charges_delete_own" on public.charges
  for delete using (auth.uid() = owner_id);

-- CREDIT REQUESTS
drop policy if exists "credit_select_own" on public.credit_requests;
create policy "credit_select_own" on public.credit_requests
  for select using (auth.uid() = owner_id);

drop policy if exists "credit_insert_own" on public.credit_requests;
create policy "credit_insert_own" on public.credit_requests
  for insert with check (auth.uid() = owner_id);

drop policy if exists "credit_update_own" on public.credit_requests;
create policy "credit_update_own" on public.credit_requests
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "credit_delete_own" on public.credit_requests;
create policy "credit_delete_own" on public.credit_requests
  for delete using (auth.uid() = owner_id);
