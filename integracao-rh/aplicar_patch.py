# -*- coding: utf-8 -*-
"""
Aplica no baixar_rh_email.py o parse_docname que entende o nome novo
====================================================================
O app passou a nomear o documento do ZapSign assim:

    2026.07.JOSE NILSON ANTONIO LIMA.FERIAS

em vez do antigo 'Folha_Julho-2026_Watila'. Sem este patch o parse_docname
devolve None para TODO documento novo e tudo cai em "REVISAR".

Este script troca a função sozinho — não precisa editar nada à mão.

USO (na mesma pasta do baixar_rh_email.py):

    python aplicar_patch.py           # mostra o que faria, sem gravar
    python aplicar_patch.py --aplicar # grava (guarda um .bak antes)

Rodar duas vezes não faz mal: ele avisa que já está aplicado e não mexe.
"""

import os
import re
import shutil
import sys

ALVO = "baixar_rh_email.py"

FUNCAO_NOVA = '''TIPOS_CONHECIDOS = {"RECIBO", "CONTRACHEQUE", "COMPROVANTE", "PONTO", "FERIAS", "EPI"}


def parse_docname(docname):
    """Do NOME DO DOCUMENTO do ZapSign deduz (tipo, ano, mes, dia).
    Retorna None se o padrao nao for reconhecido (p/ revisar, nao chutar).

    Formatos aceitos:
      NOVO (app >= 08/2026, ja traz o tipo):
        2026.07.JOSE NILSON ANTONIO LIMA.FERIAS   -> (FERIAS, 2026, 7, None)
        2026.06.29.JOVANE GATTO COSSUL.EPI        -> (EPI,    2026, 6, 29)
      ANTIGOS (historico de e-mails ainda dentro da janela de 45 dias):
        Folha_Julho-2026_Watila                   -> (FOLHA?, 2026, 7, None)
        Recibo_EPI_Jovane_29-06-2026              -> (EPI,    2026, 6, 29)
    """
    base = re.sub(r"\\.pdf$", "", docname, flags=re.IGNORECASE)
    norm = _sem_acento(base)

    # -- NOVO: AAAA.MM[.DD].NOME COMPLETO.TIPO --
    # Mesmo padrao do arquivo em Y:\\RH-2, entao o tipo vem pronto: dispensa o
    # classifica_conteudo (que continua valendo p/ os nomes antigos).
    tok = base.split(".")
    if len(tok) >= 4 and len(tok[0]) == 4 and tok[0].isdigit() and tok[1].isdigit():
        ano, mes = int(tok[0]), int(tok[1])
        if len(tok) >= 5 and len(tok[2]) == 2 and tok[2].isdigit():
            dia, resto = int(tok[2]), tok[3:]
        else:
            dia, resto = None, tok[2:]
        tipo = _sem_acento(resto[-1]).strip()
        if tipo in TIPOS_CONHECIDOS and 1 <= mes <= 12:
            return (tipo, ano, mes, dia)

    # -- ANTIGO: EPI --
    #   novo:   Recibo_EPI_<Nome>_<DD-MM-AAAA>
    #   antigo: RECIBO EPI - <Nome> - <DD/MM/AAAA>
    if re.match(r"RECIBO[ _]EPI", norm):
        m = re.search(r"(\\d{2})[-/](\\d{2})[-/](\\d{4})\\s*$", base)
        if m:
            dia, mes, ano = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return ("EPI", ano, mes, dia)
        return None

    # -- ANTIGO: Folha_<Mes>-<Ano>_<Nome> --
    # Nome generico do app: podia ser RECIBO, PONTO ou FERIAS. Devolve a
    # familia "FOLHA?" p/ o classifica_conteudo decidir pelo PDF.
    if norm.startswith("FOLHA_"):
        m = re.search(r"FOLHA_([A-ZÇ]+)-(\\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("FOLHA?", int(m.group(2)), MESES[m.group(1)], None)
        return None

    if norm.startswith("PONTO"):
        m = re.search(r"([A-ZÇ]+)-(\\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("PONTO", int(m.group(2)), MESES[m.group(1)], None)
        return None

    if norm.startswith("FERIAS"):
        m = re.search(r"([A-ZÇ]+)-(\\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("FERIAS", int(m.group(2)), MESES[m.group(1)], None)
        m = re.search(r"(\\d{2})-(\\d{2})-(\\d{4})", base)
        if m:
            return ("FERIAS", int(m.group(3)), int(m.group(2)), int(m.group(1)))
        return None

    return None
'''


