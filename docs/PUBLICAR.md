# Publicação (Vercel + Neon)

O repositório é o site. A Vercel serve os arquivos estáticos e roda as funções
de `api/` na mesma origem; o banco fica no Neon. Cada push na `main` gera um
deploy de produção.

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Nome | Obrigatória | Valor |
|---|---|---|
| `DATABASE_URL` | sim | Connection string do Neon com pooling (host com `-pooler`, `?sslmode=require`) |
| `NESTRA_IP_SALT` | sim | Texto secreto e estável, com 16 caracteres ou mais |
| `ANTHROPIC_API_KEY` | não | Liga a IA do copiloto de reuniões. Sem ela, o copiloto usa o assistente local |
| `NESTRA_AI_MODEL` | não | Modelo do copiloto. Padrão: `claude-opus-5-5` |
| `NESTRA_ALLOWED_ORIGINS` | não | Só se o site e a API ficarem em origens diferentes (lista separada por vírgula) |

Depois de criar ou mudar uma variável, publique de novo: a Vercel só lê as
variáveis no deploy.

## Banco

O esquema é idempotente (pode ser aplicado quantas vezes for preciso, não apaga
nada):

    npm install
    DATABASE_URL='postgresql://...' npm run db:schema

No PowerShell:

    $env:DATABASE_URL='postgresql://...'
    npm run db:schema

## Conferir

Abra `https://SEU-ENDERECO/api/health`:

| Resposta | Significado |
|---|---|
| `"ok":true` | API e banco funcionando |
| `"ai":true` | Copiloto usando a IA do servidor |
| `"reason":"sem_banco"` | Falta `DATABASE_URL` |
| `"reason":"sem_salt"` | Falta `NESTRA_IP_SALT` com 16+ caracteres |
| `"reason":"banco_indisponivel"` | A string existe, mas o banco não respondeu ou o esquema não foi aplicado |
| 404 | As funções não subiram; confira se `api/` e `vercel.json` estão no repositório |

Na barra lateral do app, "sincronizado" indica que a conta vale em qualquer
aparelho. "somente neste dispositivo" indica modo local (sem API).

## Rodar localmente

    npm install
    npm run dev                   # http://localhost:8080, modo local
    DATABASE_URL=... NESTRA_IP_SALT=... npm run dev   # com API

## Limite de funções

O plano Hobby da Vercel aceita até 12 funções por deploy. Hoje são 11 (as rotas
de autenticação ficam juntas em `api/auth/[action].js`). Prefira estender uma
rota existente a criar um arquivo novo em `api/`.
