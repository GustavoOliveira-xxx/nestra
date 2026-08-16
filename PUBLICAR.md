# Como colocar o Nestra no seu GitHub

> **Por que isso não veio pronto:** a sessão que gerou este código tem acesso
> **somente leitura** ao repositório `GustavoOliveira-xxx/nestra`. Tanto o
> `git push` quanto a API do GitHub responderam **403 — Resource not accessible
> by integration**. O commit está feito, no seu nome; só o envio precisa sair
> da sua máquina.

---

## Antes de tudo: o commit **já existe**

Se você rodou `git commit` e apareceu

```
nothing to commit, working tree clean
```

isso **não é erro**. Quer dizer que já está tudo commitado — é só publicar.
Confirme com:

```bash
git log --oneline
```

Você deve ver os commits, com autoria `Gustavo Oliveira <gu.prgm@gmail.com>`.
Se aparecerem, **pule direto para o passo 2**.

---

## Caminho A — pelo site do GitHub (não precisa de git)

O mais rápido se você não quer lidar com credencial.

1. Descompacte o `nestra.zip`.
2. Abra <https://github.com/GustavoOliveira-xxx/nestra>.
3. Clique em **Add file → Upload files**.
4. Arraste **o conteúdo** da pasta `nestra` (não a pasta em si — abra ela e
   selecione tudo que está dentro, inclusive as pastas `css`, `js`, `assets`,
   `api`, `db` e `docs`).
5. Escreva uma mensagem de commit e clique em **Commit changes**.

> O arquivo `.nojekyll` é essencial e começa com ponto, então alguns
> sistemas o escondem. No Windows, marque *Itens ocultos* no Explorador;
> no Mac, aperte `Cmd + Shift + .` no Finder.

---

## Caminho B — pelo git, do seu computador

### 1. Entre na pasta

```bash
cd caminho/para/nestra
```

### 2. Publique

```bash
git push -u origin claude/nestra-3d-design-2y7c78
```

### Se pedir usuário e senha

O GitHub não aceita mais a senha da conta no `git push`. Use um **token**:

1. Vá em <https://github.com/settings/tokens> → **Generate new token
   (classic)**.
2. Marque o escopo **`repo`**.
3. Gere e copie o token.
4. No `git push`, informe:
   - **Username:** `GustavoOliveira-xxx`
   - **Password:** cole o token (não a sua senha)

### Se aparecer `403` ou `Permission denied`

Confirme que o remoto aponta para o seu repositório:

```bash
git remote -v
```

Se estiver diferente, corrija:

```bash
git remote set-url origin https://github.com/GustavoOliveira-xxx/nestra.git
```

### Se aparecer `src refspec ... does not match any`

A branch não existe localmente. Crie e publique:

```bash
git checkout -b claude/nestra-3d-design-2y7c78
git push -u origin claude/nestra-3d-design-2y7c78
```

---

## Caminho C — GitHub Desktop

1. Instale o <https://desktop.github.com>.
2. **File → Add local repository** e aponte para a pasta `nestra`.
3. Clique em **Publish branch**.

O login é feito pelo próprio aplicativo, sem token.

---

## Passo 2 — ligar o GitHub Pages

Depois que os arquivos estiverem lá:

1. **Settings → Pages**.
2. Em *Source*, escolha **Deploy from a branch**.
3. Branch: `claude/nestra-3d-design-2y7c78` (ou `main`, se você mesclar), pasta
   `/ (root)`.
4. Salve. Em um ou dois minutos o site sai no ar em
   `https://gustavooliveira-xxx.github.io/nestra/`.

Já existe também um fluxo pronto em `.github/workflows/pages.yml`, que publica
sozinho a cada envio para a `main`.

---

## Passo 3 — colocar a sua logo

**Não precisa mexer em arquivo.** Abra o Nestra, entre em

**Configurações → Aparência → Marca**

e arraste a imagem da sua logo ali (ou clique para escolher). Pronto: o efeito
3D passa a usar ela imediatamente.

O que acontece por baixo:

- a imagem é lida pixel a pixel — **nada é redesenhado nem vetorizado**;
- se ela vier com fundo branco, o fundo externo é removido sozinho, por
  preenchimento a partir das bordas, sem tocar nos brancos de dentro
  (a palavra na marca, as estrelas, os brilhos);
- o contorno vira um campo de distância e é **extrudado** em 3D, com chanfro,
  aro de luz, giro contínuo e reação ao ponteiro;
- as cores continuam sendo as da imagem: a luz só dá volume.

A marca fica guardada **no seu navegador** e não sobe para lugar nenhum.

### Para deixar fixa no repositório

Se preferir que qualquer pessoa que abrir o site já veja a sua marca, salve o
arquivo como:

```
assets/logo/nestra-mark.png
```

Também são aceitos, automaticamente e nesta ordem:

```
assets/logo/nestra-mark.png
assets/logo/nestra-mark.jpg
assets/logo/nestra-mark.jpeg
assets/logo/nestra-mark.webp
assets/logo/logo.png
assets/logo/logo.jpg
```

O primeiro que existir é o usado.

> O arquivo que está lá hoje é um **monograma provisório**, feito só para o
> sistema ter o que mostrar. Ele não é a sua marca.

---

## Rodar localmente antes de publicar

```bash
npx http-server -p 8080 -c-1 .
```

e abra <http://localhost:8080>.

> Abrir o `index.html` com dois cliques **não funciona**: os módulos de
> JavaScript e o service worker exigem `http://`, não `file://`.
