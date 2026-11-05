# NÃO SE MEXA! — Relatório de conclusão

Relatório objetivo pedido na seção 25 da especificação (itens 1 a 8), com base nos critérios da seção 23.
Data da verificação: 03/11/2026 (v1); atualização v2 em 05/11/2026 (seção abaixo).

## Atualização v2 (BETA) — 05/11/2026

**O que mudou na v2**
- 3 chaves por casa em gavetas/portas específicas ou sobre mesas; inventário; porta de saída visível através das paredes
  com chave no bolso; depósito em parcelas por qualquer jogador; máximo de 3 jogadores.
- Sons em níveis (vermelho / amarelo / baixo) com onda na tela; criatura que corre até sons distantes, investiga, circula,
  confere os vizinhos, persegue de longe e nunca some por muito tempo; quem fica parado e despercebido não morre.
- Morte silenciosa: só quem acha o corpo sabe; corpo com chaves vira "fantasminha" e as chaves podem ser recuperadas.
- **História da casa:** bilhetes, diário, livros abertos e recorte de jornal legíveis com **E** (o jogo não pausa), quadros
  da família e desenhos de criança nas janelas. Colegas mortos ficam caídos no chão; música mais sombria; passos da criatura
  na madeira; dentes/boca da criatura refeitos; varredura automática de sobreposição de móveis/quadros/janelas (0 em 100 casas).
