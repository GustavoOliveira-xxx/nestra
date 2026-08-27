# Auditoria funcional e técnica — Nestra v1.0.1

Data: 27 de agosto de 2026

## Resultado executivo

A jornada principal foi exercitada na versão pública e novamente na versão
corrigida. Os defeitos reproduzidos foram tratados no frontend, na fila de
sincronização, na API e nas políticas do PostgreSQL.

Existe uma condição operacional indispensável: o endereço atual do GitHub
Pages não executa `api/` e responde 404 em `/api/health`. Nesse endereço o
Nestra é deliberadamente local e não consegue compartilhar cadastros entre
celular e computador. Para sincronização real, publique site e funções na
mesma origem (Vercel) e aplique `db/schema.sql` no Neon, conforme
`docs/PUBLICAR.md`.

## Jornada verificada

| Etapa | Resultado esperado | Resultado da revisão |
|---|---|---|
| Abrir a URL pública | Explicar onde os dados serão guardados | O app avisa quando está somente no dispositivo; `/api/health` do Pages foi confirmado como 404 |
| Criar conta | Entrar com três ambientes sugeridos, todos editáveis | Verificado; sugestões não viram ambiente padrão sem escolha do usuário |
| Abrir Ambientes | Cartões inteiros abrem e o lápis edita | Corrigida a sobreposição de clique e removido o controle interativo aninhado |
| Abrir um ambiente | “Editar ambiente” e “Todos os ambientes” funcionam sempre | Callbacks do cabeçalho reaproveitado agora são atualizados; ambos testados |
| Capturar linguagem natural | Guardar uma ação curta e campos estruturados | Frase informada virou “Configurar o Macbook na casa da minha vó”, domingo, 21:00, Pessoal |
| Abrir cadastro | Exibir e permitir editar todos os campos | Tipo, prioridade, ambiente, data, horário, período, descrição, checklist, histórico e frase original verificados |
| Salvar cadastro | Aplicar o formulário inteiro em uma ação | Salvar é explícito e atômico no cliente; Cancelar descarta campos e checklist em rascunho |
| Usar no celular | Nenhum campo ou botão fora da tela | Corrigido estouro horizontal e verificado em 390 × 844 |
| Recarregar | Ambientes, item e alterações continuam | Verificado no modo local; fila remota e conversões de data cobertas por regressão |
| Trocar de conta | Não mostrar identidade ou estado da conta anterior | Cache visual da estrutura, avatar e saudação são reiniciados por usuário |

## Problemas corrigidos

### Funcionais e regras de negócio

- Ambiente sugerido não é escolhido automaticamente como padrão; sem contexto,
  a captura fica na Caixa de entrada.
- Arquivar ambiente mantém os itens e os devolve à Caixa de entrada, além de
  limpar a preferência padrão.
- Esvaziar a lixeira também exclui do servidor; antes os itens podiam reaparecer.
- Perfil, fuso e exclusão da conta agora chegam à API; a cópia local só é
  removida depois da exclusão remota bem-sucedida.
- Preferências de notificação e ambiente padrão passam entre aparelhos.
- Itens na lixeira e ambientes arquivados vêm no login/pull, permitindo
  restaurar em qualquer aparelho.

### Sincronização

- Uma captura criada enquanto outra requisição está em voo não é mais apagada
  da fila.
- A fila é separada por usuário; operações de uma conta nunca são enviadas na
  sessão de outra.
- Erros definitivos ficam preservados e visíveis em Configurações, com nova
  tentativa. O estado não declara “sincronizado” se houve rejeição.
- Mudanças remotas em checklist, preferências, perfil e campos do item provocam
  redesenho.
- IDs de importação e de rotas são validados estritamente como UUID.

### Segurança e privacidade

- A RLS de sessões agora autoriza apenas o hash do cookie dentro da transação;
  cadastro, login e logout não contornam nem quebram as políticas.
- Requisições com origem não autorizada são rejeitadas antes de executar a
  operação, reduzindo risco de CSRF.
- Corpo JSON tem limite de 1 MiB e JSON/cookies malformados não derrubam a API.
- Frase original e nome de ambiente arquivado deixaram de entrar como HTML,
  eliminando dois pontos de XSS armazenado.
- Respostas 500 não expõem mensagem interna de banco.

### Não funcionais

- Driver `@neondatabase/serverless` atualizado de 0.10.4 para 1.1.0.
- Service worker avançado para cache v10 e `start_url` passou a respeitar a
  preferência de tela inicial.
- GitHub Actions executa sintaxe, regressões e auditoria de dependências em
  push e pull request.

## Testes executados

- 85 verificações automatizadas: ditado móvel, secretário local, datas,
  preferências e concorrência/isolamento/erros da sincronização.
- Frases temporais variadas: “9 da noite”, “9 da manhã”, “12 da noite”,
  “12 da tarde”, “por volta das nove”, “aproximadamente 9:30”, horário com
  espaço após dois-pontos e repetição de período.
- Checagem de sintaxe de todos os arquivos JavaScript.
- `npm audit --omit=dev`: nenhuma vulnerabilidade conhecida.
- Jornada de navegador em desktop e 390 × 844, incluindo criar conta, editar
  ambiente, abrir os dois atalhos, cadastrar a frase real, cancelar, salvar,
  editar checklist e recarregar.

O conector do Neon foi usado somente para inspeção. Há dois projetos chamados
Nestra. O projeto mais ativo tem 1 usuário, 24 itens e 3 sessões, mas ainda
possui a política antiga `p_owner` em `sessions` e não possui
`nestra_current_session_hash()`. Nenhuma infraestrutura ou dado externo foi
alterado nesta revisão. Como há dois projetos homônimos, aplicar a migração sem
uma escolha explícita poderia corrigir o banco errado. O teste final entre dois
aparelhos depende da publicação e da migração descritas abaixo.

## Critério de publicação

1. Criar/selecionar o projeto Neon e obter a connection string com pooling.
2. Executar `npm run db:schema` com `DATABASE_URL` definida.
3. Publicar o repositório inteiro na Vercel com `DATABASE_URL` e
   `NESTRA_IP_SALT`.
4. Confirmar `{"service":"nestra-api","ok":true}` em `/api/health`.
5. Criar uma conta de homologação; cadastrar no celular, aguardar a aba do
   computador voltar ao foco e confirmar item, checklist, edição e conclusão.

Sem os passos 1–4, a ausência de sincronização não é um defeito remanescente
do frontend: é a limitação da hospedagem estática atual.
