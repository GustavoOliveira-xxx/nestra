# Nestra

**Seu espaço para o que importa.**

Organizador pessoal escuro, rápido e centrado no presente. Você escreve uma frase
natural — *"lavar o tênis no sábado"*, *"reunião com o professor às 19h"* — e o
Nestra descobre o tipo, a data, o período do dia, a prioridade e o ambiente.

Feito em **HTML, CSS e JavaScript puros**, sem framework e sem build. O banco é
**PostgreSQL no Neon**, acessado por uma camada de funções serverless — o
navegador nunca vê a credencial do banco.

---

## O que já está pronto

| Área | Situação |
|---|---|
| Captura rápida com interpretação de linguagem natural (pt-BR) | ✅ |
| Tela **Hoje** com atrasados, período do dia, alta prioridade e capturas recentes | ✅ |
| Ambientes com cor, ícone, descrição, estatísticas e arquivamento | ✅ |
| Quatro tipos de item: tarefa, lembrete, compromisso e ideia | ✅ |
| Detalhes do item: descrição, checklist, histórico, mover, adiar | ✅ |
| Lixeira com 30 dias antes da exclusão definitiva | ✅ |
| Preferências: densidade, movimento, contraste, cantos, brilho, fuso | ✅ |
| Notificações do navegador com razão temporal clara | ✅ |
| Exportação em JSON e CSV, exclusão de conta | ✅ |
| PWA instalável no celular (manifest + service worker + offline) | ✅ |
| Marca em 3D extrudada do próprio PNG, via WebGL | ✅ |
| Cena de fundo animada, paleta de comandos, atalhos de teclado | ✅ |
| Banco no Neon: 20 tabelas, 2 views, triggers e RLS por usuário | ✅ |
| API serverless para auth, ambientes, itens, checklists e preferências | ✅ |

---

## Como rodar

Qualquer servidor estático serve. Não há passo de build.

```bash
npx http-server -p 8080 -c-1 .
# abra http://localhost:8080
```

> Abrir o `index.html` direto pelo `file://` **não funciona**: os módulos ES e o
> service worker exigem `http://` ou `https://`.

Sem API publicada, o Nestra roda em **modo local**: a conta e os dados ficam
apenas no navegador (senha protegida com PBKDF2, 150 mil iterações). A barra
lateral mostra `somente neste dispositivo` para deixar isso explícito.

---

## Trocar a logo

**Pelo app, sem tocar em arquivo:** Configurações → Aparência → Marca. Arraste
a imagem ali. O efeito 3D passa a usar ela na hora, e ela fica guardada só no
seu navegador.

**Fixa no repositório:** salve como `assets/logo/nestra-mark.png`. Também
valem, nesta ordem, `nestra-mark.jpg`, `.jpeg`, `.webp`, `logo.png` e
`logo.jpg` — o primeiro que existir é o usado.

### Como o 3D é feito

A marca **não é redesenhada nem vetorizada**. O arquivo é lido pixel a pixel:

1. Se vier sem transparência, o fundo externo é removido por preenchimento a
   partir das bordas — os brancos internos (tipografia, estrelas, brilhos)
   ficam intactos, porque não encostam na moldura.
2. O canal alfa vira um **campo de distância com sinal** (transformada
   euclidiana exata de Felzenszwalb).
3. Esse campo é **extrudado por ray marching**, com chanfro, aro de luz,
   oclusão de ambiente e sombra suave.
4. As cores continuam sendo as da imagem — linearizadas antes da iluminação. A
   luz só dá volume; a única superfície inventada é a lateral da extrusão.

Funciona com qualquer forma: monograma, emblema circular, contra-formas, furos.
Sem WebGL2, um plano B em CSS empilha cópias da **mesma imagem** em
profundidade — continua sendo a sua logo.

> O arquivo que está no repositório hoje é um **monograma provisório**, feito só
> para o sistema ter o que mostrar. Ele não é a marca definitiva.

---

## Banco de dados (Neon)

O esquema completo está em [`db/schema.sql`](db/schema.sql) e **já foi aplicado**
no projeto `Nestra` (`snowy-unit-70318147`).

