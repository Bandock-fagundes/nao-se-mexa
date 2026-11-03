# NÃO SE MEXA!

Jogo 3D de terror e sobrevivência, em primeira pessoa, para navegador — solo ou cooperativo com até 4 jogadores.
Vocês estão presos numa mansão vitoriana gerada proceduralmente. Encontrem as chaves, destranquem a saída
no hall de entrada e fujam antes que **a criatura** toque em alguém (o toque mata na hora).

- **Fase 1 — A criatura vê:** ela só percebe quem **se move** no campo de visão dela. 1 chave.
- **Fase 2 — A criatura escuta:** passos, corrida, pulos, portas e objetos derrubados chamam a atenção dela. 2 chaves.
- **Fase 3 — A criatura fareja:** a cada 20–30 s ela para e fareja os rastros deixados pelos jogadores. 3 chaves.

## Como rodar localmente

Requisitos: **Node.js 18 ou superior**.

```bash
npm install        # instala three, vite e ws
npm run build      # compila o cliente (Three.js + Vite) para /dist
npm start          # inicia o servidor HTTP + WebSocket (porta 3000 ou $PORT)
```

Abra `http://localhost:3000`. Para jogar com amigos na mesma rede, eles abrem `http://SEU-IP:3000`.
A aba de testes fica em `http://localhost:3000/testar`.

## Controles

| Tecla | Ação |
|---|---|
| W A S D | andar |
| Mouse | olhar (clique na tela para capturar o mouse) |
| Shift | correr (gasta fôlego e faz mais barulho) |
| Ctrl (segurar) / **C** (alternar) | agachar — use **C** se o navegador fechar a aba com Ctrl+W |
| Espaço | pular |
| E | interagir (portas, gavetas, armários, baús, caixas, prateleiras, chave, saída, derrubar objetos) |
| F | liga/desliga a lanterna |
| Esc | pausa (o mundo **não** para — a criatura continua andando) |

## A lanterna (regra exata)

- **Ligada:** você enxerga melhor, mas fica mais visível. O alcance em que a criatura percebe seu movimento é
  multiplicado por **1,3** (máximo 25 m) e o campo de visão dela ganha **+20°** para você.
- **Feixe na criatura:** se o feixe (cone de 24°, até 16 m, sem paredes no caminho) atinge a criatura **enquanto você
  se move**, ela te detecta imediatamente, mesmo fora do campo de visão dela.
  Se você estiver **parado**, ela **não** te detecta: apenas nota a luz e vai **investigar a região** (com erro de
  posição), como se fosse um som.
- **Desligada:** o alcance cai para **×0,75** — exceto se você estiver perto (≤ 3,5 m) de uma luminária acesa.
- **Jogador parado continua indetectável pela visão**, com ou sem lanterna. Girar a câmera não conta como movimento:
  o servidor mede o deslocamento do corpo, separado da rotação da câmera.

## Multiplayer

- **Criar sala** gera um código de 5 caracteres. Compartilhe o código ou o link `https://seu-jogo/?sala=CODIGO`.
- Na sala de espera: lista de jogadores, estado de pronto, botão **Copiar código**, **Compartilhar convite**, **Sair**.
  Só o anfitrião inicia, e só quando todos estiverem prontos.
- O **servidor é autoritativo**: gera a semente da mansão, valida movimentos (velocidade e paredes), portas,
  recipientes, chaves, saída, mortes e roda a IA da criatura. Os clientes geram a mesma mansão a partir da
  semente + versão do gerador e conferem o *hash* do mapa.
- Queda de conexão: o cliente tenta voltar à mesma sala por 30 s usando um *token* de reconexão (também ao
  recarregar a página). Se o anfitrião sair, outro jogador vira anfitrião automaticamente. Se o servidor cair,
  aparece a tela **SERVIDOR DESCONECTADO**.
- Jogadores mortos viram **espectadores** (clique ou Q para alternar quem observar). A partida termina em vitória
  se ao menos um jogador escapar e não restar ninguém vivo dentro da mansão.
- O modo **solo** usa exatamente o mesmo caminho pelo servidor (sala de 1 jogador).

## Aba TESTAR JOGO (`/testar`)

Usa a mesma implementação do jogo, com um painel de diagnóstico opcional: estado da criatura, sentidos ativos,
último som percebido, última região investigada, farejamento, chaves, saída, conexão e semente. Permite gerar e
validar mansões com qualquer semente (mapa dos 4 andares), jogar com uma semente específica, regenerar a mansão
durante a partida e criar salas multiplayer de teste.

## Configurações (salvas no navegador)

Qualidade gráfica (**Baixa**: sem sombras, sem bloom, resolução 0,75×, mapas de 256 px · **Média**: sombras 1024,
bloom · **Alta**: sombras 2048, bloom, SSAO, resolução até 1,5×), resolução, volume geral/efeitos/ambiente,
sensibilidade do mouse, campo de visão e inverter eixo vertical. Estatísticas (partidas, vitórias, mortes, fases
concluídas, tempo sobrevivido) também ficam no `localStorage`.

## Testes

```bash
npm test     # node:test — 38 testes: fases 1–3, chaves, morte, validação de movimento, 500 sementes, multiplayer com 2 clientes ws reais
npm run e2e  # navegador real (puppeteer) com 2 páginas + capturas em shots/
```

O teste E2E precisa do puppeteer (`npm i -D puppeteer`, não incluído nas dependências para não pesar no deploy).
Neste ambiente o Chrome foi instalado em `.puppeteer-cache`: use `PUPPETEER_CACHE_DIR=$PWD/.puppeteer-cache npm run e2e`.

## Publicar no Render

O arquivo `render.yaml` já está pronto (Web Service Node):

- **Build Command:** `npm install --include=dev && npm run build`
- **Start Command:** `npm start`
- O servidor escuta em `0.0.0.0:$PORT` (`process.env.PORT`) e responde `/health`; o cliente usa `wss://` quando a página é https.

Crie um *Blueprint* no Render apontando para o repositório, ou um Web Service com os comandos acima.
Observação: no plano gratuito o serviço “dorme” sem uso; a primeira conexão pode demorar alguns segundos.

## Estrutura

```
shared/   gerador de mansão (semente + versão), colisão, linha de visão, som, navegação — usado por servidor e cliente
server/   HTTP + WebSocket, salas, partida autoritativa, sentidos e máquina de estados da criatura, grade de cheiro
client/   Three.js: renderização, materiais/texturas procedurais, mansão, móveis, criatura (SkinnedMesh), mão em
          primeira pessoa, colegas, áudio Web Audio procedural (HRTF + oclusão), interface
test/     testes node:test
e2e/      teste de navegador (puppeteer)
```

Todos os modelos, texturas e sons são gerados por código — nenhum arquivo externo é baixado.
