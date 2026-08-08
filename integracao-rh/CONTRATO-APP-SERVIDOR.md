# Contrato entre o app (nuvem) e o script de RH (servidor físico)

*Divisão acordada em 2026-08-04. Este documento é o que a conversa do script
Python precisa saber — nada além disto é compartilhado entre os dois lados.*

## Divisão de responsabilidades

| Etapa | Quem faz | Onde |
|---|---|---|
| Receber o PDF cru e fracionar por funcionário | **App** | página "Folha de Pagamento" |
| Identificar o funcionário (IA + conferência) | **App** | Apps Script |
| Guardar a **cópia não assinada** | **App** | Google Drive |
| Enviar para assinatura | **App** | ZapSign / WhatsApp |
| Receber o assinado, arquivar e imprimir | **Servidor** | `Y:\RH-2` + Brother |

O app **não** escreve no `Y:\RH-2` e **não** imprime. O servidor **não** precisa
consultar o app: tudo o que ele precisa chega no e-mail.

## O que chega no e-mail do ZapSign

Remetente `ola@zapsign.com.br`, assunto `<Nome Completo> assinou o documento <DocName>`,
com o **PDF assinado anexado**.

**O nome do anexo carrega o tipo do documento:**

```
<Tipo>_<Mês>-<Ano>_<NOME COMPLETO>
```

| Documento | Nome do anexo |
|---|---|
| Folha de pagamento | `Folha_Julho-2026_ANA PAULA RIBEIRO` |
| Férias | `Ferias_Julho-2026_JOSE NILSON ANTONIO LIMA` |
| Ponto | `Ponto_Julho-2026_CARLOS EDUARDO SOUZA` |
| EPI | `Recibo_EPI_<Nome>_<DD-MM-AAAA>` *(formato próprio, não passa por aqui)* |

> **Mudou em 08/2026.** Antes o app mandava `Folha_...` para **todo**
> documento — férias e ponto inclusive — e o tipo só existia dentro do PDF,
> obrigando o `classifica_conteudo` a descobri-lo por OCR. Agora vem no
> prefixo.
>
> ✅ **O `baixar_rh_email.py` NÃO precisa de alteração.** O formato é de
> propósito o mesmo que o `parse_docname` dele já entende: ele testa
> `startswith("FOLHA_")`, `startswith("PONTO")` e `startswith("FERIAS")`, e
> tira mês/ano do padrão `<MES>-<ANO>`. O servidor ganha o tipo de graça.
>
> `Folha` continua devolvendo a família `FOLHA?`, e o `classifica_conteudo`
> decide entre recibo, contracheque e comprovante lendo o PDF — comportamento
> inalterado. **Férias e ponto passam a ser definitivos pelo nome**, que é
> onde o OCR errava.

Chegou a existir aqui uma proposta de nomear o anexo já no padrão do arquivo
(`2026.07.NOME.TIPO`), com um patch obrigatório no `parse_docname`. Foi
descartada: obrigava a mexer no servidor para ganhar pouco — o nome final em
`Y:\RH-2` é montado pelo `destino_e_nome` a partir de `(tipo, ano, mês)`, não
do nome do anexo, então ele já sai certo dos dois jeitos. O patch está no
histórico do repositório (`b5483fd`) se um dia fizer sentido.

## O recibo pode vir com o ponto dentro

Para economizar assinatura — o ZapSign cobra por **documento**, não por
página — o app junta a folha e o ponto do mesmo funcionário num arquivo só.
Quando isso acontece, o anexo `Folha_Julho-2026_NOME` tem **2 páginas**:

| Página | Conteúdo |
|---|---|
| 1 | recibo / holerite |
| 2 | folha de ponto |

A página 1 é sempre a folha, de propósito: é ela que o `classifica_conteudo`
lê para decidir a pasta. O documento inteiro arquiva em
`03. Folha de Pagamento\Recibos` — o ponto vai junto como comprovação anexa,
e `04. Ponto` fica sem arquivo próprio nesse mês.

Nada muda no script: continua sendo um e-mail, um anexo, um arquivo.

## A cópia não assinada (fica só no Drive)

Ao enviar para assinatura, o app guarda o PDF cru na pasta do funcionário:

```
<ID>_<NOME>/FOLHA_PAGAMENTO/Folha_Julho-2026_ANA PAULA RIBEIRO_PENDENTE.pdf
<ID>_<NOME>/FERIAS/Ferias_Julho-2026_JOSE NILSON ANTONIO LIMA_PENDENTE.pdf
```

O sufixo `_PENDENTE` distingue da via assinada. **Essa cópia não vai para o
`Y:\RH-2`** — o arquivo permanente é a via assinada, conforme o §3 do fluxo.

## Duas fontes de arquivo, de propósito

| | Google Drive | `Y:\RH-2` |
|---|---|---|
| Alimentado por | App | Script do servidor |
| Contém | cópia crua (`_PENDENTE`) + a assinada que o webhook pegar | **a assinada** |
| Papel | operacional do app (consulta na ficha do funcionário) | **arquivo permanente e impressão** |

Não é duplicação acidental: o Drive serve o app, o `Y:\RH-2` é o arquivo legal.
O `CONTROLE RH 2026.xlsx` continua indexando o `Y:\RH-2` — o disco é a fonte da
verdade dele.

## O que o app sabe e o e-mail não carrega

Estes dados existem na planilha do app, mas **não** viajam no e-mail:

- **valor líquido** do documento (extraído por IA)
- **empregador** (produtor) do funcionário
- período de férias (início/fim)
- token do ZapSign, status de pagamento, ordem de pagamento

Hoje o `controle_rh` preenche o empregador pela aba `CADASTRO`, o que resolve.
Se um dia quiser o valor líquido na planilha de controle sem reabrir o PDF,
dá para expor um endpoint de leitura no app — chegou a existir e foi removido
por sair do escopo; está no histórico do repositório (`a078d29`).

## Ordem de implantação

1. **Deploy do `Code.gs`** no Apps Script, preservando `SHEET_ID`,
   `DRIVE_ROOT_FOLDER` e a senha do admin (linhas 22, 23 e 31)
2. Enviar um documento novo pelo app e conferir que o anexo chega como
   `Ferias_Julho-2026_NOME` (e não mais `Folha_...` para tudo)
3. Conferir no servidor que ele foi para `05. Férias`, sem passar por
   `_A_CLASSIFICAR`

Nada a fazer no servidor. Se algo cair em `_A_CLASSIFICAR`, é sinal de que o
nome saiu fora do padrão — mande o nome do anexo que dá para diagnosticar.
