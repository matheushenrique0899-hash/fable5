-- ============================================================
-- MIGRAÇÃO 11 — E-mail para o admin quando alguém se cadastra
-- Rode no SQL Editor do Supabase.
--
-- O QUE FAZ: toda vez que um novo cadastro entra em public.profiles
-- (aguardando aprovação), o próprio banco de dados dispara um e-mail
-- para matheushenrique.0899@gmail.com avisando o nome/empresa/e-mail
-- do cadastro novo, para você entrar no painel Admin e aprovar.
--
-- ANTES DE RODAR ESTE ARQUIVO, faça 2 coisas (fora do SQL):
--
-- 1) Crie uma conta grátis em https://resend.com (não pede cartão).
--    Copie a "API Key" (começa com "re_...").
--    O remetente de teste "onboarding@resend.dev" já funciona sem
--    precisar cadastrar domínio — serve para este aviso interno.
--
-- 2) No SQL Editor do Supabase, rode ISSO PRIMEIRO (com sua chave):
--
--    select vault.create_secret('re_SUA_CHAVE_AQUI', 'resend_api_key');
--
--    (Isso guarda a chave de forma segura no Vault do Supabase — ela
--    não fica visível depois, nem aparece em nenhum lugar do código.)
--
-- Feito isso, rode o restante deste arquivo.
-- ============================================================

-- Necessário para o Postgres conseguir chamar uma API HTTP externa
create extension if not exists pg_net with schema extensions;

-- Função que monta e dispara o e-mail via Resend
create or replace function public.notify_admin_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  api_key text;
  user_email text;
begin
  -- só notifica cadastros novos que nascem aguardando aprovação
  if new.approved is true then
    return new;
  end if;

  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  if api_key is null then
    -- chave ainda não configurada: não trava o cadastro do usuário,
    -- só deixa de enviar o e-mail
    return new;
  end if;

  select email into user_email from auth.users where id = new.id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'Cifra Cobranças <onboarding@resend.dev>',
      'to', jsonb_build_array('matheushenrique.0899@gmail.com'),
      'subject', 'Novo cadastro aguardando aprovação — ' || coalesce(new.full_name, user_email),
      'html',
        '<p>Um novo cadastro foi feito no Cifra Cobranças e está aguardando aprovação.</p>' ||
        '<p><b>Nome:</b> ' || coalesce(new.full_name, '—') || '<br>' ||
        '<b>Empresa:</b> ' || coalesce(new.company, '—') || '<br>' ||
        '<b>E-mail:</b> ' || coalesce(user_email, '—') || '</p>' ||
        '<p>Entre no painel Admin do sistema para aprovar ou recusar.</p>'
    )
  );

  return new;
end;
$$;

drop trigger if exists on_profile_created_notify_admin on public.profiles;
create trigger on_profile_created_notify_admin
  after insert on public.profiles
  for each row execute function public.notify_admin_new_signup();

-- ============================================================
-- Teste rápido (opcional): dispara um e-mail de teste na hora,
-- sem precisar criar uma conta de verdade. Rode só esta linha:
--
--   select net.http_post(
--     url := 'https://api.resend.com/emails',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := jsonb_build_object(
--       'from', 'Cifra Cobranças <onboarding@resend.dev>',
--       'to', jsonb_build_array('matheushenrique.0899@gmail.com'),
--       'subject', 'Teste de notificação',
--       'html', '<p>Se você recebeu isso, está tudo funcionando.</p>'
--     )
--   );
-- ============================================================
