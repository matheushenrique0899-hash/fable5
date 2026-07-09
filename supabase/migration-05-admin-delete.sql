-- ============================================================
-- ADMIN — Função para EXCLUIR usuário e todos os dados
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- Exclui o usuário de auth.users. Como todas as tabelas têm
-- "on delete cascade" no owner_id, os dados (clientes, cobranças,
-- negociações, lotes, etc.) são apagados automaticamente.
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.';
  end if;
  if target_id = auth.uid() then
    raise exception 'Você não pode excluir sua própria conta.';
  end if;

  -- Remove o usuário; o cascade apaga todos os dados vinculados
  delete from auth.users where id = target_id;
end;
$$;
