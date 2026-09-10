# Barrido exhaustivo — due diligence sobre lo que no cabe en el contexto

## El problema

Un expediente de 40.000 páginas son unos **48 millones de tokens**. El contexto de un modelo
son 200.000, o un millón en las versiones largas. **Cabe el 2 %, como mucho.**

`buscar_documentos` resuelve esto para *encontrar*: se le pregunta y trae los pasajes que se
parecen a la pregunta, de un expediente de cualquier tamaño. Pero una due diligence no vale
por lo que preguntas: vale por **lo que no se te ocurrió preguntar**. Una contradicción entre
el anexo 12 de un contrato y un correo de 2019 no se parece a ninguna pregunta. Para verla hay
que haber leído los dos.

## La solución: dos fases

```
1. BARRIDO                              2. SÍNTESIS
   ventana → leer → ficha de hechos        fichas (≈1 % del volumen) → cruzar → due diligence
   ~22 páginas cada una                    40.000 páginas → ~540.000 tokens: SÍ caben
```

Cada ventana del expediente se lee **entera, una sola vez**, y deja una ficha de hechos con su
página. La revisión final se hace sobre las fichas.

## Las tres herramientas

| Tool | Qué hace |
| --- | --- |
| `siguiente_por_revisar` | Devuelve el siguiente trozo que **nadie ha leído**, con su texto y el progreso. |
| `anotar` | Guarda la ficha de hechos de ese trozo. |
| `obtener_anotaciones` | Devuelve las fichas para la síntesis, con vista cruzada por campo. |

Se usan **en bucle**: `siguiente_por_revisar` → `anotar` → `siguiente_por_revisar` → … hasta
que `completado` sea `true`.

## Lo que hace que funcione

**El estado vive en disco, no en la conversación.** Un barrido de 1.800 ventanas no cabe en un
solo chat. El servidor lleva la cuenta de qué se ha revisado (`anotaciones.json`, en el
directorio de datos, nunca en la carpeta del expediente), así que **el barrido se reanuda solo**
aunque se cierre Claude a mitad.

**La ficha son hechos, no un resumen.** «Este documento trata de un contrato de obra» no
permite detectar nada. `anotar` pide listas de hechos —fechas, importes, obligaciones,
cláusulas atípicas y sobre todo **afirmaciones**— cada uno con su página. Cruzar «plazo de
entrega: 30/06/2024» con «plazo de entrega: 15/09/2024» hace saltar la contradicción sin que
nadie haya preguntado por fechas de entrega.

**La cobertura se declara siempre.** Toda respuesta de `obtener_anotaciones` lleva por delante
cuántas ventanas hay revisadas de cuántas. Si el barrido está a medias, lo dice y advierte de
que las conclusiones cubren solo esa parte. Y los documentos **que no se han podido leer**
—escaneados sin texto legible— se declaran como zona ciega en el mismo sitio donde se anuncia
el 100 %. Una revisión que se calla 300 escaneados no es una revisión completa.

**Se invalida solo.** Si un documento cambia en disco, sus fichas dejan de valer y sus ventanas
vuelven a estar pendientes — mismo sello (`size` + `mtime`) que usa el indexado incremental.
Las fichas de los documentos intactos no se tocan.

**El aislamiento por expediente se mantiene.** El barrido nunca sale del expediente activo.

## La vista que encuentra las contradicciones

```
obtener_anotaciones({ agrupar_por: "afirmaciones" })
```

Devuelve todas las afirmaciones de **todo** el expediente, con su documento y su página, una
debajo de otra. Campos cruzables: `afirmaciones`, `fechas`, `importes`, `partes`,
`obligaciones`, `clausulas_atipicas`, `alertas`.

## Lo que sigue sin resolver

**La compresión tiene pérdida.** Lo que la ficha no capture, no existe para la síntesis. Se
mitiga con el puntero al original (`doc_id` + página) para volver a leer lo que la síntesis
marque como dudoso, pero es una decisión tomada de antemano sobre qué es relevante.

**Cuesta.** Leer 40.000 páginas una vez son ~48 millones de tokens de entrada, y los paga la
suscripción del abogado. Para 2.000 páginas son ~2,4 millones y unas 90 iteraciones:
perfectamente asumible. Para 40.000, ~1.800 iteraciones: eso es un proceso que abarca varias
sesiones, no una conversación.

## Comprobarlo

`npm run test:barrido` levanta el servidor real sobre un expediente con una contradicción
plantada en dos documentos distintos y un escaneado sin texto, y verifica las dos mitades de la
promesa: que cada ventana se sirve exactamente una vez sin saltos ni repeticiones, y que la
contradicción aparece en la vista cruzada sin que nadie haya preguntado por ella.
