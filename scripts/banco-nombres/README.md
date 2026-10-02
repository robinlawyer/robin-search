# Anonimizador local — v1 sin modelo

El filtro que se pone entre RobinSearch y Claude: lo que sale de los documentos del despacho sale
con alias, y la tabla que los revierte no sale nunca del ordenador del abogado.

**No toca `server/`.** Nada de esto está enchufado al producto todavía. Cuando se enchufe va en un
solo sitio: el `setRequestHandler(CallToolRequestSchema, …)` de `server/index.js`, por donde pasan
las tools antes de volver a Claude (filtro de salida), y el de entrada antes de buscar o de escribir
un borrador (rehidratación).

## Decisiones cerradas con Juan

- **21-sep.** Seudonimización, no anonimización (art. 4.5 y cdo. 26 RGPD). Borrador con los nombres
  reales en la carpeta del abogado, no botón en la app. Promesa acotada a los documentos. Lista de
  intocables fundada en lo que el escrito necesita para ser válido y lo que ya es público en el
  procedimiento. Categoría especial: en la duda, se tapa; el resto: en la duda, pasa. Reconocimiento
  en la respuesta, no en el índice.
- **26-sep.** **Sin modelo en la v1**: el modelo ponía un dato de cada noventa a cambio de 31 MB de
  instalador y casi 7 s por respuesta. Si al medir con expedientes reales aparece un patrón de fuga
  distinto, entra en una v1.1 con esos datos encima de la mesa. Las nueve dudas de categoría
  especial, resueltas: ver `anexo-categoria-especial.md`. Y la medición, en local, con expedientes
  cerrados y sin que ningún documento salga de la máquina: ver «Medir con expedientes reales».

## Cómo se corre

```bash
npm run test:anonimizador     # los invariantes. Sin red, un par de segundos.
npm run banco:nombres-reglas  # el banco de la v1 sobre los cinco corpus. Sin red.
npm run banco:nombres         # + los candidatos de modelo (solo para una v1.1). Descarga ~615 MB.
npm run medir:reales -- --carpeta "/ruta/expedientes cerrados"   # ver abajo
```

## Las capas

El orden importa. La 1 manda sobre todas; entre las demás gana la de menor número y, entre
personas y domicilios, el trozo más largo.

| # | capa | qué coge |
|---|---|---|
| 1 | **guardia de intocables** (`intocables.mjs`) | órganos y su sede (en las cuatro lenguas, Tribunales de Instancia incluidos), autos, ECLI, ROJ, normas, organismos, ponente, LAJ y oficina judicial por su fórmula de firma, agente por su TIP |
| 2 | **deterministas** (`deterministas.mjs`) | DNI, NIE, CIF, IBAN (con dígito de control), teléfono en cualquier agrupación, correo, matrícula, NAF, DNI enmascarados |
| 3 | **propagación** (`alias.mjs`) | lo ya visto en el expediente: nombres y sus variantes, y calles ya vistas dichas a secas |
| 4 | **personas por contexto** (`personas.mjs`, `texto.mjs`, `nombres-de-pila.mjs`) | tratamiento y cargo, saludos y firmas, cabeceras de correo, etiquetas de ficha, nombre completo sin presentar, nombre de pila del léxico (solo o con apellidos), relación («mi cuñado Toño»), vocativo, edad, mote, «APELLIDOS, Nombre», nombres chinos, apellidos que hacen de sujeto |
| 5 | **domicilios y categoría especial** (`domicilios.mjs`, `especiales.mjs`, `objeto.mjs`) | la dirección por su estructura; salud, sindical, religión, política, etnia, orientación sexual, genéticos y los antecedentes penales (`DATO_PENAL`), con el **criterio de fondo** de Juan para el objeto del escrito |
| 6 | ~~el modelo~~ | **no va en la v1**. `ner.mjs` y `candidatos.mjs` quedan solo para que el banco pueda volver a medirlo |

Todas las reglas miden el texto **como lo deja el indexador**: `chunkPages` une las palabras con un
espacio, así que en producción no hay saltos de línea. El banco mide siempre las dos formas.

## Resultados, sin maquillar

| corpus | qué es | 1.ª pasada | hoy |
|---|---|---|---|
| trabajo (44 fragmentos) | escrito por mí; contra él se afinaron las reglas | 99,4 % | 100 % |
| validación (24) | escrito por mí después, «a ciegas» de mis propias reglas | 97,8 % | 100 % |
| **ciego 1** (40) | escrito por otro agente sin ver las reglas (29-sep) | **73,8 %** | 100 % |
| **ciego 2** (40) | otro agente, sin ver reglas ni corpus, tipos de documento nuevos | **76,7 %** | 100 % |
| **ciego 3** (44) | ídem, escrito después de cerrar el 2 | **81,1 %** | 100 % |

