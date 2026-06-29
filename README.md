# Delivery Dashboard

## Arquitetura de Importacao IA

Fluxo atual:

1. React autenticado com Firebase Auth
2. Cloudflare Worker seguro (`worker/`)
3. OpenAI Responses API
4. React recebe JSON estruturado
5. Firestore grava importacao e rascunho para validacao manual

Regras de seguranca:

1. A `OPENAI_API_KEY` existe apenas no Cloudflare Worker como secret
2. Nao colocar chave OpenAI em React, Vite, browser, GitHub ou ficheiros versionados
3. O endpoint exige `Authorization: Bearer <Firebase ID token>`
4. Apenas utilizadores admin (allowlist `ADMIN_UIDS`) podem analisar prints

## Frontend (React)

Variaveis em `.env.local`:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_AI_IMPORT_MODE=worker
VITE_AI_WORKER_URL=https://<worker-subdomain>.workers.dev
VITE_INTERNAL_ADMIN_EMAILS=teu-email@dominio.com
```

Nota: o frontend recebe apenas a URL publica do Worker. Nunca recebe a OpenAI key.

## Login Interno com Firebase Auth (Google)

Estado desta fase:

1. Apenas a rota de importacao IA esta obrigatoriamente protegida por login e allowlist.
2. As outras rotas continuam abertas para nao alterar o funcionamento normal da app nesta etapa.

### Ativar Google Sign-In no Firebase

1. Firebase Console -> Authentication -> Sign-in method.
2. Ativar provider Google.
3. Definir email de suporte do projeto.

### Authorized Domains

1. Em Authentication -> Settings -> Authorized domains.
2. Garantir que localhost e dominio de producao estao autorizados.

### Allowlist de administradores

1. Definir emails autorizados em `VITE_INTERNAL_ADMIN_EMAILS` (separados por virgula).
2. Exemplo: `VITE_INTERNAL_ADMIN_EMAILS=admin@exemplo.com,outro@exemplo.com`.
3. Se o user fizer login mas nao estiver na allowlist, aparece "Sem autorizacao" e opcao de sair.

### Como obter Firebase UID

1. Entrar com Google.
2. Abrir pagina interna `Acesso interno` (item no menu visivel so para admin).
3. Copiar UID no botao `Copiar UID`.
4. Configurar esse UID no secret `ADMIN_UIDS` do Worker.

### Teste local

1. Arrancar frontend: `npm run dev`.
2. Tentar abrir `/importar-encomendas` sem login -> redireciona para `/login`.
3. Entrar com Google:
4. Se email estiver na allowlist -> volta para a rota pedida.
5. Se nao estiver -> mostra "Sem autorizacao".

## Cloudflare Worker

Pasta: `worker/`

Endpoint implementado:

1. `POST /analyse-order-print`

Comportamento:

1. Recebe imagem otimizada em `imageDataUrl` e contexto (`catalogProducts`, `allowedUnits`, `aliases`)
2. Valida token Firebase ID criptograficamente por JWKS Google
3. Aplica allowlist de admins via `ADMIN_UIDS`
4. Aplica CORS apenas para origens permitidas (producao + localhost)
5. Aplica rate limit por utilizador
6. Chama OpenAI Responses API com JSON schema estrito
7. Devolve apenas JSON estruturado

### Instalar Wrangler

```bash
npm install
cd worker
npm install
```

### Login Cloudflare

```bash
npx wrangler login
```

### Criar secrets

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ADMIN_UIDS
```

Valor de `ADMIN_UIDS` exemplo:

```text
uid_admin_1,uid_admin_2
```

### Configurar origens permitidas

No `worker/wrangler.toml`, ajuste `ALLOWED_ORIGINS` com dominio de producao e localhost.

Exemplo:

```toml
ALLOWED_ORIGINS = "https://app.exemplo.com,http://localhost:5173"
```

### Correr localmente

```bash
cd worker
npm run dev
```

### Deploy do Worker

```bash
cd worker
npm run deploy
```

## Fluxo de importacao no UI

1. O browser reduz imagem para largura maxima de 1600 px
2. Converte para JPEG com qualidade ~0.8
3. Mantem print apenas em memoria da sessao (sem Firebase Storage)
4. Fila de processamento com concorrencia maxima de 2
5. Se houver refresh de pagina, o UI avisa que e preciso recarregar o print para validacao visual

## Persistencia no Firestore

1. Resultado IA guardado como `DRAFT_AI` ou `PENDING_VALIDATION`
2. Encomenda final nunca e criada automaticamente
3. Confirmacao final continua manual no ecrã de validacao