def achar_funcao(linhas):
    """(inicio, fim) da def parse_docname, incluindo decorador e corpo.
    O fim é achado pela indentação: acaba na primeira linha não vazia que
    volta para a margem — é assim que o Python delimita um bloco."""
    ini = None
    for i, ln in enumerate(linhas):
        if re.match(r"^def\s+parse_docname\s*\(", ln):
            ini = i
            break
    if ini is None:
        return None, None
    fim = len(linhas)
    for j in range(ini + 1, len(linhas)):
        ln = linhas[j]
        if ln.strip() and not ln[0].isspace():
            fim = j
            break
    # não leva junto as linhas em branco do rodapé da função
    while fim > ini + 1 and not linhas[fim - 1].strip():
        fim -= 1
    return ini, fim


def carregar_isolado(caminho):
    """Roda SÓ as partes de parsing do arquivo, num espaço separado.

    Importar o módulo inteiro executaria o que houver no topo dele — conexão
    com o Gmail, leitura de credencial — e o objetivo aqui é só conferir o
    parse_docname. Então percorre a árvore do arquivo e executa apenas os
    imports, as constantes e as funções, ignorando o resto.
    """
    import ast
    with open(caminho, encoding="utf-8") as fh:
        arvore = ast.parse(fh.read(), filename=caminho)

    ns = {"__name__": "_rh_conferencia"}
    for no in arvore.body:
        if not isinstance(no, (ast.Import, ast.ImportFrom, ast.Assign,
                               ast.AnnAssign, ast.FunctionDef)):
            continue
        try:
            exec(compile(ast.Module(body=[no], type_ignores=[]), caminho, "exec"), ns)
        except Exception:
            # constante que depende de algo que não carregamos: sem problema,
            # o parse_docname só precisa de re, MESES e _sem_acento.
            pass
    return ns


def conferir(caminho):
    """Testa o parse_docname já corrigido nos formatos que importam."""
    ns = carregar_isolado(caminho)
    parse_docname = ns.get("parse_docname")
    if parse_docname is None:
        print("  FALHOU  nao consegui carregar o parse_docname do arquivo")
        return False
    for dep in ("re", "MESES", "_sem_acento"):
        if dep not in ns:
            print(f"  FALHOU  o arquivo nao tem '{dep}', que o parse_docname usa")
            return False

    casos = [
        ("2026.07.JOSE NILSON ANTONIO LIMA.FERIAS", ("FERIAS", 2026, 7, None), "formato NOVO"),
        ("2026.06.29.JOVANE GATTO COSSUL.EPI",      ("EPI", 2026, 6, 29),      "formato NOVO com dia"),
        ("Folha_Julho-2026_Watila",                 ("FOLHA?", 2026, 7, None), "formato ANTIGO (folha)"),
        ("Recibo_EPI_Jovane_29-06-2026",            ("EPI", 2026, 6, 29),      "formato ANTIGO (EPI)"),
    ]
    tudo_ok = True
    for nome, esperado, rotulo in casos:
        obtido = parse_docname(nome)
        ok = obtido == esperado
        tudo_ok = tudo_ok and ok
        print(f"  {'OK  ' if ok else 'FALHOU'} {rotulo}: {nome}")
        if not ok:
            print(f"         esperado {esperado}, veio {obtido}")
    return tudo_ok