```
users                     environments            items
sessions                  environment_members     checklist_items
password_resets           share_invites           tags / item_tags
login_attempts            user_preferences        item_recurrences
user_consents             notification_preferences item_relations
account_events            push_subscriptions      item_events
export_requests
```

Mais duas views — `v_items_enriched` (com atraso calculado) e
`v_environment_stats` — além de triggers para `updated_at`, histórico automático
do item, coerência de `completed_at` e ambiente padrão único.

Para reaplicar em outro projeto:

```bash
npm install
DATABASE_URL='postgresql://…' npm run db:schema
```

### Isolamento por usuário

Toda tabela ligada a uma conta tem **RLS ativada e forçada**. As políticas usam
`nestra_current_user_id()`, que lê `app.user_id` — definido pela API dentro da
transação:

```js
await sql.transaction([
  sql`select set_config('app.user_id', ${userId}, true)`,
  sql`select * from items`,   // devolve só os itens desse usuário
]);
```

Mesmo que uma consulta esqueça o `WHERE owner_id`, o banco não entrega linhas de
outra conta.

---

## Publicar

### Frontend no GitHub Pages

O repositório já funciona como site estático. Em **Settings → Pages**, aponte
para a branch e a pasta raiz. O arquivo `.nojekyll` garante que a pasta `assets`
seja servida.

### API na Vercel

```bash
vercel deploy
```

Variáveis de ambiente necessárias:

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | string de conexão do Neon |
| `NESTRA_ALLOWED_ORIGINS` | origens liberadas no CORS, separadas por vírgula |
| `NESTRA_IP_SALT` | sal para os hashes de IP e e-mail |

Depois, no Nestra, vá em **Configurações → Dados e privacidade → Endereço da
API** e informe `https://sua-api.vercel.app/api`. A barra lateral passa a
mostrar `sincronizado`.

---

## Estrutura

```
index.html              casca do app e página de apresentação
manifest.json           instalação no celular
sw.js                   cache offline e notificações

css/
  tokens.css            cores, tipografia, espaçamento, movimento
  base.css              reset, fontes, foco, rolagem
  animations.css        keyframes e utilidades de movimento
  loader.css            sequência de abertura
  layout.css            barra superior, lateral e responsivo
  components.css        botões, campos, painéis, modais, avisos
  views.css             apresentação, acesso, hoje, ambientes, detalhes

js/
  core/gl.js            WebGL, matrizes, campo de distância (EDT exata)
  gfx/logo3d.js         a marca extrudada por ray marching
  gfx/scene.js          campo de placas 3D instanciadas ao fundo
  gfx/fx.js             inclinação, botão magnético, revelação, contadores
  app/nlp.js            interpretação de frases em português
  app/store.js          estado, persistência local e fila de sincronização
  app/api.js            cliente HTTP e fila offline
  app/ui.js             ícones, avisos, modais, menus
  app/views/            captura, itens, hoje, ambientes, configurações
  main.js               abertura, tema, rotas, atalhos, PWA

api/                    funções serverless (auth, itens, ambientes, prefs)
db/schema.sql           esquema completo do PostgreSQL
docs/                   arquitetura, privacidade e termos
```

---

## Atalhos

| Tecla | Ação |
|---|---|
| `C` | capturar alguma coisa |
| `/` ou `Ctrl/⌘ K` | buscar e comandos |
| `H` | ir para Hoje |
| `A` | ir para Ambientes |
| `,` | configurações |
| `Enter` | abrir o item em foco |
| `Espaço` | concluir o item em foco |
| `?` | lista de atalhos |

---

## Acessibilidade

Contraste legível no tema escuro, cor nunca como único sinal (atraso e
prioridade também têm texto e forma), navegação por teclado em toda a interface,
foco visível, nomes acessíveis nos controles, alvos de toque adequados e respeito
a `prefers-reduced-motion` — com um modo de movimento reduzido e um de alto
contraste nas preferências.

---

## O que ainda não entrou

Seguindo o item 11 do documento — *o que não colocar no início*:

- calendário completo e visualizações múltiplas
- colaboração entre contas (as tabelas existem, o fluxo não)
- recorrência sofisticada (a tabela existe, o motor não)
- gamificação, hábitos e relatórios de produtividade
- confirmação de e-mail e recuperação de senha por e-mail
  (as tabelas existem; falta o serviço de envio)
