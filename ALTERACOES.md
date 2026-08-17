# Nestra — o que mudou nesta atualização

Este pacote é o projeto inteiro, já com as alterações aplicadas. Para usar,
substitua a pasta do projeto pelo conteúdo daqui (ou extraia por cima dela).

Se você preferir manter o histórico do Git, use o `nestra-atualizacoes.patch`
que está junto: `git am nestra-atualizacoes.patch` cria os dois commits, com
mensagem e autoria, sem sobrescrever nada à mão.

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
