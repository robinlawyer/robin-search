#!/usr/bin/env python3
"""Convierte una ronda de expedientes de prueba (los .FORMATO.txt + oro.json que escriben los
redactores ciegos) en ficheros DE VERDAD, como los tendría un abogado en su carpeta:

    docx      → Word (un párrafo por línea)
    pdf       → PDF con texto
    escaneo   → PDF con texto en MAYÚSCULAS (lo que deja un OCR malo)
    whatsapp  → .txt de exportación de WhatsApp, tal cual
    eml       → correo MIME (.eml) con sus cabeceras

    python3 construir.py ronda-1 ronda-1-ficheros

Escribe en la carpeta de destino una subcarpeta por expediente (`<redactor>-<slug>`) y, fuera de
ella, `<destino>.oro.json` con la anotación indexada por la ruta relativa del fichero final. La
anotación NO va dentro de la carpeta de expedientes: la medición la lee aparte.
"""
import json
import os
import re
import sys
from email.message import EmailMessage
from email.utils import format_datetime, parsedate_to_datetime
from datetime import datetime, timezone

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from xml.sax.saxutils import escape

FUENTES = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
]
for f in FUENTES:
    if os.path.exists(f):
        pdfmetrics.registerFont(TTFont('Texto', f))
        break
else:
    sys.exit('No encuentro una fuente TTF con tildes')

ESTILO = ParagraphStyle('t', fontName='Texto', fontSize=10.5, leading=14)


def a_pdf(texto, destino):
    doc = SimpleDocTemplate(destino, pagesize=A4, leftMargin=2.5 * cm, rightMargin=2.5 * cm,
                            topMargin=2.5 * cm, bottomMargin=2.5 * cm)
    piezas = []
    for linea in texto.split('\n'):
        if linea.strip():
            piezas.append(Paragraph(escape(linea), ESTILO))
        else:
            piezas.append(Spacer(1, 7))
    doc.build(piezas)


def a_docx(texto, destino):
    d = Document()
    for linea in texto.split('\n'):
        d.add_paragraph(linea)
    d.save(destino)


CAB = re.compile(r'^(De|Para|CC|Cc|Fecha|Asunto|From|To|Date|Subject)\s*:\s*(.*)$')


def a_eml(texto, destino):
    lineas = texto.split('\n')
    cab = {}
    i = 0
    while i < len(lineas) and lineas[i].strip():
        m = CAB.match(lineas[i].strip())
        if not m:
            break
        cab[m.group(1).lower()] = m.group(2)
        i += 1
    cuerpo = '\n'.join(lineas[i:]).lstrip('\n')
    msg = EmailMessage()
    msg['From'] = cab.get('de') or cab.get('from') or ''
    msg['To'] = cab.get('para') or cab.get('to') or ''
    if cab.get('cc'):
        msg['Cc'] = cab['cc']
    msg['Subject'] = cab.get('asunto') or cab.get('subject') or ''
    try:
        msg['Date'] = format_datetime(parsedate_to_datetime(cab.get('fecha', '')))
    except Exception:
        msg['Date'] = format_datetime(datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc))
    # El extractor de .eml solo lee el cuerpo: las cabeceras (remitente, destinatario) se repiten
    # al principio del cuerpo como hace cualquier cliente al reenviar, para que se midan también.
    resumen = '\n'.join(f'{k.capitalize()}: {v}' for k, v in cab.items())
    msg.set_content(f'{resumen}\n\n{cuerpo}' if resumen else cuerpo)
    with open(destino, 'wb') as fh:
        fh.write(bytes(msg))


def main():
    origen, destino = sys.argv[1], sys.argv[2]
    os.makedirs(destino, exist_ok=True)
    oro_final = {}
    for redactor in sorted(os.listdir(origen)):
        dr = os.path.join(origen, redactor)
        if not os.path.isdir(dr):
            continue
        for slug in sorted(os.listdir(dr)):
            de = os.path.join(dr, slug)
            if not os.path.isdir(de):
                continue
            oro = json.load(open(os.path.join(de, 'oro.json'), encoding='utf-8'))
            exp = f'{redactor}-{slug}'
            os.makedirs(os.path.join(destino, exp), exist_ok=True)
            for fichero, anot in sorted(oro.items()):
                texto = open(os.path.join(de, fichero), encoding='utf-8').read()
                m = re.match(r'^(.*)\.(docx|pdf|escaneo|whatsapp|eml)\.txt$', fichero)
                if not m:
                    sys.exit(f'Nombre de fichero sin formato: {de}/{fichero}')
                base, fmt = m.groups()
                if fmt == 'docx':
                    final = f'{base}.docx'
                    a_docx(texto, os.path.join(destino, exp, final))
                elif fmt in ('pdf', 'escaneo'):
                    final = f'{base}.pdf'
                    a_pdf(texto, os.path.join(destino, exp, final))
                elif fmt == 'whatsapp':
                    final = f'{base}.txt'
                    open(os.path.join(destino, exp, final), 'w', encoding='utf-8').write(texto)
                else:
                    final = f'{base}.eml'
                    a_eml(texto, os.path.join(destino, exp, final))
                oro_final[f'{exp}/{final}'] = {**anot, 'formato': fmt}
    with open(destino.rstrip('/') + '.oro.json', 'w', encoding='utf-8') as fh:
        json.dump(oro_final, fh, ensure_ascii=False, indent=1)
    print(f'{len(oro_final)} documentos en {destino}')


if __name__ == '__main__':
    main()
