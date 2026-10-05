# Política de Privacidade do Nestra

> **Rascunho técnico.** Este texto descreve o que o sistema realmente faz hoje e
> serve de base para a política definitiva. Antes de publicar como documento
> legal, revise com apoio jurídico, especialmente os trechos sobre base legal,
> prazos de retenção e contato do controlador, que dependem de decisões suas.

**Última atualização:** conforme a data do commit deste arquivo.

## 1. Quem somos

O Nestra é um organizador pessoal. Ele guarda tarefas, lembretes, compromissos e
ideias que você registra, organizados em ambientes que você mesmo cria.

## 2. Que dados coletamos

Apenas o necessário para o produto funcionar.

| Dado | Por que existe |
|---|---|
| Nome de exibição | Para o sistema te chamar pelo nome |
| E-mail | Identificar a conta e permitir recuperar o acesso |
| Senha | Guardada apenas como hash (scrypt no servidor, PBKDF2 no modo local) |
| Fuso horário e idioma | Resolver "hoje", "amanhã" e "sábado" corretamente |
| Ambientes e itens | É o conteúdo que você registra |
| Preferências | Densidade, tema, movimento, contraste e afins |
| Hash do IP nas tentativas de login | Limitar ataques de força bruta |
| Eventos técnicos da conta | Criação, login, exportação, uso do copiloto; nunca o conteúdo |
| Reuniões e pautas | Agenda fixa, mapa de cada reunião, anotações e ata |

**Nunca pedimos** cargo, empresa, telefone, localização exata ou qualquer
informação que não seja necessária para organizar suas tarefas.

## 3. O que NÃO fazemos

- Não vendemos seus dados. Eles só passam pelos serviços que fazem o Nestra
  funcionar: Vercel (servidor), Neon (banco) e, se a IA estiver ligada,
  Anthropic (copiloto de reuniões).
- Não usamos seu conteúdo para treinar modelos.
- Não colocamos rastreadores de publicidade nem análise comportamental.
- Não exibimos o conteúdo das suas tarefas em logs, mensagens de erro ou
  ferramentas de diagnóstico.

Esse último ponto é uma decisão de projeto: o conteúdo de uma tarefa pode ser
sensível (trabalho, saúde, finanças, informações de terceiros).

## 4. Onde os dados ficam

Depende do modo:

- **Modo local** (sem API configurada): tudo fica no `localStorage` do seu
  navegador. Nada sai do dispositivo. Limpar os dados do navegador apaga tudo.
- **Modo sincronizado**: os dados ficam em um banco PostgreSQL hospedado no
  **Neon**, na região configurada pelo responsável pela instalação. A conexão é
  sempre por canal seguro.

## 5. Isolamento entre contas

Cada conta enxerga somente os próprios dados. Isso é garantido em duas camadas:

1. A API verifica a sessão e filtra toda consulta pelo usuário autenticado.
2. O banco aplica *row level security*: mesmo uma consulta malformada não
   devolve linhas de outra conta.

## 6. Cookies

Um único cookie, `nestra_session`, com o token da sessão. Ele é `HttpOnly`,
`Secure` e `SameSite=Lax`, e expira em 30 dias. Não há cookies de publicidade
ou de análise.

## 7. Seus direitos

Em **Configurações → Dados e privacidade** você pode, a qualquer momento:

- **Consultar** tudo o que está guardado;
- **Exportar** em JSON (estrutura completa) ou CSV (para planilha);
- **Apagar** os dados locais deste dispositivo;
- **Excluir a conta** inteira, com confirmação explícita.

Como o produto pode operar no Brasil, a implementação deve ser revisada para
atender à LGPD (Lei 13.709/2018), incluindo a definição formal de base legal,
prazo de retenção e canal de atendimento ao titular.

## 8. Notificações

As notificações do navegador só funcionam se você permitir explicitamente. Elas
são disparadas quando existe uma razão temporal clara: uma reunião ou compromisso próximo,
um item vencendo hoje ou um item atrasado. O Nestra não notifica a cada tarefa
criada.

## 9. Copiloto de reuniões

O copiloto organiza o texto que você escreve para uma reunião e redige a ata.
Ele funciona de dois jeitos, sempre indicados na tela:

- **Assistente local**: o texto é processado no seu navegador e não sai dele.
- **IA conectada**: quando o responsável pela instalação configura uma chave da
  Anthropic, o texto daquela pauta é enviado pelo servidor do Nestra à API do
  Claude para ser organizado. Só vai o necessário para o pedido (o que você
  escreveu, o nome da reunião, os títulos de assuntos pendentes e de itens
  ligados). Pelos termos comerciais da Anthropic, esse conteúdo não é usado
  para treinar modelos.

Cada conta tem um limite de pedidos por hora ao copiloto.

## 10. Retenção

- Itens excluídos ficam na lixeira por **30 dias** antes da remoção definitiva.
- Sessões expiram em **30 dias** ou quando você sai.
- Registros de tentativa de login são usados apenas para limitação de taxa.

## 11. Alterações nesta política

Mudanças relevantes serão comunicadas dentro do próprio aplicativo antes de
entrar em vigor.
