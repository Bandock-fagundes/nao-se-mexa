# NÃO SE MEXA!

Jogo 3D de terror e sobrevivência, em primeira pessoa, para navegador — solo ou cooperativo com até 3 jogadores.
Vocês estão presos numa mansão vitoriana gerada proceduralmente. Encontrem as chaves, destranquem a saída
no hall de entrada e fujam antes que **a criatura** toque em alguém (o toque mata na hora).

- **Fase 1 — A criatura vê:** ela só percebe quem **se move** no campo de visão dela.
- **Fase 2 — A criatura escuta:** barulhos chamam a atenção dela (veja os níveis de som abaixo).
- **Fase 3 — A criatura fareja:** a cada 20–30 s ela para e fareja os rastros deixados pelos jogadores.

### Novidades da v2 (BETA)
- **3 chaves por casa**, dentro de uma gaveta/porta específica de um móvel ou **sobre mesas**; mudam de lugar a cada partida.
  Cada gaveta abre separadamente (mire com o pontinho). A chave achada **brilha branco, piscando de leve**.
- **Inventário:** o HUD mostra "Você tem N chave(s)". Com chave no bolso, a **porta de saída aparece através das paredes**.
  A porta precisa de **3 chaves colocadas**, por qualquer jogador e em parcelas (ex.: 2 + 1).
- **Níveis de som** com onda na tela: **vermelho** = a casa inteira ouve · **amarelo** = o andar todo e o de baixo ·
  **baixo** (branco) = o cômodo e os vizinhos. Agachado = silêncio total; andar em pé = só às vezes a madeira range (ouvido de
  perto); correr = sem rangido, mas passos ouvidos. Objetos: esbarrão leve balança, forte derruba (vidro/metal = mais alto).
- **Criatura:** só vê quem se mexe; visto de muito longe, ela vem andando aos poucos. Ao ouvir um som longe, corre; perto,
  desacelera, vai ao local, circula e confere os cômodos vizinhos. Nunca some por muito tempo (às vezes vai longe, às vezes
  aparece perto "do nada", sem teleporte). Jogador parado e despercebido não morre por ela passar raspando.
- **A história da casa:** bilhetes, páginas de diário, livros abertos e um recorte de jornal sobre os móveis, quadros da
  família e desenhos de criança colados nas janelas contam o que aconteceu com os Albuquerque (1961–1974). Mire e aperte
  **E** para ler ou olhar o quadro; **E** de novo (ou se afastar) fecha. **O jogo não pausa enquanto você lê.**
- Colegas mortos ficam **caídos no chão** (pose de corpo); música do menu e da partida mais sombria; passos da criatura
  com peso e garras na madeira.
- **Máximo de 3 jogadores.** Morte de um colega não é anunciada — só quem acha o corpo fica sabendo; se ele levava chave, o
  corpo aparece como "fantasminha" através das paredes e dá para pegar as chaves dele.

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
| E | interagir (ler bilhetes/livros, olhar quadros, portas, cada gaveta, armários, baús, caixas, prateleiras, chave, colocar chaves na saída, corpo com chaves, derrubar objetos) |
| F | liga/desliga a lanterna |
| Esc | pausa (o mundo **não** para — a criatura continua andando) |
| F3 | mostra/esconde FPS e resolução de render |

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

Qualidade gráfica (**Baixa**: sem sombras, sem bloom, sem AA, render até 1280×720, mapas de 256 px · **Média**: sombras
1024, bloom, FXAA, render até 1920×1080 · **Alta**: sombras 2048, bloom, SSAO, SMAA, render até 2560×1440 · **Ultra (4K)**:
como a Alta + render até 3840×2160, mapas de 1024 px e 10 luzes), volume geral/efeitos/ambiente, sensibilidade do mouse,
campo de visão e inverter eixo vertical.

**Imagem "estilo DLSS" (v4).** No navegador não existe DLSS de verdade; o jogo faz o equivalente honesto em WebGL:
- **Resolução dinâmica** (ligada por padrão): a cena 3D é desenhada numa imagem menor que a tela (entre 50–60% e 100%,
  conforme o preset) e a escala se ajusta a cada ~0,5 s para segurar o **FPS alvo** (30 / 60 / 120 / sem limite). Tem
  histerese: se uma subida não couber, espera cada vez mais antes de tentar de novo, para não ficar oscilando.
- **Upscale + nitidez estilo FSR 1:** a imagem é ampliada para a resolução da tela com filtro bicúbico (Catmull-Rom) com
  anti-halo, e recebe nitidez adaptativa ao contraste (fórmula do RCAS da AMD). O **FXAA/SMAA** roda antes, na resolução
  de render. HUD e menus continuam sempre na resolução nativa.
- **Resolução máxima:** 1080p / 1440p / 4K / nativa do monitor (limita o tamanho da imagem final;
  escolher Ultra com 1080p/1440p selecionado passa para 4K; nunca renderiza acima da tela). **Nitidez:** 0–100% (padrão 50%). **Escala de renderização:** fixa, só vale com a dinâmica desligada.
- **F3** (ou "Mostrar FPS e resolução" nas configurações) mostra FPS, ms por quadro, resolução de render → tela,
  draw calls e triângulos.

Estatísticas (partidas, vitórias, mortes, fases
concluídas, tempo sobrevivido) também ficam no `localStorage`.

## Testes

```bash
npm test     # node:test — fases 1–3, níveis de som, IA v2, chaves/gavetas/depósito, rede (3 jogadores, heartbeat, erros), 500 sementes, móveis
node test/simulate.mjs 4 1,2,3          # partidas simuladas com robôs (1 e 3 jogadores)
node test/simulate.mjs 3 1 frozen       # criatura congelada: confere chaves alcançáveis + saída
npm run e2e  # navegador real (puppeteer) com 2 páginas + capturas em shots/
node e2e/perf-probe.mjs antes   # v4: draw calls / triângulos por quadro em 4 pontos da casa (renderer.info)
node e2e/dynres-probe.mjs       # v4: controlador da resolução dinâmica (real + simulação de GPU com vsync)
ONLY=hall,wardrobe EXTRA='&res=0.67' node e2e/v3-shots.mjs shots/x   # capturas com render a 67% + upscale/nitidez
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

## EVA ENGINE (em breve)

O servidor também publica a pasta `public-eva/` em **`/eva/`** (ex.: https://nao-se-mexa.onrender.com/eva/).
Por enquanto é só uma página "EVA ENGINE — em breve"; para publicar a engine, basta colocar o build estático dela nessa pasta.
