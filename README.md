# PARES — Sua mente. Sem freios.

Jogo da memória em **React + Vite** com estética automobilística. Inclui uma **API Node.js** e banco **SQLite real** para cadastro, login, sessões e logout. No desenvolvimento usa um arquivo local; no Railway usa um volume persistente.

## Integração Cloudflare Pages + Railway + Supabase (versão hospedada)

**Três serviços, uma única aplicação de usuário:**

- **Cloudflare Pages** publica React/Vite e usa `functions/api/[[path]].js` como proxy de **rotas permitidas** para o Railway. O proxy não aceita destinos arbitrários, não encaminha cookies do SQLite e exige mesma origem em operações de escrita.
- **Supabase** (projeto `memory`, ref `juiegqemecodojunlbcc`) gerencia cadastro, confirmação de email, login, sessão e duas tabelas com RLS: `public.pares_profiles` e `public.pares_best_scores`.
- **Railway** verifica cada bearer token consultando Supabase Auth e salva/consulta as melhores pontuações via PostgREST **com o JWT do próprio jogador**, respeitando as regras RLS. Não precisa nem deve receber a chave `service_role` ou segredo administrativo.

O cliente Supabase usa apenas a chave **publishable**, que é pública por definição. Nunca coloque uma chave `secret`, `service_role` ou senha de banco em variáveis `VITE_*`, arquivos JS ou no Cloudflare Pages.

### Configuração Railway (serviço memory)

O Railway já fornece o frontend compilado e a API Node na mesma origem, com o SQLite antigo preservado no volume `/data`. Para ativar as novas rotas Supabase, defina:

```text
SUPABASE_URL=https://juiegqemecodojunlbcc.supabase.co
SUPABASE_PUBLISHABLE_KEY=<chave pública do projeto Supabase>
```

As demais variáveis existentes (`APP_ORIGIN`, `PORT`, `SQLITE_PATH`) devem ser mantidas. Não precisa configurar uma conexão Postgres com senha, pois a API acessa o banco com o token verificado do usuário e o RLS.

Checagens de produção:

- `GET https://memory-production-6ff74d87.up.railway.app/api/health` — processo/SQLite legado.
- `GET https://memory-production-6ff74d87.up.railway.app/api/supabase/status` — Supabase Auth alcançável.
- `GET /api/supabase/me` — requer `Authorization: Bearer <access_token>`.
- `GET /api/supabase/scores` — apenas melhores pontuações do usuário.
- `PUT /api/supabase/scores` — salva seu próprio recorde; resultados enviados pelo navegador ainda **não são verificados no servidor** para rankings competitivos.

### Configuração Cloudflare Pages

Projeto Git conectado ao `Georlan/memory`. Use:

| Configuração | Valor |
|---|---|
| Framework | React (Vite) |
| Root directory | raiz |
| Production branch | `main` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 22 |
| Pages Functions | pasta `functions/api/[[path]].js` do repositório |

**Não habilite** build `npm run dev` ou output `.` no Cloudflare. O deploy de Pages precisa incluir a pasta `functions`; se usar Workers Static Assets em vez de Pages, a ponte deve ser implementada na configuração correspondente.

Para confirmar a ponte após o deploy, abra `https://SEU-SITE.pages.dev/api/supabase/status`, que deve retornar `{"ok":true,"provider":"supabase"}`.

### Configuração Supabase Auth

No painel **Authentication → URL Configuration**, defina a **Site URL** do domínio Cloudflare Pages que será seu endereço principal e adicione em **Redirect URLs** tanto a URL do Pages como a URL do Railway, se usar ambas para login. Sem isso, a confirmação por email pode redirecionar para localhost.

O cadastro novo segue o fluxo de confirmação de email do projeto. Se o provedor SMTP gratuito atingir limites, configure um provedor SMTP antes de lançar para muitos usuários.

### Migração e dados antigos

O banco SQLite antigo continua no volume Railway e o `npm run dev` local continua usando SQLite, **sem apagar contas**. Os hashes scrypt e tokens SQLite **não são importados** para Supabase Auth: o usuário antigo precisará criar/confirmar uma conta Supabase (ou realizar um fluxo de recuperação de acesso futuro).

