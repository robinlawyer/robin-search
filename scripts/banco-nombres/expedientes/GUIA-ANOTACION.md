# Guía para escribir y anotar expedientes de prueba

Vas a escribir **expedientes completos de un despacho de abogados español**, tal como los tendría
un abogado en la carpeta del asunto: varios documentos por expediente (demanda, contestación,
informes, sentencias, correos con el cliente, chats, nóminas, atestados, actas…), con su extensión
real (de media página a tres o cuatro páginas cada uno), su jerga, su desorden y sus erratas.
Todo inventado: nombres, DNI, teléfonos, domicilios. Nada de personas reales.

Sirven para medir un filtro que, antes de mandar fragmentos de estos documentos a una IA, tapa
los datos personales (nombres, DNI, domicilios…) y **sobre todo los de categoría especial** (salud,
afiliación sindical, religión, ideología, origen étnico, vida u orientación sexual, datos genéticos
y biométricos, y los antecedentes penales), y deja en claro lo que el escrito necesita para seguir
siendo útil (juzgados, autos, normas, ECLI, organismos…).

**No mires ningún código ni ningún fichero fuera de tu carpeta de salida.** El valor de tu trabajo
es que escribes sin saber cómo funciona el filtro. Escribe como escribe la gente de verdad, no
pensando en «pillar» al filtro con trucos imposibles, pero tampoco simplificando: si un médico
escribiría «HTA y DM2 en tratamiento con metformina», escríbelo así.

## Qué tiene que tener, por encima de todo

**Categoría especial abundante y variada.** Es lo que más importa medir. En cada expediente,
muchos datos de salud y del resto del art. 9.1 RGPD, dichos de muchas maneras distintas:
diagnósticos técnicos y coloquiales («le dio un ictus», «está con la cabeza fatal desde lo del
divorcio», «toma pastillas para dormir»), abreviaturas clínicas (TEPT, TAG, EPOC, DM2, HTA, IAM,
TDAH, TEA, VIH+), nombres comerciales de fármacos y principios activos, pruebas (resonancia,
analítica, biopsia, test de embarazo…), secuelas, intervenciones quirúrgicas, salud mental,
adicciones, discapacidad y su grado, embarazo, lactancia, fecundación in vitro, interrupción del
embarazo, orientación sexual e identidad de género, religión y prácticas religiosas (ramadán,
velo, misa, testigo de Jehová que rechaza transfusión), afiliación sindical (delegado de CCOO,
cuota sindical en la nómina, comité de huelga), ideología o militancia política, origen étnico
(gitano, roma, bereber, afrodescendiente), datos genéticos (ADN, paternidad, portadora de
BRCA1), biométricos (huella, reconocimiento facial), y antecedentes penales. Mezcla los que son
el **objeto** del asunto con los que aparecen **de pasada** y los de **terceros** (testigos,
vecinos, compañeros, familiares).

Varía la lengua y la forma: algún documento en catalán, gallego o euskera si el expediente lo
pide; correos informales del cliente con faltas; chats de WhatsApp; un escaneo (en MAYÚSCULAS y
sin tildes, como sale de un OCR malo); tablas de nóminas; informes médicos con su formato
(antecedentes, exploración, juicio clínico, tratamiento).

## Ficheros que entregas

Una carpeta por expediente (`<tu-carpeta>/<slug-del-expediente>/`), y dentro:

1. **Un `.txt` por documento**, nombrado `NN-descripcion.FORMATO.txt`, donde FORMATO dice cómo
   lo convertiremos después:
   - `docx` — escrito de Word (demandas, contestaciones, recursos, informes del despacho)
   - `pdf` — PDF con texto (sentencias, autos, resoluciones administrativas, informes médicos)
   - `escaneo` — PDF escaneado: escríbelo YA en MAYÚSCULAS, sin tildes, con algún error de OCR
     («0» por «O», «l» por «1», palabras partidas). Uno o dos por expediente, no más.
   - `whatsapp` — exportación de WhatsApp, con líneas `dd/mm/aa, hh:mm - Nombre: mensaje`
   - `eml` — correo electrónico. Empieza con cabeceras `De:`, `Para:`, `Fecha:`, `Asunto:`,
     una línea en blanco y el cuerpo (con firma).
