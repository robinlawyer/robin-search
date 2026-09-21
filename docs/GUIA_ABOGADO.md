# RobinSearch — qué tiene que hacer el abogado

Cinco pasos, una vez. Después no hay que volver a tocar nada.

## 1. Instalar

Descargar `robin-search.mcpb` de `robinlawyer.ai/descargas` y hacer **doble clic**. Claude
Desktop abre su propio diálogo. **El mismo fichero vale para Mac y para Windows.**

## 2. Elegir la carpeta

El diálogo pide una carpeta. **Elige la carpeta que contiene todos tus expedientes** — la de
encima de los casos:

```
Expedientes/                  ← ESTA
├── Pérez - Divorcio/
├── Acme - Mercantil/
└── Gómez - Despido/
```

Desde la 1.3.3 no pasa nada si te equivocas de nivel: un expediente incluye lo que cuelga de
él. Si tienes los casos repartidos en varios sitios, puedes añadir más de una carpeta.

Lo que **no** hay que hacer: elegir el disco entero, o la carpeta personal. Se indexaría todo
lo que hay dentro, y tardaría horas de más para nada.

## 3. Cerrar Claude Desktop y volver a abrirlo

Sin esto la extensión no arranca. Es el paso que más se olvida.

## 4. Esperar al primer indexado

La primera vez hay que leer, trocear y calcular el índice de cada documento. **Cuenta unos
15 minutos por cada 200 páginas** en un portátil normal. Un expediente grande puede tardar
horas; se puede dejar en marcha y seguir trabajando.

Para saber si ha terminado, pregúntale a Claude: **«¿cuál es el estado de RobinSearch?»**.
Contesta con los documentos indexados, los expedientes detectados y, si algo va mal, la causa.

Después del primer indexado ya no hay espera: lo que añadas al expediente entra solo.

## 5. Iniciar sesión

La primera vez que busques se abre el navegador para entrar con tu cuenta de Robin Lawyer.
Una vez y se recuerda.

---

## Cómo se usa a partir de ahí

**Siempre desde el chat de Claude Desktop.** En las tareas de Cowork no está disponible.

Primero se dice **en qué caso se trabaja**, y después se pregunta:

> «Trabaja sobre el expediente Pérez - Divorcio.»
>
> «¿Qué dice el convenio regulador sobre la pensión de alimentos?»

Nunca busca en varios casos a la vez: cada expediente es un cliente distinto. Si no le has
dicho en cuál trabajas, te lo pregunta en vez de mezclar.

**No le pidas que "lea la carpeta C:\..."**: RobinSearch no le da a Claude acceso a tu disco
—ese es justamente su diseño—. Se le pide **buscar en el expediente**.

Un truco que ahorra repetirlo: crea **un proyecto de Claude por caso** y pon en las
instrucciones del proyecto una línea diciendo de qué expediente se trata. Ver
[PROYECTO_POR_EXPEDIENTE.md](PROYECTO_POR_EXPEDIENTE.md).

---

## Tu correo (opcional, desde la 1.7.0)

Si quieres, Robin también puede trabajar con tu buzón. Se conecta en la app de RobinSearch →
**Tu correo**: escribes tu dirección y tu contraseña una vez y ya está. **La contraseña se queda
en el llavero de tu ordenador** — no se la pide el chat, no la ve Claude y no llega a
RobinLawyer. Tus correos van de tu ordenador a tu proveedor, como cuando abres Outlook.

A partir de ahí:

> «¿Ha entrado algo nuevo de Suministros Vidal esta semana?»
>
> «Léeme ese y redáctame una respuesta rechazando el aumento, pero **no la envíes**: déjamela
> guardada.»

El borrador aparece en tu carpeta de Borradores, dentro de la conversación, listo para que lo
revises y lo mandes tú. **Eso es lo que hace por defecto: redactar.** Si además quieres que pueda
enviar, hay un interruptor en la app; aun así te pedirá confirmación cada vez.

Y los adjuntos los lee: el burofax, la factura o el escrito del juzgado que venga en el correo,
aunque sea un PDF escaneado. Basta con pedírselo:

> «Léeme el requerimiento que viene adjunto.»

Si venía escaneado te lo dirá, para que compruebes los importes y las fechas en el original.

Y si ese correo es del caso, puedes dejarlo **dentro del expediente**:

> «Guárdalo en el expediente.»

Antes de escribir nada te preguntará, con el remitente y el expediente en la misma frase —«¿Guardo
el correo «Requerimiento de pago», de Suministros Vidal, en el expediente «Pérez - Divorcio»?»—,
para que veas a tiempo si se ha equivocado de cliente. Se guarda el correo original (un `.eml`, se
abre con doble clic) en una carpeta **Comunicaciones** dentro del expediente, y desde ese momento
se busca junto al resto del caso: también por lo que decía el PDF que traía adjunto. Si ese
documento ya lo tenías guardado, aunque con otro nombre, te lo dice en vez de dejarte una copia
repetida; y nunca sobrescribe un fichero tuyo.

Lo que no hace: no vuelca el buzón entero al expediente (correo a correo, y preguntando), no borra
ni mueve nada, y no marca como leído lo que no has abierto tú.

Funciona con cualquier buzón que hable IMAP: tu propio proveedor, el servidor del despacho o
Gmail (con una contraseña de aplicación). **Y desde la 1.8.0 también Microsoft 365 y
Outlook.com**: Microsoft retiró la conexión con contraseña, así que ahí no se escribe ninguna —
se abre el navegador, entras en tu cuenta de Microsoft como siempre, y lo que queda en el llavero
de tu ordenador es un permiso que puedes retirar cuando quieras desde tu propia cuenta. Está todo
en [CORREO.md](CORREO.md).

---

## Revisar un expediente ENTERO (due diligence)

Buscar y revisar no son lo mismo. Cuando le preguntas algo, Claude trae los pasajes que
encajan con tu pregunta — rapidísimo, pero solo eso. Para una due diligence, donde lo que
importa es lo que **nadie sospechaba**, hay que decírselo así:

> «Haz un barrido completo del expediente Vega - Compraventa nave.»

Entonces recorre el expediente **entero**, trozo a trozo, y va dejando fichas de hechos. Al
terminar te dirá la cobertura («300 de 300»), y podrás pedirle la due diligence sobre todo lo
leído, o cosas como «enséñame todas las fechas de entrega que aparecen en el expediente».

Tres cosas que conviene saber:

- **Tarda.** Unas 90 vueltas por cada 2.000 páginas. Se puede parar y seguir otro día: no se
  pierde lo hecho.
- **Te dice lo que NO ha podido leer.** Los escaneados sin texto legible se declaran aparte.
  Si aparecen, hay que mirarlos a mano.
- **Si cambias un documento**, ese vuelve a estar pendiente. Los demás no se tocan.

---

## Si algo no va

Pregúntale a Claude **«¿cuál es el estado de RobinSearch?»**. La respuesta dice si el motor
está cargado, qué carpetas vigila, si son accesibles, cuántos documentos hay y —si el último
indexado falló— la causa agrupada, con un fichero de ejemplo.

Los tres fallos habituales:

| Síntoma | Causa | Solución |
| --- | --- | --- |
| «No puedo acceder a esa carpeta de tu ordenador» | estás en una tarea de Cowork | abre un chat normal |
| «No hay expediente activo» | no le has dicho el caso | dile en qué expediente trabajas |
| No encuentra un documento que existe | aún se está indexando, o es un escaneado sin texto | mira `estado_servidor` |
