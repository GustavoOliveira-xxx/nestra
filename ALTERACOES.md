# Nestra — o que mudou nesta atualização

Este pacote é o projeto inteiro, já com as alterações aplicadas. Para usar,
substitua a pasta do projeto pelo conteúdo daqui (ou extraia por cima dela).

Se você preferir manter o histórico do Git, use o `nestra-atualizacoes.patch`
que está junto: `git am nestra-atualizacoes.patch` cria os dois commits, com
mensagem e autoria, sem sobrescrever nada à mão.

---

# Sétima rodada

## 20. Ambientes editam e navegam sem depender de recarga

O formulário já alterava os dados, mas a abertura 3D reaproveitada mantinha
o nome e a descrição antigos na tela. Agora esse topo atualiza seus textos
junto dos números, e “Todos os ambientes” chama o roteador diretamente,
mantendo também o `href` como alternativa nativa.

## 21. Capturas chegam ao ambiente certo e aparecem sozinhas

A fila de sincronização deixou de reescrever uma fotografia antiga. Se uma
nova captura entrar enquanto a rede responde, ela permanece na fila e sobe
na mesma rodada. Falhas temporárias preservam a ordem — primeiro o ambiente,
depois os itens que dependem dele — e o servidor só aceita um ambiente ativo
da própria conta.

O estado remoto agora leva `updatedAt` dos ambientes e a comparação considera
também nome, cor e ícone. A busca entre aparelhos ocorre a cada 15 segundos e
uma caixa vazia focada no celular não bloqueia mais o redesenho. Contadores da
barra lateral também reagem imediatamente aos cadastros locais.

## 22. O microfone realmente encerra

A captura da página unitária agora participa da limpeza da tela, registrar um
item encerra o ditado e uma confirmação atrasada de abertura não consegue mais
religar uma sessão abortada. O reconhecimento fecha após oito segundos sem
resultado e tem teto de um minuto, eliminando o indicador vermelho preso na
aba mesmo quando o navegador não entrega o evento de fim esperado.

Os testes automatizados passaram de 39 para **48 verificações**, incluindo a
corrida da fila, a ordem ambiente/item, ambientes equivalentes cadastrados,
`updatedAt` remoto e o encerramento do microfone durante a abertura. Os fluxos
de edição, navegação e cadastro também foram repetidos em navegador nas larguras
desktop e 390 × 844, sem recarregar a página.

