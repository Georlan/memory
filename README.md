# PARES — Sua mente. Sem freios.

Um jogo da memória responsivo com estética de pôster automobilístico, agora feito com **React + Vite**.

## Desenvolvimento local

**Requisitos:** Node.js 20.19+ ou 22.12+ e npm. Recomendado: Node 22.

```bash
git clone https://github.com/Georlan/memory.git
cd memory
npm install
npm run dev
```

Abra o endereço mostrado no terminal (normalmente **http://localhost:5173/**). O servidor Vite tem hot reload.

Se você já tem o repositório clonado e antes executava `python3 -m http.server 8000`, pare aquele servidor com **Ctrl+C** e agora use:

```bash
git pull origin main
npm install
npm run dev
```

## Produção

```bash
npm run build
npm run preview
```

`npm run build` compila uma versão estática na pasta `dist/`. `npm run preview` permite conferir o build localmente.

### Deploy no Cloudflare Pages

Conecte `Georlan/memory` no Cloudflare Pages, com estas configurações:

| Campo | Valor |
|---|---|
| Framework preset | React (Vite) ou Vite |
| Production branch | `main` |
| Root directory | raiz do repositório (padrão) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22 (o projeto inclui `.node-version`) |

**Importante:** se o projeto Cloudflare Pages foi configurado antes da migração como site HTML puro (`exit 0` e `.`), altere os campos acima e execute novamente o deploy. O Cloudflare instala as dependências do `package.json` durante o build.

O jogo continua sendo um site estático, **não precisa de servidor de backend** para ser hospedado.

## Funcionalidades

- 3 níveis de dificuldade (6, 8 e 10 pares).
- Cartas com animação de virada e tema de automobilismo.
- Pontuação: +100 por par, −15 por erro e −5 por 10 segundos decorridos; nunca fica abaixo de zero.
- Cronômetro, progresso, tela de vitória e sons opcionais.
- Recordes por dificuldade guardados no `localStorage` (sem login ou banco).
- Interface responsiva, controles por teclado, textos de acessibilidade e suporte a movimento reduzido.

## Estrutura do projeto

```text
index.html               Ponto de entrada do Vite
src/main.jsx             Montagem da aplicação React
src/App.jsx              Interface, estado e lógica React do jogo
styles.css               Design responsivo de automobilismo
assets/racer-art.svg     Ilustração vetorial original
vite.config.js           Configuração do bundler
package.json             Dependências e scripts npm
```

A arte em SVG é original e usa a linguagem visual da referência enviada, sem replicar logotipos comerciais.
