# ENFapp 1.0 — pacote para substituição integral

Este pacote contém os arquivos do projeto na raiz do ZIP. Ao extrair, use a pasta do projeto como destino; não coloque a pasta inteira dentro de outra pasta `ENFapp-1.0`.

## Antes de substituir

1. Exporte ou faça uma cópia de segurança do projeto atual.
2. A extração substitui arquivos com o mesmo nome. Preserve separadamente arquivos e configurações próprios que não estejam neste pacote.
3. Não há credenciais reais incluídas. Reconfigure as chaves no painel de segredos do serviço correspondente.

## Estrutura

- A raiz contém o app web usado pelo projeto (incluindo `index.html`, `package.json`, `src/` e `public/`).
- `enfapp/` contém a cópia publicada como site estático e os arquivos do Supabase, incluindo esquema SQL e Edge Functions do checkout/webhook.
- `.env.example` contém somente valores de exemplo; não o preencha com segredos antes de enviar ou compartilhar o pacote.

## Google AI Studio

A documentação oficial descreve a importação de projetos existentes pelo fluxo **Build > Add files (+) > Import from GitHub**. Não documenta importar um ZIP como substituição integral de um projeto. Este arquivo pode ser descompactado para substituir uma cópia local do código; para levar essa versão ao AI Studio, use o fluxo de GitHub após revisar e enviar o código ao repositório desejado.

## Pagamentos

O checkout depende das Edge Functions e do esquema em `enfapp/supabase/`. A inclusão desses arquivos não aplica o esquema nem publica funções: isso requer configuração separada no Supabase e no Mercado Pago. As compras mensal e anual são avulsas (30 e 365 dias), sem renovação automática.
