# Testes do app

Testes de navegador (Playwright) e de servidor (Code.gs real em Node `vm`).
Eles viviam no ambiente temporário das sessões do Claude e se perdiam a cada
reciclagem — aqui no repositório, sobrevivem.

## Como rodar

```bash
# servidor local do app
npx http-server . -p 8899 -c-1 &

# pdf-lib para os testes que montam PDFs de verdade
npm i pdf-lib --no-save
cp node_modules/pdf-lib/dist/pdf-lib.min.js tests/

node tests/test-ponto-multiplos.js
```

Os testes de navegador esperam o Chromium do Playwright em
`/opt/pw-browsers/chromium` (ajuste o `executablePath` se o seu for outro).
