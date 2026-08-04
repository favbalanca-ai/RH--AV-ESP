# ═══════════════════════════════════════════════════════════════════════════
# PATCH OBRIGATÓRIO em baixar_rh_email.py
#
# O app passou a nomear o documento do ZapSign no MESMO padrão do arquivo:
#     2026.07.JOSE NILSON ANTONIO LIMA.FERIAS
# em vez do antigo 'Folha_Julho-2026_Watila'.
#
# Sem este patch, o parse_docname devolve None para TODO documento novo e
# tudo cai em "REVISAR (nome não reconhecido)".
#
# Os formatos antigos continuam aceitos — o histórico de e-mails ainda tem
# 'Folha_...' e 'Recibo_EPI_...', e a janela padrão é de 45 dias.
#
# ➜ Substitua a função parse_docname inteira por esta.
# ═══════════════════════════════════════════════════════════════════════════

TIPOS_CONHECIDOS = {"RECIBO", "CONTRACHEQUE", "COMPROVANTE", "PONTO", "FERIAS", "EPI"}


def parse_docname(docname):
    """Do NOME DO DOCUMENTO do ZapSign deduz (tipo, ano, mes, dia).
    Retorna None se o padrão não for reconhecido (p/ revisar, não chutar).

    Formatos aceitos:
      NOVO (app >= 08/2026, já traz o tipo):
        2026.07.JOSE NILSON ANTONIO LIMA.FERIAS   -> (FERIAS, 2026, 7, None)
        2026.06.29.JOVANE GATTO COSSUL.EPI        -> (EPI,    2026, 6, 29)
      ANTIGOS (histórico):
        Folha_Julho-2026_Watila                   -> (FOLHA?, 2026, 7, None)
        Recibo_EPI_Jovane_29-06-2026              -> (EPI,    2026, 6, 29)
    """
    base = re.sub(r"\.pdf$", "", docname, flags=re.IGNORECASE)
    norm = _sem_acento(base)

    # ── NOVO: AAAA.MM[.DD].NOME COMPLETO.TIPO ──
    # Mesmo padrão do arquivo em Y:\RH-2, então o tipo vem pronto: dispensa o
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

    # ── ANTIGO: EPI ──
    #   novo:   Recibo_EPI_<Nome>_<DD-MM-AAAA>
    #   antigo: RECIBO EPI - <Nome> - <DD/MM/AAAA>
    if re.match(r"RECIBO[ _]EPI", norm):
        m = re.search(r"(\d{2})[-/](\d{2})[-/](\d{4})\s*$", base)
        if m:
            dia, mes, ano = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return ("EPI", ano, mes, dia)
        return None

    # ── ANTIGO: Folha_<Mês>-<Ano>_<Nome> ──
    # Nome genérico do app: podia ser RECIBO, PONTO ou FÉRIAS. Devolve a
    # família "FOLHA?" p/ o classifica_conteudo decidir pelo PDF.
    if norm.startswith("FOLHA_"):
        m = re.search(r"FOLHA_([A-ZÇ]+)-(\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("FOLHA?", int(m.group(2)), MESES[m.group(1)], None)
        return None

    if norm.startswith("PONTO"):
        m = re.search(r"([A-ZÇ]+)-(\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("PONTO", int(m.group(2)), MESES[m.group(1)], None)
        return None

    if norm.startswith("FERIAS"):
        m = re.search(r"([A-ZÇ]+)-(\d{4})", norm)
        if m and m.group(1) in MESES:
            return ("FERIAS", int(m.group(2)), MESES[m.group(1)], None)
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})", base)
        if m:
            return ("FERIAS", int(m.group(3)), int(m.group(2)), int(m.group(1)))
        return None

    return None
