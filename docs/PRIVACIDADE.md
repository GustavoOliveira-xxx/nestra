# Política de Privacidade — Nestra

> **Rascunho técnico.** Este texto descreve o que o sistema realmente faz hoje e
> serve de base para a política definitiva. Antes de publicar como documento
> legal, revise com apoio jurídico — especialmente os trechos sobre base legal,
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
| Eventos técnicos da conta | Criação, login, exportação — sem conteúdo de tarefa |

**Nunca pedimos** cargo, empresa, telefone, localização exata ou qualquer
informação que não seja necessária para organizar suas tarefas.

## 3. O que NÃO fazemos

- Não vendemos nem compartilhamos seus dados com terceiros.
- Não usamos seu conteúdo para treinar modelos.
- Não colocamos rastreadores de publicidade nem análise comportamental.
- Não exibimos o conteúdo das suas tarefas em logs, mensagens de erro ou
  ferramentas de diagnóstico.

Esse último ponto é uma decisão de projeto: o conteúdo de uma tarefa pode ser
sensível — trabalho, saúde, finanças, informações de terceiros.

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
`Secure` e `SameSite=None`, e expira em 30 dias. Não há cookies de publicidade
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
são disparadas quando existe uma razão temporal clara — um compromisso próximo,
um item vencendo hoje ou um item atrasado. O Nestra não notifica a cada tarefa
criada.

## 9. Retenção

- Itens excluídos ficam na lixeira por **30 dias** antes da remoção definitiva.
- Sessões expiram em **30 dias** ou quando você sai.
- Registros de tentativa de login são usados apenas para limitação de taxa.

## 10. Alterações nesta política

Mudanças relevantes serão comunicadas dentro do próprio aplicativo antes de
entrar em vigor.