**Melhores recordes** salvos em `localStorage` são lidos ao entrar na nova conta. Caso sejam melhores que os registros remotos, o cliente os envia à API Railway e os sincroniza com o Supabase. O banco ainda não é adequado a um ranking público competitivo, pois os resultados são informados pelo cliente.

**Segurança e custo:** o projeto Supabase depende da cota/plano da organização, e o Railway pode interromper o serviço por cobrança pendente. Não divulgue o lançamento antes de confirmar login, email, RLS, deploy do Pages Function e cobrança.

## Iniciar React + backend local

**Pré-requisito:** Node.js **22.13+** (recomendado Node.js 22 LTS) e npm. A API usa o módulo `node:sqlite` integrado ao Node 22, sem servidor de banco ou pacote SQLite adicional.

```bash
git clone https://github.com/Georlan/memory.git
cd memory
npm install
npm run dev
```

Acesse **http://127.0.0.1:5173/**. O comando inicia automaticamente:

- **Frontend:** Vite em `127.0.0.1:5173`
- **Backend:** API Node HTTP em `127.0.0.1:3001`
- **Banco:** arquivo `data/pares.sqlite`, criado automaticamente

**Se já havia clonado o jogo:**

```bash
cd memory
git pull origin main
npm install
npm run dev
```

Pare o servidor Python antigo com `Ctrl+C` antes de começar. Para interromper o ambiente React + API, pressione `Ctrl+C` no terminal do `npm run dev`.

## Testar localmente

```bash
npm test
npm run test:smoke
npm run build
npm run test:prod
npm run preview
```

`npm run test:smoke` inicia os dois servidores por `npm run dev` e confirma que React/Vite e a API respondem em `/api/health` através do proxy.

`npm test` executa uma bateria HTTP real usando SQLite temporário: valida cadastro, senha com hash, tentativas inválidas, login, cookie HttpOnly, sessão após reiniciar o servidor e logout. O teste apaga o banco temporário ao finalizar.

Você também pode conferir a API ligada:

```bash
curl http://127.0.0.1:3001/api/health
```

Deve responder `{"ok":true,"database":"sqlite"}`.

Após compilar, `npm run test:prod` inicia o servidor no modo de produção com um SQLite descartável, verifica a entrega do React, cookies `Secure`, bloqueio de origem, login/logout e persistência após reiniciar.

## Como funciona a autenticação

1. No modo desenvolvimento, a primeira tela pede login ou criação de conta.
2. Um novo usuário é salvo no SQLite com `name`, `email`, hash **scrypt** da senha e salt aleatório. **A senha original não é salva.**
3. A API cria uma sessão com token aleatório; apenas o **hash do token** fica no SQLite.
4. O navegador recebe um cookie `HttpOnly; SameSite=Strict`, válido por sete dias; `GET /api/auth/me` restaura a sessão ao atualizar a página.
5. `POST /api/auth/logout` revoga a sessão no banco.

