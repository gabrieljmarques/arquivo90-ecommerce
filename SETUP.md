# Arquivo 90 — Guia de Deploy

## Pré-requisitos
- Conta Netlify (netlify.com) — gratuita
- Conta Supabase (supabase.com) — gratuita
- Conta Upstash (upstash.com) — gratuita
- Conta Mercado Pago com credenciais de produção
- Node.js 20+ instalado localmente

---

## 1. Supabase — Banco de dados

1. Acesse **app.supabase.com** → New project
2. Nome: `arquivo90`, senha forte, região: **South America (São Paulo)**
3. Aguarde o projeto criar (~2 min)
4. Vá em **SQL Editor** → cole todo o conteúdo de `supabase/schema.sql` → Run
5. Vá em **Project Settings → API** e copie:
   - `Project URL` → SUPABASE_URL
   - `anon public` → SUPABASE_ANON_KEY
   - `service_role` → SUPABASE_SERVICE_KEY ⚠️ nunca expor publicamente
6. Vá em **Authentication → Users** → Add user → crie seu email/senha de admin
7. Em **Authentication → URL Configuration**, adicione:
   - Site URL: `https://arquivo90.com.br`
   - Redirect URLs: `https://arquivo90.com.br/admin`

---

## 2. Upstash Redis — Rate limiting

1. Acesse **console.upstash.com** → Create Database
2. Nome: `arquivo90`, região: **São Paulo** (ou US East se indisponível)
3. Copie:
   - `UPSTASH_REDIS_URL`
   - `UPSTASH_REDIS_TOKEN`

---

## 3. Mercado Pago — Pagamentos

1. Acesse **mercadopago.com.br** → Suas Integrações → Credenciais
2. Copie o `Access Token` de **produção** → MP_ACCESS_TOKEN
3. Em **Notificações IPN**:
   - URL: `https://arquivo90.com.br/api/payment/webhook`
   - Eventos: `payment`
   - Copie o **secret** gerado → MP_WEBHOOK_SECRET

---

## 4. Netlify — Hospedagem

### 4a. Deploy inicial
1. Acesse **netlify.com** → Add new site → Deploy manually
2. Arraste a pasta `arquivo90-ecommerce` para o campo de upload
3. O site sobe em `https://random-name.netlify.app`

### 4b. Variáveis de ambiente
Em **Site Settings → Environment Variables**, adicione todas as variáveis do `.env.example`:

```
SUPABASE_URL            = https://xxxx.supabase.co
SUPABASE_ANON_KEY       = eyJ...
SUPABASE_SERVICE_KEY    = eyJ...
MP_ACCESS_TOKEN         = APP_USR-...
MP_WEBHOOK_SECRET       = ...
UPSTASH_REDIS_URL       = https://....upstash.io
UPSTASH_REDIS_TOKEN     = ...
ADMIN_EMAIL             = seu@email.com
SITE_URL                = https://arquivo90.com.br
```

### 4c. Configurar domínio
1. **Site Settings → Domain Management → Add custom domain**
2. Digite: `arquivo90.com.br`
3. No painel do seu registrador de domínio, aponte o DNS:
   - Tipo: `CNAME`, Nome: `www`, Valor: `random-name.netlify.app`
   - Tipo: `A`, Nome: `@`, Valor: IP fornecido pelo Netlify
4. Aguarde propagação DNS (até 48h, geralmente 30min)
5. Netlify provisiona SSL automaticamente

---

## 5. Primeiro produto

1. Acesse `https://arquivo90.com.br/admin`
2. Login com o email/senha criado no Supabase
3. **Produtos → Novo produto**: preencha nome, slug, preço
4. **Estoque → Ajustar**: defina as unidades por tamanho
5. No produto, marque como **Ativo** quando estiver pronto

---

## 7. Imagens de produto

Faça upload das imagens no **Supabase → Storage**:
1. Crie um bucket público chamado `products`
2. Faça upload das imagens (frente, costas, preview off-white)
3. Copie a URL pública de cada imagem
4. Cadastre via SQL ou via admin (ao editar produto)

URLs no formato:
```
https://xxxx.supabase.co/storage/v1/object/public/products/la-cavadinha/frente.png
```

---

## Estrutura de arquivos

```
arquivo90-ecommerce/
├── netlify.toml              # Config Netlify + headers de segurança
├── package.json
├── .env.example              # Template de variáveis (nunca commitar .env real)
├── supabase/
│   └── schema.sql            # Executar no Supabase SQL Editor
├── netlify/functions/
│   ├── utils/
│   │   ├── supabase.js       # Cliente Supabase (service role)
│   │   ├── redis.js          # Cliente Upstash
│   │   ├── auth.js           # Verificação JWT admin
│   │   └── ratelimit.js      # Rate limiting por IP
│   ├── products.mjs          # GET /api/products
│   ├── product.mjs           # GET /api/products/:slug
│   ├── payment-create.mjs    # POST /api/payment/create
│   ├── payment-webhook.mjs   # POST /api/payment/webhook
│   ├── process-webhooks.mjs  # Cron: processa pagamentos (1min)
│   ├── expire-reservations.mjs # Cron: libera reservas expiradas (5min)
│   ├── admin-products.mjs    # CRUD produtos (autenticado)
│   ├── admin-stock.mjs       # Gestão de estoque (autenticado)
│   └── admin-orders.mjs      # Gestão de pedidos (autenticado)
└── public/
    ├── index.html            # Vitrine
    ├── produto/index.html    # Detalhe do produto
    ├── checkout/index.html   # Checkout
    ├── obrigado/index.html   # Confirmação de pedido
    ├── admin/index.html      # Painel admin (SPA)
    ├── css/style.css
    └── js/api.js
```

---

## Checklist pré-lançamento

- [ ] Schema executado no Supabase
- [ ] Todas env vars configuradas no Netlify
- [ ] Domínio arquivo90.com.br apontando para Netlify
- [ ] SSL ativo (Netlify provisiona automaticamente)
- [ ] Login admin funcionando
- [ ] Produto criado, ativo, com estoque
- [ ] Webhook MP configurado para https://arquivo90.com.br/api/payment/webhook
- [ ] Teste de compra com cartão de teste do MP
