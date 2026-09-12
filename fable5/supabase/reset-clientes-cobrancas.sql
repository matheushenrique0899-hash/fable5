-- ============================================================
-- RESET — apaga clientes e tudo que depende deles (cobranças,
-- negociações, histórico de contato, parcelas de acordo) para
-- UMA conta específica. Rode no SQL Editor do Supabase.
--
-- Troque o e-mail abaixo pela conta que você quer resetar.
-- ATENÇÃO: irreversível. Confira o e-mail antes de rodar.
-- ============================================================

-- Apaga clientes (cascata apaga cobranças, negociações,
-- histórico de contato, parcelas de acordo e solicitações de crédito
-- vinculadas a eles automaticamente)
delete from public.clients
where owner_id = (select id from auth.users where email = 'EMAIL_DA_CONTA_AQUI');

-- Apaga os lotes de importação (não são apagados em cascata, pois não
-- dependem do cliente — ficariam órfãos se não apagar também)
delete from public.import_batches
where owner_id = (select id from auth.users where email = 'EMAIL_DA_CONTA_AQUI');
