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

**O nome do anexo é o nome final do arquivo** — mesma convenção do `Y:\RH-2`:

```
AAAA.MM.NOME COMPLETO.TIPO.pdf
```

| Documento | Nome do anexo |
|---|---|
| Folha de pagamento | `2026.07.ANA PAULA RIBEIRO.RECIBO.pdf` |
| Férias | `2026.07.JOSE NILSON ANTONIO LIMA.FERIAS.pdf` |
| Ponto | `2026.07.CARLOS EDUARDO SOUZA.PONTO.pdf` |
| EPI | `Recibo_EPI_<Nome>_<DD-MM-AAAA>` *(formato antigo, ainda não migrado)* |

> **Mudou em 08/2026.** Antes o app mandava `Folha_Julho-2026_Watila` para
> **todo** documento — férias e ponto inclusive — e o tipo só existia dentro do
> PDF, obrigando a classificar por OCR. Agora o tipo vem no nome.
>
> ⚠️ **O `parse_docname` precisa do patch** em `PATCH-parse_docname.py`, que
> aceita o formato novo mantendo os antigos. Sem ele, todo documento novo cai
> em "REVISAR". O histórico de e-mails dentro da janela de 45 dias ainda tem
> `Folha_...`, então os dois formatos precisam conviver.

O `controle_rh.parse_arquivo` já aceita o formato novo sem mudança — ele é
exatamente o padrão que o `destino_e_nome` produz.

## A cópia não assinada (fica só no Drive)

Ao enviar para assinatura, o app guarda o PDF cru na pasta do funcionário:

```
<ID>_<NOME>/FOLHA_PAGAMENTO/2026.07.ANA PAULA RIBEIRO.RECIBO.PENDENTE.pdf
<ID>_<NOME>/FERIAS/2026.07.JOSE NILSON ANTONIO LIMA.FERIAS.PENDENTE.pdf
```

O sufixo `.PENDENTE` distingue da via assinada. **Essa cópia não vai para o
`Y:\RH-2`** — o arquivo permanente é a via assinada, conforme o §3 do fluxo.

## Duas fontes de arquivo, de propósito

| | Google Drive | `Y:\RH-2` |
|---|---|---|
| Alimentado por | App | Script do servidor |
| Contém | cópia crua (`.PENDENTE`) + a assinada que o webhook pegar | **a assinada** |
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

1. **Aplicar o `PATCH-parse_docname.py`** no `baixar_rh_email.py`
2. **Deploy do `Code.gs`** no Apps Script (preservando `SHEET_ID`,
   `DRIVE_ROOT_FOLDER` e a senha do admin — linhas 22, 23 e 31)
3. `python baixar_rh_email.py` em dry-run: os antigos devem continuar
   reconhecidos
4. Enviar um documento novo pelo app e conferir que o anexo chega com o nome
   no formato novo

Inverter 1 e 2 manda os documentos assinados no intervalo para
`_A_CLASSIFICAR` — recuperável, mas dá trabalho.
