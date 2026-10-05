# Arquitetura

| Camada | Onde | Responsabilidade |
|---|---|---|
| Interface | `index.html`, `css/`, `js/` | Telas, captura, mapa de reuniões, estado local |
| API | `api/` (funções Vercel) | Sessão, validação, regras de negócio, copiloto com IA |
| Banco | Neon / PostgreSQL (`db/schema.sql`) | Persistência, isolamento por linha (RLS) |
| Navegador | `sw.js`, `localStorage` | Offline, fila de sincronização, notificações |

Sem passo de build: HTML, CSS e módulos ES servidos como estão.

## Estado e sincronização

`js/app/store.js` é a fonte da verdade no cliente.

- **Modo local** (sem API): conta e dados no `localStorage`, senha com PBKDF2.
- **Modo remoto**: cada alteração entra numa fila por conta (`js/app/api.js`) e
  sobe quando há conexão. Os ids nascem no cliente (`crypto.randomUUID()`) e o
  servidor usa upsert, então reenviar é seguro. Gravações repetidas do mesmo
  objeto (o mapa de uma reunião, por exemplo) são agrupadas na fila e mantêm a
  posição original, para nada passar à frente daquilo de que depende.
- A cada 15 s, ao voltar para a aba ou ao recuperar a rede, a fila sobe e o
  estado do servidor desce (`/api/auth/me`).

## Autorização

1. Toda rota chama `requireUser()` e filtra por dono.
2. O banco força RLS em todas as tabelas de conteúdo. A API abre a transação
   com `set_config('app.user_id', ...)` e as políticas comparam com
   `nestra_current_user_id()`.

## Reuniões

| Tabela | Conteúdo |
|---|---|
| `meetings` | Reunião recorrente: dias da semana, horário, duração, formato, ambiente ligado |
| `meeting_agendas` | Pauta de um dia: `nodes` (jsonb com o mapa), ata, início e fim |

Cada nó do mapa tem `id`, `parentId`, `kind` (andamento, próximo passo,
bloqueio, pergunta, decisão, aviso, ideia, assunto), `text`, `done`, `note`,
`task` e `taskId` (item do Nestra ligado). O servidor sanitiza a lista em
`api/meetings.js` (`cleanNodes`).

Fluxo na tela (`js/app/views/meetings.js`):

1. **Preparar**: texto livre ou ditado vira tópicos; sugestões trazem o que
   ficou de fora da última ocorrência, itens do ambiente que vencem e o que foi
   concluído desde a última vez.
2. **Na reunião**: cronômetro, próximo assunto em destaque, toque para marcar
   como falado, toque longo para anotar.
3. **Ata**: resumo, revisão dos assuntos, próximos passos viram tarefas e o que
   ficou pode ser levado para a próxima ocorrência.

No celular o mapa vira uma árvore vertical; no desktop é radial e os balões
podem ser arrastados.

## Copiloto

`js/app/copilot.js` tem duas fontes com a mesma saída:

- `POST /api/assistant` chama o Claude com saída em JSON Schema quando
  `ANTHROPIC_API_KEY` existe. Limite de 80 pedidos por hora por conta.
- Regras locais em português (classificação por palavras-chave, remoção de
  "preciso falar sobre", pessoas citadas, listas viram subtópicos).

Se o servidor falhar ou não estiver configurado, a tela usa o local sem
interromper o fluxo. O selo "IA conectada" ou "Assistente local" mostra qual
respondeu.

## Testes

`npm run check` roda a checagem de sintaxe, a rota de saúde sem banco e
`scripts/testes.js` (ditado, leitor de frases, conversão de datas do driver,
fila de sincronização, copiloto e sanitização do mapa).