2. **`oro.json`**, con la anotación de cada documento:

```json
{
  "01-demanda.docx.txt": {
    "oro": [
      ["PERSONA", "María Luisa Ferrán Gil"],
      ["CAT_ESPECIAL", "trastorno depresivo mayor", "salud"],
      ["OBJETO", "incapacidad permanente absoluta"]
    ],
    "ambiguo": []
  }
}
```

## Cómo se anota

Cada entrada es `[TIPO, "literal exacto"]` (y para `CAT_ESPECIAL` un tercer elemento con la
subcategoría). **El literal tiene que aparecer tal cual en el texto**, carácter a carácter
(comillas, tildes, mayúsculas). Basta con anotarlo una vez: cuenta para todas sus apariciones en
ese documento. Por eso un mismo literal no puede tener dos tipos en el mismo documento; si una
misma expresión es objeto en un sitio y dato de un tercero en otro, anota el trozo más largo que
la distingue en cada caso («el embarazo de su compañera Lucía» frente a «su embarazo»).

Anota TODO lo que haya de cada tipo. Lo que no anotes y el filtro tape contará como tapado de más;
lo que anotes mal contará como fallo del filtro.

### Lo que hay que TAPAR

| tipo | qué es |
|---|---|
| `PERSONA` | cualquier persona física que no sea juez, magistrado o LAJ: partes, testigos, familiares, abogados, procuradores, fiscales, médicos, trabajadores, vecinos… **Cada mención por separado**: nombre completo, apellido solo («el Sr. Ferrán»), nombre de pila solo («Marisa»), mote o hipocorístico («la Mari», «Txema»), y en mayúsculas si va así. No anotes el tratamiento («D.», «Sra.»), solo el nombre. |
| `PERITO` | un perito con nombre (médico, psicólogo, calígrafo, tasador) |
| `AGENTE` | un policía o guardia civil identificado por su nombre |
| `DIRECCION` | el domicilio de una persona o el lugar concreto que la identifica: calle y número, piso, código postal, urbanización, partida rural, «el 3.º B de la calle Mayor». Una ciudad o un barrio sueltos no. |
| `DNI`, `NIE`, `CIF`, `IBAN`, `TELEFONO`, `CORREO`, `MATRICULA`, `NUSS` | identificadores (NUSS = n.º de afiliación a la Seguridad Social; también n.º de historia clínica o de tarjeta sanitaria: anótalos como `NUSS`) |
| `CAT_ESPECIAL` | dato de categoría especial (ver abajo). Subcategoría: `salud`, `sindical`, `religion`, `politica`, `etnia`, `sexual` (vida u orientación sexual e identidad de género), `genetico`, `biometrico` |
| `DATO_PENAL` | antecedentes penales, condenas, detenciones o causas de una persona, cuando NO son el objeto del escrito |

### Lo que NUNCA se tapa (anótalo también: mide si el filtro tapa de más)

| tipo | qué es |
|---|---|
| `ORGANO` | juzgados, tribunales, salas, secciones, plazas, con su sede |
| `AUTOS` | número de procedimiento, de recurso, de expediente judicial o administrativo, NIG |
| `ECLI`, `ROJ` | identificadores de resoluciones |
| `NORMA` | leyes, artículos, reales decretos, sentencias citadas por fecha y número |
| `ORGANISMO` | administraciones, hospitales y centros de salud como institución, INSS, SEPE, mutuas, colegios profesionales, sindicatos y partidos como organización cuando NO revelan la afiliación de nadie («el comité de empresa», «la Inspección de Trabajo») |
| `PONENTE` | juez, magistrado o ponente que firma o dicta la resolución |
| `LAJ` | Letrado de la Administración de Justicia y personal de la oficina judicial |
| `TIP` | el número profesional de un agente (TIP, carné) |
| `OBJETO` | el dato sensible que es el **objeto directo** del escrito para la propia parte (ver abajo) |

