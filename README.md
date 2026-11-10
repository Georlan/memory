# PARES — Sua mente. Sem freios.

Jogo da memória interativo com identidade visual de **pôster de automobilismo**: fundo creme com textura de papel, vermelho de corrida, azul-preto, cortes diagonais, lettering condensado e uma ilustração vetorial original de um piloto.

O redesign foi inspirado na **linguagem visual** de uma referência enviada pelo usuário, sem reproduzir as marcas e os patrocinadores presentes nela. A ilustração está em `assets/racer-art.svg`.

## Rodar localmente

Você só precisa de um navegador moderno. Não existe backend nem etapa de build.

```bash
git clone https://github.com/Georlan/memory.git
cd memory
python3 -m http.server 8000
```

Abra **http://localhost:8000**.

Se o projeto já estiver clonado:

```bash
cd memory
git pull origin main
python3 -m http.server 8000
```

Se o servidor Python **já estiver em execução**, não execute outro servidor: basta fazer `git pull origin main` em um segundo terminal e atualizar a página com **Ctrl+Shift+R**.

Alternativa: abrir `index.html` diretamente no navegador. As fontes externas são opcionais: com a internet indisponível, o sistema usa fontes locais de fallback.

## Como jogar

Vire duas cartas por vez. Pares iguais permanecem revelados. A rodada termina quando todos os pares forem descobertos.

- **Iniciante:** 6 pares; **Piloto:** 8 pares; **Lenda:** 10 pares.
- Cronômetro inicia no primeiro clique.
- **Pontuação:** +100 por par; −15 por tentativa errada; −5 por cada 10 segundos decorridos. O placar nunca fica negativo.
- Recordes por dificuldade salvos apenas no seu navegador via `localStorage`.
- Animações de virada, som opcional, progresso, tela de vitória e interface responsiva.
- Acessibilidade: botões utilizáveis com teclado, mensagens de status e opção de movimento reduzido.

## Estrutura

```text
index.html            Interface da partida
styles.css            Identidade visual e layout responsivo
script.js             Lógica do jogo, cronômetro e recordes
assets/racer-art.svg  Ilustração vetorial original
README.md             Instruções
```

Feito com HTML, CSS e JavaScript, sem frameworks, sem instalação de pacotes e sem integração de terceiros além do carregamento opcional de fontes do Google Fonts.
