# Cifra Cobranças (FABLE 5)

Plataforma SaaS multi-tenant de cobrança pós-venda: CRM de clientes (com importação CSV), gestão de recebíveis (venda, parcelas, vencimento, atraso) e acompanhamento de negociações com KPIs gerenciais (distribuição por status e faixas de atraso).

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Auth + PostgreSQL + RLS) · Vercel

---

## Arquitetura

```
fable5/
├── app/
│   ├── login/page.tsx            # Autenticação (login + criar conta)
│   ├── (app)/                    # Área autenticada (protegida por middleware)
│   │   ├── layout.tsx            # Shell com sidebar + verificação de sessão
│   │   ├── dashboard/page.tsx    # Métricas, gráfico, cobranças recentes
│   │   ├── clientes/page.tsx     # CRM: CRUD, busca, paginação
│   │   ├── cobrancas/page.tsx    # Recebíveis: filtros, marcar pago, atraso
│   │   └── negociacao/page.tsx   # Negociações: status, responsável, KPIs, aging
│   ├── layout.tsx / globals.css
│   └── page.tsx                  # Redirect raiz
├── components/
│   ├── ui/                       # Design system (button, card, table, dialog...)
│   ├── sidebar.tsx / stat-card.tsx / bar-chart.tsx
├── lib/
│   ├── supabase/                 # Clients (browser + server SSR)
│   ├── services/                 # Regras de negócio (clients, charges, credit, dashboard)
│   ├── types.ts / utils.ts
├── supabase/schema.sql           # Banco completo: tabelas + índices + triggers + RLS
└── middleware.ts                 # Proteção de rotas + refresh de sessão
```

**Separação de responsabilidades:** as páginas (UI) nunca falam SQL — toda leitura/escrita passa por `lib/services/*`, que usa os clients de `lib/supabase/*`. A segurança multi-tenant não depende do frontend: as políticas de RLS no banco garantem que `auth.uid()` só acessa as próprias linhas, mesmo que alguém chame a API do Supabase diretamente.

---

## Setup (15 minutos)

### 1. Banco de dados
1. Crie um projeto em [supabase.com](https://supabase.com) (região **São Paulo**).
2. Abra **SQL Editor** → cole o conteúdo de `supabase/schema.sql` → **Run**.
3. Em **Authentication → Providers → Email**: para testar rápido, desative "Confirm email" (reative em produção).

### 2. Variáveis de ambiente
```bash
cp .env.example .env.local
```
Preencha com os valores de **Project Settings → API**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Rodar local
```bash
npm install
npm run dev
```
Acesse `http://localhost:3000`, crie uma conta e comece a usar.

### 4. Deploy na Vercel
1. Suba o projeto para um repositório no GitHub:
   ```bash
   git init && git add . && git commit -m "FABLE 5 v1"
   git remote add origin https://github.com/SEU-USUARIO/fable5.git
   git push -u origin main
   ```
2. Em [vercel.com](https://vercel.com): **Add New → Project → Import** do repositório.
3. Adicione as duas variáveis de ambiente (mesmas do `.env.local`).
4. **Deploy.** A partir daí, todo `git push` gera deploy automático (CI/CD).
5. Em produção: no Supabase, **Authentication → URL Configuration**, adicione a URL da Vercel em *Site URL* e *Redirect URLs*.

---

## Segurança implementada

- **RLS em todas as tabelas** — políticas explícitas de `select/insert/update/delete` por `owner_id = auth.uid()`.
- **Constraint de CPF/CNPJ** no banco (11 ou 14 dígitos) + unicidade por conta.
- **Middleware** protege todas as rotas autenticadas e mantém a sessão renovada.
- **Trigger** cria o `profile` automaticamente no signup.
- Nenhuma `service_role key` no frontend — apenas a `anon key`, que sem RLS não acessa nada.

## Status "atrasado" automático

A função `refresh_overdue_charges()` migra `pendente → atrasado` quando `due_date < hoje`. Ela é chamada em todo carregamento do dashboard e da tela de cobranças. Para atualização mesmo sem ninguém logado, ative a extensão **pg_cron** no Supabase e agende:

```sql
select cron.schedule('overdue-daily', '5 3 * * *', $$select public.refresh_overdue_charges()$$);
```

---

## Roadmap para escalar como SaaS

**Curto prazo (retenção e operação):**
- **Alertas de cobrança via WhatsApp** — botão "Cobrar no WhatsApp" em cada cobrança atrasada, com `wa.me/<fone>?text=<mensagem pré-preenchida>` usando o telefone do cliente (mesmo padrão que você já usa no CréditoBI, custo zero de infraestrutura).
- **Notificações in-app** — tabela `notifications` + Supabase Realtime para avisar "cobrança venceu hoje" e "nova solicitação de crédito".
- **Link de pagamento** — integrar Pix via Mercado Pago/Asaas: gerar QR Code por cobrança e marcar como pago via webhook (elimina o "marcar pago" manual, que é o maior ponto de fricção).

**Médio prazo (monetização):**
- **Times/organizações** — hoje o tenant é o usuário. Para vender para empresas com vários operadores, adicione tabelas `organizations` e `memberships` e troque as políticas RLS de `owner_id = auth.uid()` para `org_id in (select org_id from memberships where user_id = auth.uid())`. A arquitetura atual foi desenhada para essa migração ser só no banco + services.
- **Billing** — Stripe Checkout com planos por volume de cobranças/clientes; gate por `subscription_status` no middleware.
- **Portal do cliente final** — link público onde o cliente do seu usuário vê as próprias cobranças e solicita crédito sozinho (aí o campo `credit_requests` passa a ser preenchido pela ponta, não pelo operador).

**Fundação técnica:**
- Testes de RLS com contas distintas antes de qualquer venda (crie 2 usuários e confirme o isolamento).
- `audit_log` (trigger de insert/update) para rastreabilidade de decisões de crédito — importante juridicamente no Brasil.
- Exportação CSV das cobranças (contadores vão pedir isso no primeiro dia).