**El número honesto es la primera pasada de cada corpus ciego**: lo que el filtro hace con
documentos que nadie ha mirado para afinarlo. Los informes de esas primeras pasadas están guardados
tal cual (`informe-ciego-primera-pasada.txt`, `informe-ciego2-primera-pasada.txt`,
`informe-ciego3-primera-pasada.txt`). La tendencia: 74 → 77 → 81 %. Por familias, en el tercero: personas
91 %, identificadores 99 %, domicilios 76 %, **categoría especial 48 %**. La categoría especial es
vocabulario abierto y es donde más falla lo que nadie ha visto: es lo primero que hay que mirar en la
medición con expedientes reales. La columna «hoy»
ya no mide generalización: mide que lo arreglado sigue arreglado.

En todos los corpus y en las dos formas del texto: **0 fusiones** (dos personas con el mismo alias),
**0 textos rotos** a la ida y vuelta, **0 intocables tapados**.

Latencia de la v1: ~10 ms por fragmento, ~0,6 s por una respuesta de 60 fragmentos (el techo de
`obtener_documento`), ~50 ms por una búsqueda normal de 5. Sin modelo, sin descarga, sin binario.

## Medir con expedientes reales

Lo que pidió Juan el 26-sep: en local, sobre expedientes cerrados, sin que ningún documento salga de
la máquina. `medir-reales.mjs`:

1. **La red se corta por el sistema.** En macOS la medición se relanza dentro de `sandbox-exec` con
   la red denegada, y antes de leer un documento comprueba que una conexión falla (si no falla,
   aborta). Además anula `fetch`, `http`, `https`, `net`, `tls`, `dns` y `dgram` dentro del proceso.
2. **Por pantalla solo cifras.** El texto (la página de revisión y el detalle) se escribe en una
   carpeta de salida que no puede estar dentro de la de expedientes.
3. **Extrae y trocea como el indexador** (`server/indexer/extract.js` y `chunk.js`), y anonimiza en
   respuestas de 60 fragmentos, igual que en producción.
4. **Comprueba solo**: fugas de tabla (un valor tapado en un sitio y en claro en otro), ida y vuelta,
   latencia real. Tienen que salir a 0.
5. **Pone delante de quien revisa** las sospechas (secuencias con pinta de nombre, números con pinta
   de DNI o teléfono sin tapar) y una **muestra a ciegas** de fragmentos sin sospechas, en una página
   local (`revision.html`) que no se conecta a nada: se marca «escape real», «no es dato», «sobra»,
   o se selecciona con el ratón lo que se ha escapado y se le pone categoría.
6. **`--resultado`** da la cobertura, el tapado de más y los escapes **por categoría** (nombre sin
   presentar, perífrasis, apellido que es institución, OCR roto…), que es el patrón de fuga que
   decide si hace falta una v1.1. `marcas.json` y `resultado.json` no llevan texto.
7. **`--borrar`** elimina todo lo que lleva texto y deja solo `resultado.json`.

Opcional: `--segunda-opinion` pasa también el modelo pequeño, **solo desde la copia local y sin
red**, para señalar nombres que las reglas no cubren. No tapa nada.

## Los límites, dichos en voz alta

- **Las perífrasis no las coge nadie.** «El administrador único de la mercantil del polígono de
  Alcobendas» identifica a una persona y no hay nada que tachar.
- **Los corpus los hemos escrito nosotros**, con nombres inventados. Hasta medir con expedientes
  reales, ningún número de esta página se promete por escrito.
- **Un nombre de pila que no está en el léxico, solo y sin contexto** («Nel dijo que…») se escapa.
  Con edad, relación, saludo, cabecera o apellido detrás, no.
- **El orden de las respuestas importa en un caso**: si «Pérez Alcaraz» sale antes que los dos
  hermanos Pérez Alcaraz, se le da el alias del primero que aparezca después. Dentro de una misma
  respuesta, no pasa (hay pasada previa).


## 2-oct — Expedientes completos (lo que pidió Juan el 30-sep)

