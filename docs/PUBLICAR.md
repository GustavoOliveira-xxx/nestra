# Publicar o Nestra com conta que vale em qualquer aparelho

O site hoje está no GitHub Pages. O Pages entrega arquivos e nada mais:
ele não executa a pasta `api/`, e sem ela não existe onde guardar uma
conta. É por isso que o app diz **“somente neste dispositivo”** e por que
a conta criada no computador não aparece no celular.

Publicando o mesmo repositório na Vercel, as funções passam a rodar ao
lado do site, o app encontra a API sozinha e a sincronização liga sem
nenhuma configuração no código.

O tempo total é de uns dez minutos, quase todos esperando.

---

## O que você vai precisar

- uma conta na [Vercel](https://vercel.com) (o plano gratuito basta);
- uma conta no [Neon](https://neon.tech) (o plano gratuito basta);
- o repositório no GitHub — já está.

---

## 1. Criar o banco no Neon

1. Entre no Neon e crie um projeto. A região mais perto de você
   (`South America (São Paulo)` se estiver no Brasil) deixa o app mais
   rápido.
2. Copie a **connection string com pooling** do projeto. No painel do Neon,
   ative a opção de pooling; o host terá `-pooler`. Essa é a opção recomendada
   para funções serverless. Ela se parece com:

       postgresql://usuario:senha@ep-algo-123456-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require

Guarde essa linha: ela é a `DATABASE_URL` do passo 3.

> Ela dá acesso total ao banco. Não coloque no repositório nem em
> nenhum arquivo do projeto — ela vive só nas variáveis de ambiente da
> Vercel, e o navegador nunca a recebe.

## 2. Aplicar o esquema

Na sua máquina, dentro da pasta do projeto, use um dos comandos abaixo.

PowerShell (Windows):

    npm install
    $env:DATABASE_URL='cole-a-string-aqui'
    npm run db:schema

Bash (Linux/macOS):

    npm install
    DATABASE_URL='cole-a-string-aqui' npm run db:schema

Isso cria as 22 tabelas, os índices e as políticas de isolamento por
linha. O comando pode ser repetido sem problema: ele não apaga nada.

## 3. Publicar na Vercel

1. Em vercel.com → **Add New… → Project** → importe `nestra`.
2. Nas configurações de build, **não mude nada**: o `vercel.json` do
   repositório já diz o que fazer.
3. Antes de concluir, abra **Environment Variables** e cadastre duas:

   | Nome | Valor |
   |---|---|
   | `DATABASE_URL` | a connection string do passo 1 |
   | `NESTRA_IP_SALT` | um texto secreto, estável e com pelo menos 16 caracteres |

   O `NESTRA_IP_SALT` embaralha os endereços de IP usados para limitar
   tentativas de login. Serve para que nem o próprio banco guarde IP em
   claro. Escolha uma vez e não troque mais — trocar só zera a contagem
   de tentativas.

4. **Deploy**.

> Ao publicar esta correção, execute o passo 2 novamente. O esquema é
> idempotente e a reaplicação instala a política de sessão corrigida sem
> apagar cadastros.

## 4. Conferir

Abra o endereço que a Vercel deu e olhe o rodapé da barra lateral:

- **“sincronizado”** → está tudo certo, pode seguir;
- **“somente neste dispositivo”** → veja o diagnóstico abaixo.

Agora crie uma conta nova por ali. Depois abra o mesmo endereço no
celular e entre com o mesmo e-mail e a mesma senha: os ambientes e os
itens têm que estar lá.

---

## Quando alguma coisa não bate

Abra `SEU-ENDERECO/api/health` no navegador. A resposta diz o que está
acontecendo:

| Resposta | O que significa | O que fazer |
|---|---|---|
| `{"service":"nestra-api","ok":true}` | API e banco de pé | nada, está certo |
| `{"ok":false,"reason":"sem_banco"}` | falta a `DATABASE_URL` | cadastre a variável e publique de novo |
| `{"ok":false,"reason":"sem_salt"}` | falta um `NESTRA_IP_SALT` seguro | cadastre um segredo estável com pelo menos 16 caracteres e publique de novo |
| `{"ok":false,"reason":"banco_indisponivel"}` | a variável existe mas o banco não respondeu | confira se a string está inteira, se termina com `?sslmode=require` e se o esquema do passo 2 foi aplicado |
| página 404 | as funções não subiram | confirme que a pasta `api/` está no repositório e que o `vercel.json` não foi alterado |

A tela de entrar também mostra o motivo, em vez de só avisar que os dados
ficam no aparelho.

Depois de cadastrar ou mudar uma variável de ambiente é **preciso
publicar de novo** — a Vercel só lê as variáveis no momento do deploy.

---

## Perguntas que costumam aparecer

**E o endereço do GitHub Pages, continua funcionando?**
Continua, e continua guardando os dados só no navegador. Se quiser evitar
confusão, o mais limpo é desligar o Pages nas configurações do
repositório e usar só o endereço da Vercel.

**As contas que eu já criei vêm junto?**
Não. Elas existem apenas no navegador onde foram criadas — o servidor
nunca soube delas. Antes de migrar, entre na conta antiga, vá em
**Configurações → Meus dados → Baixar JSON**, e depois crie a conta de
novo no endereço publicado.

**Posso usar meu próprio domínio?**
Pode. Em Settings → Domains, na Vercel. Como o site e a API continuam na
mesma origem, nada mais precisa ser ajustado.

**E se eu quiser o site num endereço e a API em outro?**
Aí cadastre também `NESTRA_ALLOWED_ORIGINS` com a lista de endereços do
site, separados por vírgula. O servidor passa a aceitar aqueles cabeçalhos
de origem e afrouxa o cookie de sessão para funcionar entre origens
diferentes. Enquanto essa variável não existir, só a mesma origem é
aceita — que é a configuração mais restrita e a recomendada.

---

## O que já foi verificado

Antes de escrever este guia, o backend foi exercitado contra um
PostgreSQL de verdade, com o mesmo código que vai rodar na Vercel:

- o esquema aplica limpo, 22 tabelas, sem erro;
- cadastro cria a conta e os três ambientes de exemplo;
- o cookie de sessão sai `HttpOnly`, `Secure` e `SameSite=Lax`;
- e-mail repetido é recusado sem confirmar que já existe;
- uma conta não enxerga nem consegue alterar item de outra;
- senha errada devolve a mesma mensagem de e-mail inexistente;
- sem sessão, nenhuma rota responde dado nenhum.

E o fluxo inteiro em dois navegadores separados, como dois aparelhos: a
conta criada em um entra no outro, o item escrito em um aparece no outro
sozinho, e concluir num reflete no outro.