Rotas disponíveis:

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/health` | Verifica se API está ativa |
| POST | `/api/auth/register` | Cria conta e sessão |
| POST | `/api/auth/login` | Valida email/senha e cria sessão |
| GET | `/api/auth/me` | Retorna usuário autenticado |
| POST | `/api/auth/logout` | Revoga o token |

O Vite encaminha `/api` para o backend na porta 3001. Em desenvolvimento o backend escuta apenas em `127.0.0.1`; em produção, escuta em `0.0.0.0` na porta `PORT` disponibilizada pelo Railway. O frontend e a API devem estar na mesma origem HTTPS. As requisições de escrita verificam `Origin` contra `APP_ORIGIN`. Há validação básica, limite de tamanho do corpo e rate limiting em memória para login/cadastro.

O banco está em `data/pares.sqlite`, que é ignorado pelo Git. **Não envie esse arquivo ao GitHub**. Para reiniciar todas as contas locais, pare o servidor e exclua a pasta `data/` (isso apaga usuários e sessões locais).

**Limitações:** esta é a primeira implantação do login. Os cookies usam `HttpOnly; SameSite=Strict; Secure` em produção e a API verifica a origem, mas ainda é necessário evoluir antiabuso distribuído, recuperação de senha, observabilidade e backup automatizado antes de ampliar a base de usuários. O placar permanece no `localStorage` do navegador e ainda não é associado à conta do SQLite. O banco do computador **não é migrado automaticamente** para o Railway. Contas locais precisarão ser criadas novamente no ambiente remoto, salvo migração futura explícita e segura.

## Hospedagem no Railway — aplicação com login

O serviço `memory` do projeto Railway `radiant-encouragement` usa **um único servidor Node** para entregar os arquivos compilados do React e responder às rotas `/api` na **mesma origem HTTPS**. O SQLite grava em um volume persistente montado em `/data`.

- **Build:** `npm run build`, gera `dist/`
- **Start:** `npm run start`, executa Node.js com `NODE_ENV=production`
- **Health check:** `/api/health` ou `/health`
- **Volume persistente:** montar em `/data` (uma réplica e uma região)
- **Variáveis do serviço:** `SQLITE_PATH=/data/pares.sqlite`, `VITE_AUTH_ENABLED=true`, `APP_ORIGIN=https://<dominio-publico-do-railway>`
- **Porta:** Railway injeta `PORT` ou é possível configurar `PORT=3001`

`VITE_AUTH_ENABLED` é uma flag compilada pelo Vite; deve estar definida **antes do build** para exibir a tela de login no site hospedado. O valor não é segredo. `APP_ORIGIN` deve coincidir exatamente com a URL HTTPS do app, sem barra final.

**Atenção:** nunca use `npm run dev` em produção; esse comando inicia dois processos de desenvolvimento e não serve o build com segurança. Não hospede o SQLite em disco efêmero. Use um único replica com volume e cópias de segurança antes de aceitar dados importantes.

### Cloudflare Pages (frontend público separado)

Cloudflare Pages continua podendo publicar o frontend estático, mas **não executa a API Node nem acessa o SQLite do Railway**. Se houver um deploy Cloudflare existente sem proxy seguro de `/api`, deixe `VITE_AUTH_ENABLED` desativado nesse deploy até configurar o encaminhamento HTTPS de mesma origem para o Railway.

Para que o domínio final seja gerenciado pelo Cloudflare, você pode futuramente apontar um domínio personalizado para o serviço Railway após configurar e verificar o DNS. A origem exata deverá ser adicionada em `APP_ORIGIN` e a autenticação testada novamente.

Configuração do Cloudflare Pages para o frontend estático separado:

| Campo | Valor |
|---|---|
| Framework preset | React (Vite) / Vite |
| Production branch | `main` |
| Root directory | Raiz do repositório |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22 |

## Scripts

| Comando | Ação |
|---|---|
| `npm run dev` | Inicia frontend e API local juntos |
| `npm run dev:client` | Inicia somente o Vite |
| `npm run dev:server` | Inicia somente a API SQLite |
| `npm test` | Roda testes de integração com SQLite |
| `npm run test:smoke` | Testa `npm run dev`, frontend e proxy da API |
| `npm run build` | Compila frontend para `dist/` |
| `npm run start` | Inicia Node + frontend compilado em produção |
| `npm run test:prod` | Smoke de produção HTTPS/cookies/SQLite |
| `npm run preview` | Prévia do build estático (sem API) |

## Estrutura

```text
index.html              Entrada do Vite
src/main.jsx            React Root
src/App.jsx             Jogo da memória
src/AuthGate.jsx        Login, cadastro e controle de sessão
src/auth.css            Layout da área de login
styles.css              Identidade de automobilismo
assets/racer-art.svg    Arte vetorial
vite.config.js          Proxy /api e configuração Vite
server/index.mjs        Backend Node + SQLite
server/auth.test.mjs    Testes HTTP com SQLite temporário
scripts/dev.mjs         Inicialização dos dois servidores
scripts/dev-smoke.mjs   Teste de inicialização e proxy
scripts/prod-smoke.mjs  Smoke de produção após npm run build
data/pares.sqlite       Banco local, criado na primeira execução (ignorado pelo Git)
```
