# 🌿 SST Fazenda Água Viva

App web mobile-first para gestão de SST.  
**Stack:** GitHub Pages (frontend) + Google Apps Script (backend/API)  
**Zero custo. Zero servidor. Tudo dentro do Google.**

---

## Arquitetura

```
Celular (GitHub Pages)
        ↓  fetch()
Google Apps Script  ←→  Google Sheets (banco de dados)
                    ←→  Google Drive  (pastas e PDFs)
                    ←→  ZapSign API   (assinaturas via WhatsApp)
```

---

## 🚀 Passo a Passo

### 1. Configurar o Google Apps Script (backend)

1. Acesse [script.google.com](https://script.google.com) → **Novo projeto**
2. Apague o código padrão e cole todo o conteúdo do arquivo `gas/Code.gs`
3. No topo do arquivo, preencha o `CONFIG`:
   ```js
   DRIVE_ROOT_FOLDER: 'ID_DA_PASTA_NO_DRIVE',
   ZAPSIGN_TOKEN:     'seu_token_zapsign',
   ADM_USERS: { 'jovane': 'sua_senha', 'tais': 'outra_senha' }
   ```
4. Clique em **Implantação** → **Nova implantação**
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
5. Clique em **Implantar** → copie a **URL da implantação**

---

### 2. Configurar o frontend (app.js)

Abra `js/app.js` e cole a URL da implantação na linha:
```js
const GAS_URL = 'https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec'
```

---

### 3. Criar pasta no Google Drive

1. Crie uma pasta chamada `Funcionarios_SST` no Drive
2. Copie o ID da pasta da URL: `drive.google.com/drive/folders/**ESTE_ID**`
3. Cole no `CONFIG` do Apps Script em `DRIVE_ROOT_FOLDER`

---

### 4. Configurar o webhook da ZapSign

No painel da ZapSign → Integrações → Webhooks:
- URL: **a mesma URL do Apps Script**
- Evento: `document_signed`

---

### 5. Subir no GitHub Pages

```bash
git init
git add .
git commit -m "SST Fazenda Água Viva"
git remote add origin https://github.com/SEU_USUARIO/sst-fazenda.git
git push -u origin main
```

No GitHub → Settings → Pages → Source: **main branch** → Save

URL do app: `https://SEU_USUARIO.github.io/sst-fazenda`

---

### 6. Abrir no celular como app

No Chrome (Android) ou Safari (iOS):
- Abra a URL do GitHub Pages
- Menu → **"Adicionar à tela inicial"**
- Vira ícone de app, abre em tela cheia

---

## 🔐 Usuários ADM

Configure no `CONFIG` do Apps Script:
```js
ADM_USERS: {
  'jovane': 'senha1',
  'tais':   'senha2',
  'admin':  'admin123',
}
```

---

## 📋 Fluxo de assinatura (EPI ou Folha)

```
ADM seleciona funcionário + EPI/Folha no app
           ↓
Apps Script gera PDF do recibo
           ↓
Apps Script envia PDF para ZapSign
           ↓
ZapSign envia link pelo WhatsApp do funcionário
           ↓
Funcionário assina no celular (sem app)
           ↓
ZapSign chama webhook (Apps Script)
           ↓
Apps Script baixa PDF assinado → salva no Drive do funcionário
           ↓
Google Sheets atualizado: STATUS = "Assinado" + link do documento
```