Opcional: `PERIFRASIS` para una descripción que identifica a alguien sin nombrarlo («el único
farmacéutico del pueblo», «la administradora de la mercantil del polígono»). No se espera que el
filtro la tape; sirve para contarlas.

### La categoría especial: qué se tapa y qué pasa en claro

Es un criterio jurídico ya decidido; aplícalo con cuidado, porque es lo que se mide:

1. **Se tapa todo dato de categoría especial**, y en la duda, se tapa. Incluye: diagnósticos,
   síntomas, secuelas, pruebas y resultados, tratamientos y fármacos, intervenciones, ingresos y
   bajas médicas, documentos clínicos nombrados como tales («informe de alta», «historia clínica»,
   «parte de baja»), la discapacidad **y su grado** («33 %»), el embarazo, las adicciones, la salud
   mental; la afiliación sindical y los cargos sindicales de una persona; la religión y sus
   prácticas; la ideología o militancia; el origen étnico o racial (la nacionalidad o el país de
   nacimiento NO: «nacido en Nador (Marruecos)» no se anota); la orientación sexual, la vida sexual
   y la identidad de género; los datos genéticos y biométricos.
2. **El dato que es el objeto directo del escrito, para la propia parte, pasa en claro**: anótalo
   como `OBJETO`. Ejemplos: «solicita la **incapacidad permanente absoluta**», «el despido es nulo
   por el **embarazo** de la trabajadora», «se discute la **ludopatía** del padre como causa de la
   modificación de medidas», «la **objeción de conciencia** que fundamenta el recurso», «solicita
   la cancelación de sus **antecedentes penales**», el delito por el que se recurre la condena.
   Solo la calificación o el hecho que se litiga; **el detalle clínico que lo acompaña se tapa
   siempre** («incapacidad permanente total derivada de **lumbalgia crónica con radiculopatía
   L5-S1**»: la incapacidad es OBJETO, la lumbalgia es CAT_ESPECIAL).
3. **Si el dato es de un tercero** (testigo, cónyuge, vecina, compañero…), se tapa aunque tenga
   que ver con el pleito: `CAT_ESPECIAL` (o `DATO_PENAL`).
4. **Si el escrito dice expresamente que algo «no es objeto de este pleito»** o no se discute,
   ese dato se tapa: `CAT_ESPECIAL`.
5. **Antecedentes penales**: `DATO_PENAL`, salvo que sean el objeto (el hecho a probar, el motivo
   del recurso, la reincidencia que se discute, su cancelación). En una reagrupación o un arraigo
   se dice que hay o no hay antecedentes; el delito concreto, si aparece, es `DATO_PENAL`.
6. Anota el **tramo completo** del dato («trastorno de ansiedad generalizada con insomnio de
   conciliación», «en tratamiento con sertralina 50 mg y lorazepam»), no solo una palabra suelta.
   Un nombre de hospital o servicio («Servicio de Psiquiatría del Hospital Clínico») es
   `ORGANISMO`, no categoría especial.

### `ambiguo`

Lista de literales de persona que en ese documento podrían ser de dos personas distintas (dos
hermanos que comparten apellido y se menciona el apellido a secas). Normalmente vacía.

## Antes de entregar

Comprueba que cada literal aparece en su documento (desde tu carpeta):

```bash
python3 - <<'EOF'
import json, glob, os
for oro in glob.glob('*/oro.json'):
    d = os.path.dirname(oro); data = json.load(open(oro))
    for f, v in data.items():
        t = open(os.path.join(d, f)).read()
        for e in v['oro']:
            if e[1] not in t: print('NO APARECE', oro, f, e)
        if not os.path.exists(os.path.join(d, f)): print('FALTA', f)
    for f in os.listdir(d):
        if f.endswith('.txt') and f not in data: print('SIN ANOTAR', d, f)
print('ok')
EOF
```