### Arquivos desta rodada

    js/app/api.js              fila concorrente e ordenada
    js/app/store.js            sincronização mais rápida e ambiente ativo
    js/app/voice.js            encerramento garantido do microfone
    js/app/views/capture.js    ditado fecha ao registrar
    js/app/views/today.js      edição, navegação e captura unitária
    js/main.js                 repintura remota e contadores imediatos
    js/app/nlp.js              equivalências de ambientes cadastrados
    api/items/*                validação do ambiente da própria conta
    api/_lib/db.js             updatedAt do ambiente no cliente
    scripts/testes.js          regressões desta rodada
    sw.js                      nova versão da casca offline

---

# Sexta rodada

## 17. A captura virou uma ação, não uma transcrição crua

O Nestra agora trata a frase falada como um secretário local. Chamadas e
molduras conversacionais — “Nestra”, “por favor”, “preciso lembrar de”,
“anota aí que eu tenho que”, “você poderia adicionar uma tarefa para” —
servem para entender a intenção, mas não aparecem no título do item.

Assim, **“Preciso lembrar de limpar o quintal”** vira **“Limpar o quintal”**,
e **“Nestra, preciso fazer uma atividade de português valendo nota até
sexta”** vira **“Fazer uma atividade de português valendo nota”**, com o
prazo e o ambiente Estudos guardados nos campos próprios.

O tratamento continua inteiramente no navegador, sem serviço de IA pago e
sem enviar a fala a terceiros. A frase original permanece em `rawInput`,
para que nenhuma informação se perca mesmo quando o título é enxugado.
Entraram também novas formas de prazo e fala: “até sexta”, “pra segunda”,
“antes de quinta”, “daqui a 3 dias”, “depois de amanhã”, pedidos no começo
ou no fim e vocabulário comum de escola e faculdade.

## 18. Os dois botões da página de ambiente

“Editar ambiente” dependia de um evento global indireto. Agora recebe a
ação de edição diretamente da aplicação e abre o formulário do ambiente
certo. “Todos os ambientes” virou um link real para `#/ambientes`: além do
roteador do Nestra, ele tem a navegação nativa como plano B.

## 19. O símbolo dos ambientes na dashboard

O quadradinho de cor da barra lateral foi substituído pelo ícone escolhido
para cada ambiente, extrudado em duas camadas por CSS e em movimento 3D
constante. Ele usa a cor do ambiente, reage ao item ativo e não abre um
contexto WebGL por linha — importante para continuar leve no celular. A
preferência de movimento reduzido continua sendo respeitada.

Os testes passaram de 18 para **39 verificações**, cobrindo pedidos falados,
ações implícitas, prazos em posições diferentes, colisões entre data e
horário e preservação da frase original.

### Arquivos desta rodada

    js/app/nlp.js              secretário local, novos prazos e correções de sobreposição
    js/app/views/today.js      ações diretas e link nativo no cabeçalho do ambiente
    js/main.js                 edição ligada ao formulário e símbolo 3D na barra lateral
    css/layout.css             profundidade e movimento do novo símbolo
    scripts/testes.js          regressões do secretário local
    sw.js                      nova versão da casca offline

---

# Quinta rodada

## 14. O ditado que repetia no celular

No computador o ditado saía limpo; no celular, a mesma frase voltava
empilhada. A causa não estava no microfone nem na conexão: está em como
o reconhecimento do Android entrega o texto.

Ele não manda pedaços novos. Manda a **frase inteira outra vez, um pouco
maior**, a cada entrega:

    "pegar"  ·  "pegar ração"  ·  "pegar ração para o Max"

Somar isso — que é o que qualquer concatenação faz — produz exatamente
a escada que aparecia na tela: *"pegar pegar ração pegar ração para o
Max"*. No computador cada trecho vem uma vez só, e por isso o defeito
era só do celular.

Havia ainda duas fontes de repetição, ambas também exclusivas do celular:

- **O microfone reabria com a memória cheia.** O navegador encerra o
  reconhecimento sozinho depois de cada pausa, e o código reiniciava o
  *mesmo* objeto. A lista de resultados pertence ao objeto, e no Android
  ela vinha junto: a frase anterior voltava inteira e era somada ao que
  já estava guardado. Agora cada volta abre um objeto novo, que nasce com
  a lista vazia em qualquer navegador.
- **Dois toques abriam dois microfones.** O aviso de "estou ouvindo" só
  chega depois que o navegador confirma a abertura, e nesse intervalo um
  segundo toque — coisa comum em tela de toque — abria um segundo
  reconhecimento, transcrevendo a mesma fala em dobro na mesma caixa.

A correção central é uma regra só, aplicada em todos os pontos onde o
texto é juntado: **se o trecho novo começa com tudo o que já havia, ele
não é uma adição — é a mesma fala, crescida — e substitui o anterior.**
Se o que já havia contém o trecho novo, é reentrega e não há o que somar.
A comparação ignora maiúsculas, acentos e pontuação (o reconhecedor muda
os três entre uma entrega e outra) e só aceita o encaixe em fronteira de
palavra, para "sim" nunca casar dentro de "simples".

## 15. A data que virava NaN ao recarregar

Registrar "levar o carro na revisão amanhã às 14h" mostrava a data certa
na hora. Um Ctrl+R depois, no lugar dela: **NaN**.

O item nunca esteve errado — nem no navegador, nem no banco. O que
estava errado era a tradução entre os dois. A coluna `due_date` é do tipo
`date`, e o driver do Neon aplica os mesmos conversores do node-postgres:
uma coluna `date` chega ao código como **Date do JavaScript**, não como
texto. A conversão fazia `String(valor).slice(0, 10)`, e `String` de um
Date não dá ISO — dá:

    "Wed Aug 19 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"

cujos dez primeiros caracteres são **"Wed Aug 19"**. Era esse pedaço que
o navegador recebia como se fosse a data. Antes de recarregar, o item na
tela ainda era a cópia criada localmente, com a data boa — por isso só
aparecia depois do Ctrl+R, e por isso parecia bug de recarregamento.

A conversão passou a ler o dia pelos campos do próprio Date. O detalhe
que faltava era o fuso: o conversor monta o Date no fuso do servidor, e
`toISOString()` erraria o dia inteiro em qualquer servidor a leste de
Greenwich — está verificado em quatro fusos. `due_time` e `snoozed_until`
passaram pelo mesmo cuidado.

E a tela ganhou uma recusa: **data que não dá para ler não vira texto
nenhum.** Escrever "NaN undefined NaN" na linha do item é pior do que não
escrever data alguma — o item continua legível e o defeito fica onde tem
de ser consertado, em vez de aparecer na cara de quem usa.

## 16. `npm test`

O ditado já tinha sido corrigido duas vezes antes desta. Agora existe
`scripts/testes.js`, que roda sem microfone e sem banco: reproduz as
sequências que o Android entrega de verdade e passa as datas pelo
conversor real do driver, em vários fusos de servidor. São 18
verificações — e todas falham no código de antes desta rodada.

### Arquivos desta rodada

    js/app/voice.js              a regra de junção, sessão nova a cada volta
    api/_lib/db.js               colunas date e time convertidas direito
    js/app/nlp.js                humanDate recusa data ilegível
    js/app/views/items.js        linha sem ficha de data quando não dá para ler
    js/app/views/capture.js      mesma recusa nas fichas da captura
    js/main.js                   mesma recusa na busca e na prévia
    scripts/testes.js            os testes das duas correções (novo)
    package.json                 npm test
    sw.js                        versão do cache

---

# Quarta rodada

## 12. Uma peça 3D para cada ambiente, e não seis para doze

O formulário oferece doze ícones. As peças 3D conheciam seis formas, e
duas delas eram a mesma caixa arredondada: escolher "Trabalho" ou
escolher "Casa" dava o mesmo sólido pintado de outra cor. A forma, que
era para ser a identidade do ambiente, não identificava nada.

Agora são **doze sólidos, um por ícone**, e cada um se mexe do jeito que
combina com o que representa:

    camadas    três placas que se afastam e voltam, com luz entre elas
    maleta     corpo, banda de metal, fecho aceso e alça que balança
    livro      duas capas abrindo e fechando sobre a lombada
    coração    batida dupla, como a de verdade
    casa       o telhado respira, a chaminé sai do vão e a janela fica acesa
    carteira   o cartão desliza para fora e volta
    estrela    gira no próprio eixo, com uma joia acesa no meio
    lâmpada    o bulbo aceso sobre a rosca, tremeluzindo
    alvo       três anéis inquietos em volta do centro
    raio       casca na cor do ambiente e um núcleo que estala por dentro
    escudo     a cruz acesa nas duas faces
    grade      oito blocos respirando em volta de um núcleo

Os sólidos moram em um arquivo só, **`js/gfx/shapes.js`**, usado tanto
pela peça grande do topo da tela quanto pela peça pequena do cartão: são
o mesmo objeto, visto de perto ou de longe. A grade de ambientes passou a
ser reconhecível pela forma antes de o nome ser lido.

Três coisas mudaram junto, porque sem elas o trabalho não apareceria:

- **A peça parou de girar sem parar.** Uma maleta em rotação contínua
  passa metade do tempo de perfil, quando não dá para saber o que é. Ela
  agora balança em torno de uma pose de frente, vista de um pouco de
  cima — sempre reconhecível, e ainda assim nunca parada.
- **Os materiais ficaram três**: o corpo na cor do ambiente, o detalhe em
  metal claro e o núcleo aceso por dentro, que pisca no ritmo de cada
  peça — a lâmpada tremeluz, o raio estala, o coração acende na batida.
- **A prévia do formulário mostra a peça de verdade**, girando, e troca
  de sólido e de cor sem recriar contexto nenhum. Escolher o ícone
  passou a ser escolher o objeto, olhando para ele.

Nada disso custou mais contexto WebGL do que antes: o orçamento de
`core/device.js` continua mandando, e as peças da grade passaram a ser
montadas **uma por quadro**. Compilar um shader é trabalho síncrono, e
doze de uma vez travavam o quadro por tempo suficiente para se sentir ao
rolar — divididas, o custo total é o mesmo e a grade ainda ganha o efeito
de ir se acendendo peça por peça.

## 13. Concluir virou um gesto, não um sumiço

Marcar como feito é o clique mais repetido do app, e ele respondia com
dez partículas azuis — sempre azuis, inclusive: a cor do item era
calculada por uma expressão que devolvia o mesmo valor nos dois lados do
`?`. A linha ainda tinha uma animação de recuo, mas ela quase nunca
chegava a aparecer: a tela era redesenhada no mesmo instante e levava o
nó embora no meio do caminho.

O gesto agora tem começo, meio e fim, na linguagem do resto do site —
seco e luminoso, sem confete:

1. um **clarão curto** no ponto do clique;
2. o **selo**: um anel que se fecha e um visto que se desenha dentro
   dele, medido pelo alvo — serve para a caixinha de 18 px da linha e
   para o botão largo da tela de detalhes;
3. um **anel largo** que sai do ponto e se abre;
4. **faíscas com peso**, na cor real do item, que sobem, perdem força e
   caem;
5. a **linha** recebe uma varredura de luz, o título ganha o risco e o
   conjunto assenta em profundidade;
6. a **cena de fundo** ondula no ponto exato do clique e a **peça 3D do
   ambiente** reage: o núcleo acende, os satélites aceleram e uma onda de
   choque sai dela pelo piso;
7. o número de **concluídos** do ambiente pulsa, para a conta não subir
   escondida.

O redesenho da tela agora espera a animação — mas o dado muda na hora, e
a própria linha já mostra o novo estado antes de qualquer coisa. Quem
clica vê a resposta no mesmo quadro; o que espera é só a tela se
reorganizar em volta.

O mesmo gesto vale para os passos de uma checklist (numa medida menor) e
para o botão *Concluir* da tela de detalhes. Sem WebGL, a peça em CSS
também acende. Com movimento reduzido, nada disso acontece: o item é
marcado e pronto.

### Arquivos desta rodada

    js/gfx/shapes.js             os doze sólidos, em GLSL (novo)
    js/gfx/complete.js           o gesto de concluir (novo)
    js/gfx/envhero.js            peça do topo: sólidos novos, pose e pulso
    js/gfx/orb.js                peça do cartão: mesmos sólidos, troca ao vivo
    js/core/device.js            vaga emprestada de contexto para a prévia
    js/app/views/items.js        conclusão do item, do passo e dos detalhes
    js/app/views/today.js        placar de concluídos que pulsa
    js/app/views/environments.js prévia 3D no formulário, montagem em fila
    css/{animations,components,fx,views}.css   selo, faíscas, varredura, visto

---

# Terceira rodada

## 9. Carregamento ao navegar pela barra lateral

Trocar de seção monta uma tela inteira, e isso acontecia em silêncio.
Agora a marca aparece girando sobre a área de conteúdo enquanto a próxima
tela é montada, na mesma linguagem da abertura do site. Cobre só o
conteúdo, não a barra lateral nem o topo: quem clicou continua vendo onde
está e pode mudar de ideia no meio.

## 10. O retângulo em branco ao trocar de aba

A abertura da tela Hoje aparecia vazia, com ícone de imagem quebrada,
durante a troca para outra seção.

A causa era a ordem das operações. As peças 3D eram desmontadas **antes**
de o conteúdo ser trocado — mas a troca tem uma animação de saída de
quase 300 ms, na qual o nó continua na tela. O contexto WebGL era
destruído enquanto o canvas ainda estava visível, e canvas sem contexto
não desenha nada.

A limpeza passou a acontecer no instante exato em que o conteúdo antigo
sai do documento. Como o pedido foi garantir que não aconteça em item
nenhum, entraram mais duas defesas, nas três peças (marca, ambiente e
cartão):

- ao destruir uma peça, o canvas sai de cena junto — mesmo que o nó demore
  a ser removido, não sobra retângulo claro no lugar;
- `webglcontextlost` passou a ser tratado: o navegador pode tomar o
  contexto de volta a qualquer momento (troca de GPU, aba parada, memória
  apertada), e agora isso faz o plano B em CSS entrar no lugar.

Verificado com um vigia que percorre todas as telas a cada quadro
procurando canvas oculto e ainda anexado ao documento: **zero
ocorrências**, tanto navegando por URL quanto clicando na barra lateral.

## 11. Conta que vale em qualquer aparelho

O motivo de não dar para entrar no celular ficou claro: o site está no
**GitHub Pages**, que entrega arquivos e nada mais. A pasta `api/` nunca
rodou ali — e sem ela não existe onde guardar conta.

O caminho escolhido foi publicar na Vercel. Está tudo em
**`docs/PUBLICAR.md`**: passo a passo, as duas variáveis de ambiente, uma
tabela que traduz cada resposta de `/api/health` no que fazer, e o aviso
de que contas criadas no Pages não migram.

Antes de recomendar isso, o backend foi exercitado de verdade — um
PostgreSQL 16 local, o esquema do repositório aplicado nele e as próprias
funções de `api/` servidas como a Vercel serviria. Duas correções saíram
desse exercício:

- **o cookie de sessão era `SameSite=None`**, que é o modo que os
  navegadores de celular mais restringem. No iOS, com a prevenção de
  rastreamento que vem ligada, ele pode não ser guardado — a pessoa entra,
  recarrega e está deslogada. Passou a ser `Lax`, que é mais seguro e
  sobrevive a essas proteções;
- **banco fora do ar virava um 500** e o app tratava como "não há API",
  deixando um "somente neste dispositivo" sem explicação. Agora
  `/api/health` se identifica e diz o que falta, e a tela de entrar
  repassa o motivo.

A tela de acesso também passou a dizer, **antes da senha**, onde a conta
vai morar. Descobrir que ela é só daquele navegador depois de tentar
entrar no celular é a pior hora possível.

### Arquivos desta rodada

    api/_lib/http.js           cookie SameSite conforme a origem
    api/health.js              diagnóstico em vez de 500 mudo
    js/app/api.js              distingue "sem API" de "banco fora"
    js/gfx/interactions.js     carregamento da seção, limpeza no swap
    js/gfx/{envhero,orb,logo3d}.js   canvas nunca fica morto na tela
    js/main.js                 ordem da limpeza, aviso na tela de acesso
    css/fx.css, css/views.css  véu de carregamento, aviso de acesso
    docs/PUBLICAR.md           como publicar (novo)
    .gitignore                 faltava (novo)

---

# Segunda rodada

## 6. Load em todos os cliques, do tamanho do alvo

O retorno de carregamento pegava cinco seletores e desenhava sempre o mesmo
anel de 15 px — grande demais num ponto de cor, pequeno demais num cartão.

Agora ele cobre tudo o que responde a clique (itens, cartões, avatar, itens
de menu, linhas da busca, pontos de cor, ícones, links) e nasce **medido pelo
elemento**: o anel cresce junto com o alvo, dentro de um piso e um teto, a
espessura acompanha, e faixas largas e baixas — uma linha de item, um item de
menu — recebem o anel encostado à direita em vez de em cima do texto. A
duração mínima também escala: cerca de 280 ms num alvo pequeno e 460 ms num
cartão grande.

A caixa de conclusão continua de fora, junto de qualquer `data-noload`.
Marcar um item precisa ser instantâneo — um indicador ali só atrasaria a
sensação de ter concluído.

## 7. O fundo, agora visível

A mudança da primeira rodada existia, mas ninguém via: dentro do app a cena
estava com opacidade `.22` — e é justamente ali que se passa o dia inteiro.

Baixar a opacidade do canvas apagava tudo junto, então o problema foi
separado em duas camadas. As **placas** — que são o que compete com o texto —
recuam por dentro do próprio shader quando a tela é do app; a **aurora**, os
**cometas** e o **horizonte** continuam inteiros. O canvas voltou a quase
opacidade total.

E entraram os cometas: riscos de luz com cabeça e cauda atravessando o quadro
em ciclos longos, cada um sorteando trajetória nova a cada volta. A aurora
ganhou quase o dobro de brilho.

## 8. A marca do Nestra na tela Hoje

A tela abre com a logo extrudada em três dimensões — o arquivo original
convertido em campo de distância e traçado por ray marching, de modo que a
silhueta em 3D é exatamente a silhueta do desenho, com relevo, chanfro e
brilho de borda. Ela acompanha o ponteiro e gira devagar sozinha, entre três
anéis em órbita, um halo respirando e um chão de luz.

Ao lado, o retrato do dia: a saudação, o dia por extenso, uma frase que diz o
que falta em vez de repetir os números, e os contadores com o anel de
progresso.

A marca sobrevive aos redesenhos: concluir um item redesenha a tela Hoje
inteira, e reconstruir a marca junto faria ela piscar a cada clique.

### Arquivos desta rodada

    css/fx.css                 abertura da tela Hoje, load proporcional
    css/layout.css             opacidade da cena por tela
    js/gfx/scene.js            cometas, aurora mais forte, placas por tela
    js/gfx/interactions.js     indicador medido pelo alvo
    js/gfx/logo3d.js           plano B sob demanda
    js/app/views/today.js      abertura da tela Hoje
    js/main.js                 ciclo de vida da marca, humor da cena

---

# Primeira rodada

## 1. A mesma conta no computador e no celular

**O que estava acontecendo.** O endereço da API vinha só da `<meta
name="nestra-api">` do `index.html`, que estava vazia. Sem endereço,
`api.online` ficava falso e o app entrava em modo local: cada navegador
guardava a conta e os itens no próprio `localStorage`. Entrar com o mesmo
e-mail no celular abria um espaço vazio — não porque a conta não existia,
mas porque ela nunca tinha saído do outro aparelho.

O backend em `api/` já estava pronto e correto (sessão por cookie, senha com
scrypt, isolamento por linha no Postgres, ids gerados no cliente com
`on conflict do nothing`). Ninguém estava conversando com ele.

**O que passou a acontecer.** Sem endereço configurado, o app procura `/api`
na própria origem — que é exatamente onde as funções ficam quando o site é
publicado junto delas. O teste de vida ficou mais exigente: a resposta
precisa se identificar como `nestra-api`, porque hospedagem estática costuma
devolver o `index.html` para qualquer caminho, e o app acharia que tem banco
quando só tem HTML.

E o estado deixou de ser só de ida. Existe agora uma busca periódica que
**sobe a fila pendente antes de baixar o que o servidor tem** — nessa ordem,
porque baixar primeiro apagaria da tela uma alteração ainda não enviada. Ela
dispara ao voltar para a aba, ao recuperar a conexão e a cada 45 segundos.

O redesenho espera a pessoa parar de digitar e os formulários fecharem.
Perder uma frase pela metade seria justamente o contrário do que o produto
promete.

> **Atenção a um caso.** Contas criadas *antes* de a API existir vivem apenas
> no navegador onde nasceram — o servidor não as conhece. O app detecta isso
> e explica em Configurações → Seus aparelhos. Para essas contas o caminho é
> exportar os dados e criar a conta de novo. Contas novas já nascem
> sincronizadas.

## 2. Peça 3D na abertura de cada ambiente

Um sólido traçado por ray marching, flutuando sobre um piso com grade,
reflexo e sombra de contato, com satélites em órbita em volta. A forma vem do
ícone do ambiente e a cor, da cor dele — entrar em "Trabalho" e entrar em
"Estudos" são experiências visuais diferentes sem ninguém configurar nada.

O ponteiro gira a peça e desloca a câmera junto; no toque, o arrasto gira.
A peça sobrevive aos redesenhos da tela: reconstruí-la a cada clique jogaria
fora um contexto WebGL de cada vez, e o navegador tem um teto baixo deles.

## 3. Fundo mais dinâmico

A aurora ganhou deformação de domínio — o campo se dobra sobre si mesmo antes
de ser lido, então a luz enrola e desenrola em vez de só deslizar. Somaram-se
feixes verticais atravessando devagar, deriva de cor ao longo do minuto e um
horizonte respirando na base. A câmera passeia sozinha, a rolagem entra como
paralaxe e, onde não existe cursor, a cena se move por conta própria.

## 4. Abertura animada com a marca

Anéis em órbita ao redor da logo, arco de progresso contornando a marca,
partículas atraídas para o centro e a palavra chegando letra a letra. A mesma
linguagem, em tamanho de bolso, aparece nas trocas de tela.

## 5. Porte para celular

Um perfil de aparelho e um vigia de quadros por segundo. Quando a taxa cai, a
qualidade desce um degrau — menos pixels, menos peças, menos passos de ray
marching — e sobe de volta quando sobra fôlego. A decoração nunca some, só
muda de resolução.

Além disso:

- contextos WebGL saem de um orçamento compartilhado; o que não couber usa o
  plano B em CSS 3D, que continua girando;
- peças fora da tela param de desenhar (é o que segura a rolagem no celular);
- o canvas só é medido quando muda de tamanho — medir dentro do laço obrigava
  o navegador a refazer o layout a cada quadro, para cada peça;
- o grão do fundo para de animar em tela pequena;
- a cena se ancora na altura grande da janela, porque a barra do iOS que
  aparece e some ao rolar deixava uma faixa vazia embaixo;
- controles ganharam área segura e toque sem o atraso de 300 ms.

## De quebra

As preferências salvas voltaram a ser aplicadas depois de restaurar a sessão.
Antes, a cor de destaque, a densidade e a preferência de movimento só
apareciam se a pessoa abrisse as configurações.

---

## Arquivos alterados

Novos:

    js/core/device.js     perfil do aparelho, governo de qualidade, orçamento WebGL
    js/gfx/envhero.js     a peça 3D do topo do ambiente

Modificados:

    index.html                 marcação da abertura
    sw.js                      versão do cache + arquivos novos na casca
    css/base.css               toque, grão do fundo no celular
    css/fx.css                 abertura do ambiente, plano B em CSS
    css/layout.css             área segura, altura da cena, degrau baixo
    css/loader.css             anéis, arco, partículas, wordmark, marca girando
    js/main.js                 sincronização, abertura, ciclo de vida das peças
    js/app/api.js              descoberta da API na mesma origem
    js/app/store.js            busca periódica, cópia local, fila
    js/app/ui.js               dois ícones novos
    js/app/views/today.js      abertura 3D da tela de ambiente
    js/app/views/settings.js   painel "Seus aparelhos"
    js/gfx/scene.js            aurora, deriva de câmera, qualidade adaptativa
    js/gfx/orb.js              orçamento de contexto, desenho só à vista
    js/gfx/logo3d.js           teto de resolução
    js/gfx/interactions.js     marca girando nas trocas de tela

---

## Para publicar

O site é estático e as funções ficam em `api/`. Publicando os dois juntos
(Vercel, por exemplo), a sincronização liga sozinha — não é preciso preencher
a `<meta name="nestra-api">`.

O servidor precisa de duas variáveis de ambiente:

    DATABASE_URL       string de conexão do Neon
    NESTRA_IP_SALT     um texto qualquer, secreto e estável

E o esquema aplicado uma vez: `npm run db:schema`.

Publicando só a parte estática, sem as funções, o app continua funcionando —
em modo local, com os dados guardados apenas naquele navegador.
