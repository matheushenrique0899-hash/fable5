-- ============================================================
-- MIGRAÇÃO 04 — Lotes de importação + Observação + valor zero
-- Rode este arquivo inteiro no SQL Editor do Supabase.
-- Seguro para rodar em banco já existente.
-- ============================================================

-- ---------- 1. LOTES DE IMPORTAÇÃO ----------
create table if not exists public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  file_name    text,
  row_count    int not null default 0,
  total_amount numeric(14,2) not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_import_batches_owner on public.import_batches(owner_id, created_at desc);

alter table public.import_batches enable row level security;

drop policy if exists "import_batches_select" on public.import_batches;
create policy "import_batches_select" on public.import_batches
  for select using (auth.uid() = owner_id);

drop policy if exists "import_batches_insert" on public.import_batches;
create policy "import_batches_insert" on public.import_batches
  for insert with check (auth.uid() = owner_id);

drop policy if exists "import_batches_delete" on public.import_batches;
create policy "import_batches_delete" on public.import_batches
  for delete using (auth.uid() = owner_id);

-- ---------- 2. CHARGES: vínculo com lote + observação ----------
alter table public.charges
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null,
  add column if not exists observation text;

create index if not exists idx_charges_batch on public.charges(import_batch_id);

-- ---------- 3. Aceitar valor total = 0 ----------
-- A constraint original exigia amount > 0. Agora aceita >= 0.
alter table public.charges drop constraint if exists charges_amount_check;
alter table public.charges add constraint charges_amount_check check (amount >= 0);
