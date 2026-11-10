# PARES — Sua mente. Sem freios.

Jogo da memória em **React + Vite** com estética automobilística. A fase experimental inclui uma **API Node.js local** e banco **SQLite real** para cadastro, login, sessões e logout.

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
npm run preview
```

`npm run test:smoke` inicia os dois servidores por `npm run dev` e confirma que React/Vite e a API respondem em `/api/health` através do proxy.

`npm test` executa uma bateria HTTP real usando SQLite temporário: valida cadastro, senha com hash, tentativas inválidas, login, cookie HttpOnly, sessão após reiniciar o servidor e logout. O teste apaga o banco temporário ao finalizar.

Você também pode conferir a API ligada:

```bash
curl http://127.0.0.1:3001/api/health
```

Deve responder `{"ok":true,"database":"sqlite"}`.

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

O Vite encaminha `/api` para o backend na porta 3001. O backend escuta apenas em `127.0.0.1`, sem CORS público, e valida origem das requisições de escrita. Há validação básica, limite de tamanho do corpo e rate limiting em memória para login/cadastro.

O banco está em `data/pares.sqlite`, que é ignorado pelo Git. **Não envie esse arquivo ao GitHub**. Para reiniciar todas as contas locais, pare o servidor e exclua a pasta `data/` (isso apaga usuários e sessões locais).

**Nesta etapa o login é um experimento local, não uma autenticação de produção.** Para implantação real, ainda serão necessários HTTPS, definição de domínio/API, proteção CSRF e antiabuso reforçadas, procedimentos de backup/recuperação e gestão de credenciais. O placar permanece no `localStorage` do navegador e ainda não é associado ao usuário do SQLite.

## Cloudflare Pages (apenas frontend por enquanto)

Para não interromper o jogo já hospedado, a autenticação é habilitada por padrão **somente em desenvolvimento**. O build de produção mantém o jogo público sem solicitar login, já que o Cloudflare Pages não executa esta API local nem armazena o SQLite do computador.

Se futuramente você configurar uma API hospedada com banco persistente, será possível ativar a interface de login no build usando `VITE_AUTH_ENABLED=true`, **mas não faça isso antes de hospedar a API**.

Configuração Cloudflare Pages:

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
data/pares.sqlite       Banco local, criado na primeira execução (ignorado pelo Git)
```