Juan: «lo primero que mires con expedientes reales es la categoría especial; si ahí el número no sube,
no enchufamos nada». En lugar de los expedientes cerrados de Eduardo, expedientes **completos escritos a
ciegas** por redactores que no ven el filtro (guía: `expedientes/GUIA-ANOTACION.md`, solo el criterio
jurídico), convertidos en ficheros de verdad (`expedientes/construir.py`: Word, PDF, escaneo, correo .eml,
WhatsApp) y medidos con el **mismo extractor y el mismo troceado** que RobinSearch:

```bash
python3 expedientes/construir.py expedientes/ronda-N expedientes/ronda-N-ficheros
npm run medir:expedientes -- --carpeta expedientes/ronda-N-ficheros --informe X.txt --json X.json
```

Red cortada por el sistema igual que `medir:reales`; los datos que caen en la frontera de dos
fragmentos se miden también (es lo que de verdad llega partido a Claude); nueva métrica: **% de
caracteres que no son dato y se tapan**.

| ronda | qué | cat. especial 1.ª pasada | hoy |
|---|---|---|---|
| 1 (92 docs, 12 expedientes) | ciega, filtro del 29-sep | **9,5 %** | 81,5 % |
| 2 (95 docs, 12 expedientes) | ciega, escrita después de arreglar la 1 | **61,7 %** | 80,3 % |
| 3 (89 docs, 12 expedientes) | ciega, después de arreglar la 2 | **67,6 %** | 80,1 % |
| 4 (46 docs, 6 expedientes) | ciega, después de arreglar la 3 | **64,4 %** | 72,9 % |

322 documentos, 14.760 anotaciones. **La primera pasada ciega se ha estancado en dos tercios**: cada
ronda trae vocabulario nuevo y perseguirlo sube las rondas conocidas, no la siguiente. Auditoría
independiente de 150 «escapadas» de la ronda 3: 64 fuga real, 52 leve, 34 no lo eran. Personas 91-97 %,
identificadores 95-99 %, 0 textos rotos a la ida y vuelta, 1-3 fusiones por ronda (hermanos que
comparten apellido). Latencia: 17 ms/fragmento, 1,0 s por respuesta de 60.

Por qué el 9,5 %: el filtro tapaba el TÉRMINO («cardiopatía isquémica») y dejaba en claro la frase que
lo cuenta. Los expedientes reales traen informes clínicos enteros, chats, nóminas, cuatro lenguas.

### Lo nuevo

- **El tramo sensible** (`anonimizador/tramos.mjs`): el segmento de frase con un disparador de 9.1 o un
  antecedente se tapa entero, menos la guardia, el objeto del escrito y lo que ya lleva su alias. En un
  informe clínico denso (≥7 disparadores/100 palabras) se tapa todo salvo rótulos, fechas, nombres e
  instituciones. Léxicos en castellano, catalán, gallego y euskera, técnicos y de calle; siglas y cifras
  con unidad; sombra del texto sin tildes y con el OCR deshecho.
- **Identificadores**: DNI con la letra mal o del OCR, pasaporte, zona MRZ, historia clínica, tarjeta
  sanitaria, NUHSA, CIP, TSI… con su etiqueta.
- **Personas**: firmas aplanadas, remitentes de chat, artículo + nombre, iniciales, fichas; puerta
  `pareceNombreDePersona` (lugares e instituciones ya no entran en la tabla).
- **Guardia**: «n.º» (no se reconocía), citas abreviadas, gallego, siglas sanitarias, procedimientos.

### Pendiente de Juan: el criterio extendido

Juan cerró el criterio de fondo para incapacidad, embarazo, adicciones y antecedentes. Extenderlo a
**afiliación sindical** (tutela sindical), **orientación sexual** (asilo), **origen étnico**
(discriminación), **discapacidad** (medidas de apoyo) y **la patología cuya ocultación o retraso
diagnóstico es el pleito** está escrito y medido, pero **apagado** (`ROBIN_CRITERIO_EXTENDIDO=1`):
es decisión jurídica suya. Mientras tanto, se tapan.

### Límites, dichos en voz alta (2-oct)

- La categoría especial dicha sin ningún término reconocible («se pierde», «ya no puede ni abrir un bote»)
  es cola larga: se escapa a veces. Es la familia que manda en lo que queda.
- Tapar el tramo tapa también el marco de la frase: fuera de los informes clínicos se tapa un 11 % del
  texto que no es dato (auditoría independiente: es relleno, no datos que salgan).
- Discrepancia conocida con el corpus ciego 3: «Unidad de Conductas Adictivas de Vigo» se tapa dentro de
  un dato (regla del 29-sep), el anotador la quería en claro.
