# -*- coding: utf-8 -*-
r"""
Arquiva no Y:\RH-2 os assinados direto do app (sem passar pelo e-mail)
=====================================================================
Alternativa ao baixar_rh_email.py. Em vez de ler o e-mail do ZapSign e
redescobrir tipo/competência por OCR, pergunta ao app — que sabe tudo porque
foi ele que enviou o documento:

    POST {acao: 'listar_para_arquivo', desde: 'AAAA-MM-DD'}
      -> [{token, nome, empregador, tipo_arquivo, ano_mes, dia,
           valor_liquido, nome_arquivo, link_pdf}, ...]

Para cada um: baixa o PDF do Drive, salva na pasta certa do RH-2 com o nome
que já veio pronto, e avisa o app de volta:

    POST {acao: 'confirmar_arquivamento', token, caminho, impresso}

Ganhos sobre a via do e-mail:
  - sem OCR de classificação (o tipo vem da origem)
  - competência, valor líquido e empregador vêm corretos
  - dedup pelo token do documento, não por heurística de nome
  - o app passa a saber o que já está no arquivo físico

Os dois caminhos podem conviver: a dedup é pelo arquivo-alvo no disco, então
rodar os dois não duplica nada.

USO:
  python arquivar_do_app.py                  # dry-run: só lista o que faria
  python arquivar_do_app.py --executar       # baixa, arquiva e confirma
  python arquivar_do_app.py --desde 2026-07-01
  python arquivar_do_app.py --refazer        # reprocessa até os já confirmados

CONFIG: defina as variáveis de ambiente (não commitar credencial):
  SST_GAS_URL, SST_USUARIO, SST_SENHA
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

RH2 = r"Y:\RH-2"

PASTAS_TIPO = {
    "RECIBO":       os.path.join(RH2, "03. Folha de Pagamento", "Recibos"),
    "CONTRACHEQUE": os.path.join(RH2, "03. Folha de Pagamento", "Contracheques"),
    "COMPROVANTE":  os.path.join(RH2, "03. Folha de Pagamento", "Comprovantes"),
    "PONTO":        os.path.join(RH2, "04. Ponto"),
    "FERIAS":       os.path.join(RH2, "05. Férias"),
    "EPI":          os.path.join(RH2, "06. EPI"),
}
MES_NOME = {1: "JANEIRO", 2: "FEVEREIRO", 3: "MARCO", 4: "ABRIL", 5: "MAIO",
            6: "JUNHO", 7: "JULHO", 8: "AGOSTO", 9: "SETEMBRO", 10: "OUTUBRO",
            11: "NOVEMBRO", 12: "DEZEMBRO"}

GAS_URL = os.environ.get("SST_GAS_URL", "")
USUARIO = os.environ.get("SST_USUARIO", "")
SENHA   = os.environ.get("SST_SENHA", "")


def chamar_app(acao, dados=None, timeout=120):
    """POST no Web App do Apps Script. Devolve o campo 'data' da resposta."""
    if not GAS_URL:
        sys.exit("Falta SST_GAS_URL no ambiente (URL do Web App do Apps Script).")
    corpo = {"acao": acao, "usuario": USUARIO, "senha": SENHA}
    if dados:
        corpo["dados"] = dados
    req = urllib.request.Request(
        GAS_URL, data=json.dumps(corpo).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read().decode("utf-8"))
    if not resp.get("ok"):
        raise RuntimeError(resp.get("erro") or "erro desconhecido do app")
    return resp.get("data")


def id_do_drive(link):
    """Extrai o FILEID de um link do Drive."""
    m = re.search(r"/d/([-\w]{25,})", link or "") or re.search(r"[?&]id=([-\w]{25,})", link or "")
    return m.group(1) if m else ""


def baixar_pdf(link, timeout=120):
    """Baixa o PDF do Drive. Os arquivos do app são públicos por link
    (setSharing ANYONE_WITH_LINK), então não precisa de OAuth."""
    fid = id_do_drive(link)
    if not fid:
        raise ValueError(f"link do Drive não reconhecido: {link}")
    url = f"https://drive.google.com/uc?export=download&id={fid}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dados = r.read()
    if dados[:4] != b"%PDF":
        raise ValueError("o conteúdo baixado não é um PDF (link privado ou "
                         "página de confirmação do Drive)")
    return dados


def destino(doc):
    """(pasta, caminho_absoluto) conforme a estrutura do RH-2."""
    tipo = doc["tipo_arquivo"]
    base = PASTAS_TIPO.get(tipo)
    if not base:
        raise ValueError(f"tipo sem pasta definida: {tipo}")
    am = doc.get("ano_mes") or {}
    ano, mes = am.get("ano"), am.get("mes")
    if not ano or not mes:
        raise ValueError("documento sem ano/mês")
    if tipo == "FERIAS":
        pasta = os.path.join(base, str(ano))          # férias arquiva por ano
    else:
        pasta = os.path.join(base, str(ano), f"{mes:02d}-{MES_NOME[mes]}")
    return pasta, os.path.join(pasta, doc["nome_arquivo"])


def main():
    ap = argparse.ArgumentParser(description="Arquiva os assinados vindos do app")
    ap.add_argument("--executar", action="store_true",
                    help="baixa, arquiva e confirma de verdade (sem isso, só lista)")
    ap.add_argument("--desde", default=None,
                    help="só documentos assinados a partir desta data (AAAA-MM-DD)")
    ap.add_argument("--refazer", action="store_true",
                    help="inclui os que o app já marcou como arquivados")
    args = ap.parse_args()

    desde = args.desde
    if not desde and not args.refazer:
        desde = (datetime.date.today() - datetime.timedelta(days=45)).isoformat()

    print(f"Consultando o app{f' (desde {desde})' if desde else ''}...\n")
    dados = {"desde": desde} if desde else {}
    if args.refazer:
        dados["incluir_arquivados"] = True
    res = chamar_app("listar_para_arquivo", dados)
    docs = (res or {}).get("documentos", [])

    if not docs:
        print("Nenhum documento assinado pendente de arquivamento.")
        return

    print(f"{len(docs)} documento(s) assinado(s) no app.\n")
    arquivados = pulados = erros = 0

    for doc in docs:
        try:
            pasta, caminho = destino(doc)
        except Exception as e:
            print(f"- ERRO ({doc.get('nome_arquivo','?')}): {e}")
            erros += 1
            continue

        rel = os.path.relpath(caminho, RH2)
        if os.path.exists(caminho):
            print(f"- já existe, pulado: RH-2\\{rel}")
            pulados += 1
            continue

        if not args.executar:
            valor = doc.get("valor_liquido")
            extra = f"  (R$ {valor})" if valor else ""
            print(f"- ARQUIVARIA [{doc['tipo_arquivo']}]: RH-2\\{rel}{extra}")
            arquivados += 1
            continue

        try:
            raw = baixar_pdf(doc["link_pdf"])
        except Exception as e:
            print(f"- ERRO ao baixar {doc['nome_arquivo']}: {e}")
            erros += 1
            continue

        os.makedirs(pasta, exist_ok=True)
        with open(caminho, "wb") as fh:
            fh.write(raw)
        print(f"- ARQUIVADO [{doc['tipo_arquivo']}]: RH-2\\{rel}  ({len(raw)//1024} KB)")
        arquivados += 1

        # avisa o app — sem isso o documento volta na próxima rodada
        try:
            chamar_app("confirmar_arquivamento",
                       {"token": doc["token"], "caminho": rel, "impresso": False})
        except Exception as e:
            print(f"  (aviso: arquivei mas não consegui confirmar no app: {e})")

    if args.executar and arquivados:
        try:
            import controle_rh
            controle_rh.reindexar(silencioso=True)
            print("\nPlanilha de controle atualizada (CONTROLE RH 2026.xlsx).")
        except Exception as e:
            print(f"\n(aviso: não atualizei a planilha agora: {e} — "
                  f"rode 'python controle_rh.py --reindexar')")

    print()
    if args.executar:
        print(f"CONCLUÍDO: {arquivados} arquivado(s), {pulados} já existiam, {erros} erro(s).")
    else:
        print(f"DRY-RUN: {arquivados} seriam arquivados, {pulados} já existem, {erros} erro(s).")
        print("Rode com --executar para baixar e arquivar de verdade.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
