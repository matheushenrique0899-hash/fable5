-- ============================================================
-- MIGRAÇÃO 10 — URGENTE: corrige exposição de dados de usuários
-- Rode AGORA no SQL Editor do Supabase (alerta de segurança do
-- próprio Supabase: "auth_users_exposed").
--
-- O problema: a view public.admin_users_view lê da tabela
-- auth.users (e-mail, login, banimento de TODAS as contas) e
-- estava liberada para o papel "authenticated" — ou seja,
-- qualquer conta logada no sistema (não só a sua) conseguia
-- consultar essa view direto pela API do Supabase e ver os
-- dados de todo mundo.
--
-- A correção: tira o acesso direto à view e cria uma função seca
-- (admin_list_users) que só devolve os dados se quem está
-- chamando for você (usa a mesma checagem is_admin() que já
-- protege aprovar/banir/excluir conta).
-- ============================================================

-- 1) Tira o acesso direto à view — ninguém mais consulta ela pela API
revoke all on public.admin_users_view from authenticated, anon, public;

-- 2) Função protegida: só retorna dados se for a conta admin
create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  full_name text,
  company text,
  approved boolean,
  phone text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;

  return query
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
end;
$$;

grant execute on function public.admin_list_users() to authenticated;
