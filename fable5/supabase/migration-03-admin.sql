-- ============================================================
-- ADMIN PANEL — View de usuários + funções de ban/unban
-- Rode no SQL Editor do Supabase (requer service_role internamente)
-- ============================================================

-- View que expõe dados dos usuários para o admin
-- Só o admin (via RLS) consegue ver
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
  (u.raw_user_meta_data->>'phone') as phone
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc;

-- Apenas o admin consegue consultar a view
grant select on public.admin_users_view to authenticated;

create or replace function public.is_admin()
returns boolean
language sql security definer
as $$
  select email = 'matheushenrique.0899@gmail.com'
  from auth.users
  where id = auth.uid();
$$;

-- RLS na view via policy na função
alter view public.admin_users_view owner to postgres;

-- Função para banir usuário (só admin pode chamar)
create or replace function public.admin_ban_user(target_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;
  if target_id = auth.uid() then
    raise exception 'Você não pode desativar sua própria conta.';
  end if;
  update auth.users
     set banned_until = '2099-12-31 23:59:59+00'
   where id = target_id;
end;
$$;

-- Função para desbanir usuário (só admin pode chamar)
create or replace function public.admin_unban_user(target_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;
  update auth.users
     set banned_until = null
   where id = target_id;
end;
$$;

-- Atualiza o trigger de novo usuário para salvar o telefone no profile
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
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
