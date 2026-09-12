-- ============================================================
-- MIGRAÇÃO 07 — Argumento de negociação
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- Argumento = motivo/situação que o devedor apresenta.
-- Vira KPI gerencial (ex: "30% dos devedores sem condições").
alter table public.negotiations
  add column if not exists argument text
    check (argument is null or argument in (
      'sem_condicoes',
      'esqueceu',
      'contesta_divida',
      'insatisfeito',
      'promessa_pagamento',
      'nao_responde'
    ));

comment on column public.negotiations.argument is 'Motivo apresentado pelo devedor para não pagar';
