-- ============================================================
-- MIGRAÇÃO 06 — Aprovação manual de contas
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- Coluna de aprovação no profile.
-- NULL/false = aguardando; true = liberado para usar o sistema.
alter table public.profiles
  add column if not exists approved boolean not null default false;

-- O admin já vem aprovado automaticamente (sua conta)
update public.profiles
   set approved = true
 where id in (
   select id from auth.users where email = 'matheushenrique.0899@gmail.com'
 );

-- Atualiza o trigger de novo usuário: o admin nasce aprovado, os demais não
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, company, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company', ''),
    new.email = 'matheushenrique.0899@gmail.com'  -- admin já aprovado
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Função para o próprio usuário checar se está aprovado (usada no app)
create or replace function public.is_approved()
returns boolean
language sql security definer set search_path = public
as $$
  select coalesce(approved, false) from public.profiles where id = auth.uid();
$$;

-- Funções de admin para aprovar / revogar
create or replace function public.admin_approve_user(target_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;
  update public.profiles set approved = true where id = target_id;
end;
$$;

create or replace function public.admin_revoke_user(target_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;
  if target_id = auth.uid() then
    raise exception 'Você não pode revogar sua própria conta.';
  end if;
  update public.profiles set approved = false where id = target_id;
end;
$$;

-- Recria a view do admin incluindo o status de aprovação
create or replace view public.admin_users_view
with (security_invoker = false)
as
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  u.banned_until,
  p.full_name,
  p.company,
  p.approved,
  (u.raw_user_meta_data->>'phone') as phone
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;

grant select on public.admin_users_view to authenticated;
