# Nestra

Organizador pessoal: escreva uma frase natural e o Nestra entende o tipo, a data
e o ambiente. Inclui um copiloto de reuniões que transforma o que você precisa
falar num mapa mental para acompanhar durante a conversa.

## Funções

- **Captura** por texto ou voz, com leitura de datas, horários, prioridade e ambiente.
- **Hoje**: atrasados, o que vence hoje, alta prioridade e capturas recentes.
- **Ambientes**: Trabalho, Estudos, Pessoal ou o que você criar.
- **Reuniões**: agenda fixa (daily, 1:1, revisão), pauta em mapa mental, modo
  reunião com cronômetro e checks, ata automática e próximos passos como tarefas.
- **Sincronização** entre aparelhos e funcionamento offline (PWA).

## Stack

HTML, CSS e JavaScript sem build · funções Node na Vercel · PostgreSQL no Neon ·
Claude (opcional) no copiloto.

## Comandos

    npm install
    npm run dev        # servidor local em http://localhost:8080
    npm run check      # sintaxe, rota de saúde e testes
    npm run db:schema  # aplica db/schema.sql (precisa de DATABASE_URL)

## Documentação

- [Publicação](docs/PUBLICAR.md)
- [Arquitetura](docs/ARQUITETURA.md)
- [Privacidade](docs/PRIVACIDADE.md) · [Termos](docs/TERMOS.md)
