# ENFapp

App para técnicos em enfermagem: documentos, assinatura e carimbo, plantões, homecares, relatórios,
produtividade (edição de PDF), financeiro e mercado. Multiusuário com 3 planos (Supabase + Netlify).

## Estrutura
- `public/index.html`: o app inteiro (um único arquivo).
- `netlify.toml`: publica a pasta `public`.
- `supabase/schema.sql`: tabelas, regras de segurança, planos e limites.
- `supabase/functions/lembretes`: Edge Function de lembretes.

## Segurança
O app usa somente a URL do projeto e a chave **anon** (pública). Nunca coloque a `service_role` nem a
`sb_secret_...` neste repositório.

## Supabase: Authentication > URL Configuration
- Site URL: `https://enfapp.netlify.app`
- Redirect URLs: `https://enfapp.netlify.app`

## Checkout Mercado Pago
- O Checkout Pro cobra uma compra por período: mensal (30 dias) ou anual (365 dias). A renovação é feita por uma nova compra; não há recorrência automática.
- O navegador solicita o checkout à Edge Function `mercadopago-checkout`. O valor vem de `plan_limits`; a aprovação só é aplicada depois que `mercadopago-webhook` valida a assinatura e consulta o pagamento na API do Mercado Pago.
- Rode `supabase/schema.sql` no SQL Editor do projeto para criar a tabela de pedidos e as funções seguras de liberação. Isso é necessário também para projetos já existentes.
- Configure `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `ENFAPP_PUBLIC_URL` como secrets das Edge Functions. As funções também reconhecem os nomes antigos `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` para compatibilidade com projetos que já os usam. `ENFAPP_PUBLIC_URL` deve ser a URL HTTPS pública e estável do app para que o checkout retorne ao mesmo endereço. Para desenvolvimento local, copie `supabase/functions/.env.example` para `supabase/functions/.env` e use credenciais de teste do Mercado Pago; `MP_ENVIRONMENT=sandbox` seleciona o checkout de teste. Não versione o arquivo `.env` nem use token de produção em testes.
- Para rodar localmente, entre na pasta `enfapp/`, configure `supabase/functions/.env` e execute `supabase functions serve --env-file supabase/functions/.env`.
- Para configurar os secrets no projeto Supabase hospedado, use o Dashboard ou `supabase secrets set --env-file supabase/functions/.env` a partir de `enfapp/`.
- Configure o segredo de assinatura de Webhooks no painel do Mercado Pago. A URL de notificação é incluída em cada preferência como `https://<project-ref>.supabase.co/functions/v1/mercadopago-webhook`.
- Publique as funções `mercadopago-checkout`, `mercadopago-status` e `mercadopago-webhook` no Supabase. A configuração em `supabase/config.toml` desativa a verificação JWT do gateway somente para o webhook; a função valida a assinatura HMAC do Mercado Pago.
- Defina `ENFAPP_PUBLIC_URL` com a URL HTTPS do app publicado. As URLs de retorno do Checkout Pro não devem usar `localhost`.
