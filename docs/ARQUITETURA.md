# Arquitetura do Nestra

Documento técnico curto: o que roda onde, e por quê.

## Separação de camadas

Seguindo a seção 14 do documento de produto:

| Camada | Responsabilidade |
|---|---|
| Frontend | Interface, captura, navegação, estado visual, experiência responsiva |
| API / backend | Autenticação, autorização, validação e regras de negócio |
| Neon / PostgreSQL | Persistência de usuários, ambientes, itens e checklists |
| Serviço de interpretação | Conversão de linguagem natural em campos estruturados |
| Navegador | Notificações locais e cache de interface |

Hoje a interpretação de linguagem natural roda **no navegador**
(`js/app/nlp.js`), com regras determinísticas. A seção 10 marca a interpretação
avançada por IA como posterior — a estrutura já guarda `raw_input`,
`parse_confidence` e `needs_review` para que um modelo entre depois sem
migração.

## Por que HTML, CSS e JS puros

O documento sugeria React, mas a exigência do projeto foi HTML/CSS/JS. Isso não
custou nada em capacidade e trouxe três vantagens concretas:

1. **Sem passo de build.** O repositório é o site. GitHub Pages serve direto.
2. **Sem dependência de CDN.** O PWA funciona offline de verdade: fontes,
   shaders e módulos são todos locais.
3. **Controle total do 3D.** A engine WebGL tem ~600 linhas e faz exatamente o
   que este projeto precisa, em vez de carregar uma biblioteca inteira.

Os módulos ES nativos dão a organização que um bundler daria.

## A marca em 3D

O caminho comum seria converter a logo para SVG e extrudar o caminho vetorial.
Isso foi descartado a pedido: vetorizar redesenha a marca e muda os cantos.

O que o Nestra faz:

1. Lê o PNG e recorta a caixa útil (`trimAlpha`).
2. Calcula a **transformada de distância euclidiana exata** do canal alfa
   (algoritmo de Felzenszwalb & Huttenlocher, `edt2d` em `js/core/gl.js`),
   dentro e fora, gerando um campo de distância com sinal.
3. Sobe esse campo para uma textura `R16F` e a imagem original para uma `RGBA8`.
4. No fragment shader, faz **ray marching** de uma extrusão com chanfro:

   ```glsl
   float d2 = sdf2d(p.xy) + bevel;
   vec2  w  = vec2(d2, abs(p.z) - (depth - bevel));
   float d  = min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - bevel;
   ```

5. Sombreia com luz principal, preenchimento, contraluz, fresnel, oclusão de
   ambiente e sombra suave. A cor base vem da textura da própria logo,
   linearizada antes da iluminação.

Resultado: a silhueta 3D é exatamente a silhueta dos pixels do arquivo — furos e
contra-formas inclusive — e trocar a logo é trocar um PNG.

Sem WebGL2, `Logo3D._fallback()` empilha 16 cópias da mesma imagem com
`translateZ`. Continua sendo a logo original.

## Estado e sincronização

`js/app/store.js` é a fonte da verdade no cliente:

- **Modo local** (sem API): conta e dados no `localStorage`, senha com PBKDF2
  de 150 mil iterações via `SubtleCrypto`. Serve para o GitHub Pages puro e para
  testar sem infraestrutura.
- **Modo remoto** (com API): toda mutação entra numa fila separada por conta
  (`js/app/api.js` → `syncQueue`) e é reenviada quando a conexão volta. Falhas
  definitivas não somem: ficam preservadas e visíveis em Configurações, com
  ação para tentar novamente. Isso impede que a interface diga
  “sincronizado” depois de o servidor recusar um cadastro.

Os `id` são gerados no cliente com `crypto.randomUUID()` e os endpoints usam
`on conflict (id) do nothing`. Assim um reenvio da fila é idempotente.

## Autorização em duas camadas

A seção 19 é explícita: *"o frontend pode esconder botões, mas a proteção real
precisa existir na API e no banco"*. Então:

1. **API** — todo endpoint chama `requireUser()` e filtra por `owner_id`.
2. **Banco** — RLS ativada e forçada em 16 tabelas. A API abre a transação com
   `select set_config('app.user_id', $1, true)` e as políticas comparam com
   `nestra_current_user_id()`. A autenticação usa ainda
   `app.session_hash`: a política expõe somente a sessão cujo hash veio do
   cookie, antes mesmo de o usuário ser conhecido.

Uma consulta sem `WHERE owner_id` continua não devolvendo dados de outra conta.

## Notificações

Duas vias:

- **Local**: `scheduleNotifications()` roda a cada minuto e dispara quando há
  razão temporal clara — compromisso próximo, item vencendo hoje ou atrasado.
  Nunca notifica só porque um item foi criado (seção 9).
- **Servidor** (estrutura pronta): `push_subscriptions` guarda os endpoints e o
  service worker já trata `push` e `notificationclick`. Falta o serviço que
  dispara.

## Decisões que valem registrar

- **"Atrasado" não é um estado.** É calculado a partir de `due_date`, como pede
  a seção 8. A view `v_items_enriched` expõe `is_overdue`.
- **Exclusão passa pela lixeira.** `deleted_at` + `purge_after` de 30 dias.
  Concluir e adiar são rápidos e reversíveis; excluir pede confirmação.
- **Frase vaga não vira data.** "fazer isso depois" é reconhecido e bloqueia a
  inferência — a lista `VAGUE` em `nlp.js` existe só para isso.
- **Ambiente padrão é a caixa de entrada.** Assim uma captura sem contexto não
  cai em "Trabalho" por acidente.
- **A frase original é sempre preservada** em `raw_input`, mesmo quando o título
  limpo fica diferente.