def procurar(nome=ALVO):
    """Procura o arquivo no computador. Devolve a lista do que achou.

    Olha primeiro onde é provável (pasta atual, pasta deste script, Área de
    Trabalho, Documentos, Downloads), e só depois varre o disco — pulando
    Windows e Program Files, onde ele não estaria."""
    achados, vistos = [], set()

    def registrar(p):
        try:
            real = os.path.realpath(p)
        except Exception:
            return
        if real not in vistos and os.path.isfile(real):
            vistos.add(real)
            achados.append(real)

    inicio = os.path.expanduser("~")
    provaveis = [
        os.getcwd(),
        os.path.dirname(os.path.abspath(__file__)),
        os.path.join(inicio, "Desktop"), os.path.join(inicio, "Área de Trabalho"),
        os.path.join(inicio, "Documents"), os.path.join(inicio, "Documentos"),
        os.path.join(inicio, "Downloads"),
        r"C:\RH", r"C:\Scripts", r"C:\rh-2", r"Y:\RH-2",
    ]
    for pasta in provaveis:
        registrar(os.path.join(pasta, nome))
    if achados:
        return achados

    print(f"Procurando o {nome} no computador (pode levar um minuto)...")
    pular = {"windows", "program files", "program files (x86)", "programdata",
             "$recycle.bin", "appdata", "node_modules", ".git", "onedrivetemp"}
    raizes = [inicio, "C:\\"] if os.name == "nt" else [inicio]
    for raiz in raizes:
        if not os.path.isdir(raiz):
            continue
        for pasta, subpastas, arquivos in os.walk(raiz, topdown=True):
            subpastas[:] = [d for d in subpastas
                            if d.lower() not in pular and not d.startswith(".")]
            if nome in arquivos:
                registrar(os.path.join(pasta, nome))
        if achados:
            break
    return achados


def main():
    aplicar = "--aplicar" in sys.argv
    caminho = None
    for a in sys.argv[1:]:
        if not a.startswith("--"):
            caminho = a

    if caminho is None:
        achados = procurar()
        if not achados:
            sys.exit(
                f"Nao achei o {ALVO} em lugar nenhum do computador.\n\n"
                f"Se voce sabe onde ele esta, passe a pasta:\n"
                f"    python aplicar_patch.py C:\\caminho\\{ALVO}\n\n"
                f"Para descobrir onde esta: abra o Explorador de Arquivos,\n"
                f"clique em 'Este Computador' e busque por {ALVO}.")
        if len(achados) > 1:
            print(f"Achei {len(achados)} arquivos com esse nome:\n")
            for i, p in enumerate(achados, 1):
                print(f"  {i}. {p}")
            sys.exit("\nEscolha qual e o certo e rode passando o caminho dele:\n"
                     f"    python aplicar_patch.py \"{achados[0]}\" --aplicar")
        caminho = achados[0]
        print(f"Achei: {caminho}\n")

    if not os.path.exists(caminho):
        sys.exit(f"Nao existe o arquivo: {caminho}")

    with open(caminho, encoding="utf-8") as fh:
        texto = fh.read()

    if "TIPOS_CONHECIDOS" in texto:
        print("O patch JA ESTA aplicado neste arquivo. Nada a fazer.\n")
        print("Conferindo mesmo assim:")
        sys.exit(0 if conferir(caminho) else 1)

    linhas = texto.splitlines(keepends=True)
    ini, fim = achar_funcao(linhas)
    if ini is None:
        sys.exit("Nao achei a funcao 'parse_docname' neste arquivo. "
                 "Confira se e mesmo o baixar_rh_email.py.")

    print(f"Achei o parse_docname nas linhas {ini + 1} a {fim} de {caminho}.")

    if not aplicar:
        print("\nSeria trocado por uma versao que aceita o formato novo E os antigos.")
        print("Nada foi gravado. Para aplicar de verdade:\n")
        print("    python aplicar_patch.py --aplicar\n")
        return

    backup = caminho + ".bak"
    shutil.copy2(caminho, backup)
    print(f"Copia de seguranca: {backup}")

    novo = "".join(linhas[:ini]) + FUNCAO_NOVA + "".join(linhas[fim:])
    with open(caminho, "w", encoding="utf-8") as fh:
        fh.write(novo)
    print("Funcao trocada.\n")

    print("Conferindo:")
    if conferir(caminho):
        print("\nTudo certo. Pode seguir para o deploy do Code.gs no Apps Script.")
    else:
        shutil.copy2(backup, caminho)
        sys.exit("\nAlgo saiu errado — DESFIZ a alteracao (o arquivo voltou ao "
                 "que era). Me avise antes de tentar de novo.")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