- Rede mais robusta: aviso de reinício do servidor, tolerância a engasgos (3 pings), 120 s para voltar, sala vazia aguarda 180 s.
- Nova rota **/eva/** (página provisória "EVA ENGINE — em breve", servida da pasta `public-eva/`).

**Testes da v2:** `npm test` **69/69** aprovados. `npm run e2e` (2 navegadores reais): na fase 1 da v2, **46/46**; nesta finalização a máquina de teste estava
sobrecarregada (2 núcleos, outro teste de navegador rodando junto): rodada com **44/46** — 1 falha era um bug real da mira
em gavetas de baixo (corrigido) e 1 foi queda de conexão causada pela página travada pela CPU (o jogo reconectou sozinho);
uma rodada seguinte terminou com o Chrome fechando por sobrecarga. Publicado em 05/11/2026 (servidor sem jogadores no momento).
- **Link:** https://nao-se-mexa.onrender.com · página provisória da EVA ENGINE: https://nao-se-mexa.onrender.com/eva/
Limitações novas: com a lanterna muito perto (≈1,5 m), papéis claros, quadros e janelas ainda ficam bem claros no centro do
facho; a versão continua marcada como BETA até o Gabriel jogar com amigos no link público.

---

## 1. Funcionalidades implementadas

**Jogabilidade**
- Jogo 3D em primeira pessoa no navegador (Three.js), sem instalação.
- Movimentação com WASD, corrida (Shift, com fôlego), agachar (Ctrl segurado ou C), pulo (Espaço), câmera com mouse (pointer lock), colisões com paredes e móveis.
- Mão em primeira pessoa e lanterna (tecla F) com regra própria de visibilidade.
- Interação com a tecla E: portas, gavetas, armários, baús, caixas, prateleiras, chaves, saída e objetos que podem ser derrubados.
- Três fases: **Fase 1 — a criatura vê** (1 chave), **Fase 2 — a criatura escuta** (2 chaves), **Fase 3 — a criatura fareja** (3 chaves).
- Chaves escondidas aleatoriamente em esconderijos; saída trancada no hall de entrada, que só abre com todas as chaves.
- Vitória (sair pela porta da frente), derrota (o toque da criatura mata na hora), modo espectador para quem morreu, "Jogar novamente" com nova mansão, "Próxima fase", "Voltar à sala".
- HUD com fase, chaves encontradas e objetivo; telas de menu, sala de espera, pausa, morte, fuga e fim de partida.
- Configurações salvas no navegador (qualidade gráfica, resolução, volumes, sensibilidade, campo de visão, inverter eixo) e estatísticas (partidas, vitórias, mortes, fases concluídas, tempo sobrevivido).
- Áudio posicional procedural (Web Audio com HRTF e oclusão por paredes).

**Criatura**
- Modelo 3D articulado (SkinnedMesh) com animações (andar, correr, olhar, farejar, atacar, matar).
- Navegação pela mansão por caminhos válidos, entre andares pelas escadas, abrindo portas.
- Máquina de estados: patrulha, vagar, olhar, alerta, perseguição, ataque, busca, investigação de som, farejamento, retorno.
- Visão (fase 1+): só percebe quem **se move** dentro do campo de visão, sem enxergar através de paredes.
- Audição (fase 2+): passos, corrida, pulos, portas e objetos derrubados; paredes e portas atenuam; recebe só uma posição aproximada.
- Olfato (fase 3): fareja a cada 20–30 s e segue rastros que enfraquecem com o tempo.
- Não sabe automaticamente onde os jogadores estão; morte por contato confirmada pelo servidor (distância + sem parede no meio).

**Mapas**
- Mansão gerada por semente: térreo, primeiro andar, sótão e porão, todos conectados por escadas.
- Variação de salas, móveis e esconderijos por semente; validação automática (conectividade, chaves alcançáveis, saída, pontos de nascimento, navegação da criatura) com configuração de reserva caso uma semente falhe.

**Multiplayer**
- Servidor autoritativo (Node + WebSocket) para 1 a 4 jogadores; o modo solo usa o mesmo caminho.
- Criar sala (código de 5 caracteres), entrar por código ou por link `?sala=CODIGO`, estado de pronto, só o anfitrião inicia.
- Sincronização de posição, lanterna, portas, recipientes, chaves, criatura, mortes, fuga e fim de partida; o cliente confere o *hash* do mapa com o servidor.
- Reconexão por 30 s com *token*, migração automática de anfitrião, tela de servidor desconectado.

**Navegador / testes**
- Aba **TESTAR JOGO** (`/testar`) com painel de diagnóstico (estado da criatura, sentidos, último som, farejamento, chaves, saída, conexão, semente), gerador/validador de mansões por semente com mapa dos andares, partidas com semente escolhida e salas de teste.
- Pronto para o Render (`render.yaml`): build `npm install --include=dev && npm run build`, start `npm start`, servidor em `0.0.0.0:$PORT`, verificação em `/health`, cliente usa `wss://` em páginas https.

## 2. Funcionalidades efetivamente testadas

**Testes automáticos de servidor (`npm test`, 38 testes, node:test)**
- Fase 1: detecção por movimento no campo de visão; sem visão através de paredes; jogador parado não é detectado (girar a câmera não conta); lanterna parada só atrai investigação; sem audição nem olfato na fase 1; perseguição por caminho válido; investigação da última posição conhecida.
- Fase 2: visão continua; sons no alcance configurado; intensidade (agachar reduz, correr aumenta); paredes/portas atenuam; objetos derrubados atraem; posição só aproximada; não persegue sons não detectados.
- Fase 3: visão e audição continuam; farejamento periódico de 20–30 s; rastros enfraquecem; segue rastros sem posição exata; não atravessa paredes nem se teletransporta; abandona investigação sem resultado.
- Chaves e saída: quantidade por fase em esconderijos válidos de salas diferentes; interação exige proximidade; saída só abre com todas as chaves; fuga encerra com vitória; chaves continuam valendo após a morte de quem pegou.
- Morte: contato mata na hora; não ocorre através de paredes; morto não interage, não faz som/cheiro e não é percebido.
- Validação de movimento: velocidade impossível e atravessar paredes são corrigidos pelo servidor.
- Geração: **500 sementes** geram mansões válidas; determinismo por semente + versão; configuração de reserva válida; criatura navega entre andares.
- Multiplayer com 2 clientes WebSocket reais: mesma sala, semente e mapa; movimento, portas, recipientes, chaves, morte e vitória sincronizados; desconexão/reconexão com *token* e migração de anfitrião; sala inexistente, cheia ou já iniciada.
- HTTP: serve o cliente compilado, a rota `/testar` e `/health`.

**Teste de ponta a ponta em navegador real (`npm run e2e`, Chrome headless com WebGL por software, 2 páginas = 2 jogadores)**
Cobre o fluxo completo: menu → criar sala → segundo jogador entra pelo link de convite → prontidão → início → sincronização → lanterna → interação com tecla E num esconderijo → chave compartilhada → HUD → encontro com a criatura → morte do jogador B → modo espectador → saída destrancada → fuga andando com o teclado → telas de vitória nos dois → estatísticas salvas → reinício com nova semente → painel de diagnóstico → gerador da aba TESTAR JOGO.

## 3. Resultado dos testes

- `npm test`: **38 de 38 aprovados**, 0 falhas.
- `npm run e2e`: **27 de 27 verificações aprovadas**, 0 falhas, nenhum erro de JavaScript nas páginas (≈ 10 min nesta máquina, por causa da renderização por software).

| # | Verificação E2E | Resultado |
|---|---|---|
| 1 | menu principal exibido | OK |
| 2 | sala criada com código de 5 letras | OK |
| 3 | link `?sala=` abre o modo com o código preenchido | OK |
| 4 | anfitrião vê 2 jogadores | OK |
| 5 | botão iniciar bloqueado até todos ficarem prontos | OK |
| 6 | mesma semente nas duas páginas | OK |
| 7 | mapa do cliente confere com o servidor (hash) | OK |
| 8 | A vê o colega B (sincronização de posição) | OK |
| 9 | posição de B em A confere | OK |
| 10 | tecla F desliga a lanterna | OK |
| 11 | estado da lanterna do colega sincronizado | OK |
| 12 | prompt de interação aparece ao mirar no esconderijo | OK |
| 13 | chave coletada em A aparece em B | OK |
| 14 | HUD mostra fase, chaves e objetivo | OK |
| 15 | criatura visível no encontro | OK |
| 16 | tela de morte em B | OK |
| 17 | A recebe a morte de B | OK |
| 18 | B entra no modo espectador observando A | OK |
| 19 | prompt da saída | OK |
| 20 | saída aberta sincronizada | OK |
| 21 | tela de vitória em A | OK |
| 22 | tela de vitória em B (morto, mas a equipe venceu) | OK |
| 23 | estatísticas salvas no localStorage | OK |
| 24 | reinício gera nova semente | OK |
| 25 | painel de diagnóstico mostra criatura, sentidos e semente | OK |
| 26 | TESTAR JOGO: gerar e validar mansão | OK |
| 27 | nenhum erro de página (exceção JS) | OK |

Capturas de tela da execução ficam em `shots/` (por exemplo `death.png`, `spectator.png`, `victory.png`, `diagnostics-panel.png`, `diagnostics-map.png`). O resultado detalhado fica em `shots/e2e-results.json`.

## 4. Link para abrir a versão jogável

**https://nao-se-mexa.onrender.com**

(Observação: no plano gratuito do Render o serviço "dorme" sem uso; a primeira abertura pode demorar alguns segundos.)

## 5. Como acessar a aba TESTAR JOGO

- Abra **https://nao-se-mexa.onrender.com/testar** (ou clique em **TESTAR JOGO** no menu principal).
- Ali dá para: gerar e validar uma mansão com qualquer semente e ver o mapa dos andares; começar uma partida com uma semente específica; criar uma sala de teste multiplayer; ligar/desligar o painel de diagnóstico durante a partida (estado da criatura, sentidos ativos, último som, farejamento, chaves, saída, conexão e semente) e regenerar a mansão.

## 6. Como criar uma sala multiplayer e convidar outra pessoa

1. Abra **https://nao-se-mexa.onrender.com**, digite seu nome e clique em **Criar sala**.
2. Na sala de espera aparece um **código de 5 caracteres**. Clique em **Copiar código** ou **Compartilhar convite** — o convite é um link do tipo `https://nao-se-mexa.onrender.com/?sala=CODIGO`.
3. Mande o link (ou o código) para a outra pessoa. Ela abre o link em outro navegador/computador, digita o nome e clica em **Entrar** (o código já vem preenchido pelo link).
4. Cada convidado clica em **Pronto**. Quando todos estiverem prontos, o anfitrião escolhe a fase e clica em **Iniciar**.
5. Até 4 jogadores por sala. Se alguém cair, tem 30 s para voltar (inclusive recarregando a página); se o anfitrião sair, outro jogador vira anfitrião.

## 7. Limitações conhecidas

- Gráficos, modelos e sons são todos gerados por código (sem arquivos de arte externos): o visual é estilizado, não fotorrealista.
- Em computadores sem placa de vídeo ou com navegador sem aceleração, use a qualidade **Baixa**; nas qualidades Média/Alta o jogo pode ficar lento.
- Feito para teclado e mouse em computador; não há controles para celular/tablet nem suporte a controle (gamepad).
- O Render gratuito desliga o servidor sem uso: o primeiro acesso demora e, se o serviço reiniciar, as salas em andamento são perdidas (o estado fica na memória do servidor, sem banco de dados).
- Um único servidor; jogadores muito distantes geograficamente podem sentir atraso (*ping*) maior.
- Atalho Ctrl+W do navegador pode fechar a aba ao agachar com Ctrl; por isso existe a tecla **C** para alternar agachar.
- O teste de navegador (E2E) usa renderização por software e comandos de teste (teletransporte e posicionamento da criatura) disponíveis só nas salas da aba TESTAR JOGO, para chegar rápido a cada situação; ele não substitui uma partida jogada por pessoas.
- Detalhes visuais observados nas capturas do teste (em ajuste pela parte visual): o texto do modo espectador aparece por trás da tela de morte; no modo espectador aparece a mão em primeira pessoa no meio da tela.

## 8. Funcionalidades que ainda não puderam ser implementadas

- Nenhum item dos critérios da seção 23 ficou de fora: todos foram implementados e cobertos pelos testes automáticos e/ou pelo teste em navegador descritos acima.
- Não verificado ainda: uma partida com **pessoas reais em navegadores e redes diferentes no link público** (o multiplayer foi testado com clientes reais no mesmo servidor, inclusive dois navegadores). Essa verificação deve ser feita assim que o https://nao-se-mexa.onrender.com estiver no ar.
- Fora do escopo desta versão: chat de voz/texto, versão para celular, servidores em várias regiões e salvamento de salas após reinício do servidor.
