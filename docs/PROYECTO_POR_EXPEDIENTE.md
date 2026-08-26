# Un proyecto de Claude por expediente

El montaje previsto para el despacho es:

```
Expedientes/                     ← la ÚNICA carpeta que se selecciona al instalar
├── Pérez - Divorcio/            ← un expediente (un cliente)
│   ├── demanda.pdf
│   └── prueba/…
├── Acme - Mercantil/            ← otro expediente
└── Gómez - Despido/             ← otro expediente
```

El abogado selecciona **la carpeta madre una sola vez**. Cada subcarpeta de primer
nivel es un expediente, se indexa sola, y los casos que añada después aparecen sin
volver a configurar nada.

Después crea **un proyecto de Claude por caso**. La pieza que falta es decirle al
proyecto en qué expediente trabaja: un proyecto de Claude es del lado del cliente y
el servidor MCP **no recibe nada de él** (el mecanismo del protocolo que servía para
esto, `roots`, está deprecado desde la versión `2026-07-28` de la especificación, y
en cualquier caso era orientativo, no una barrera). Se resuelve con una línea en las
instrucciones del proyecto.

## La línea que se pega en el proyecto

En **Instrucciones del proyecto**, en Claude:

```
Este proyecto es el expediente «Pérez - Divorcio».
Al empezar la conversación, llama a establecer_expediente_activo con
expediente="Pérez - Divorcio" antes de buscar en los documentos.
```

Sustituyendo el nombre por el de la subcarpeta del caso. No hace falta que coincida
exactamente con el nombre del disco: vale la ruta completa
(`Expedientes/Pérez - Divorcio`), solo el nombre de la carpeta (`Pérez - Divorcio`)
o su slug (`perez-divorcio`), sin tildes ni mayúsculas.

Si el despacho usa la skill `matter-workspace` de Robin Lawyer, esto ya lo hace ella
sola al abrir o cambiar de asunto, y no hay que pegar nada.

## Qué pasa si esa línea no está

No pasa nada malo, y ese es el punto: la búsqueda **falla de forma explícita** en vez
de buscar en todos los expedientes. El error trae la lista de expedientes disponibles,
así que Claude se lo pregunta al abogado y sigue. El modo inseguro no existe.

```
No hay expediente activo y no se ha indicado ninguno. RobinSearch no busca en todos
los expedientes a la vez […]
expedientes_disponibles: ["Expedientes/Acme - Mercantil", "Expedientes/Gómez - Despido",
                          "Expedientes/Pérez - Divorcio"]
```

## Cambiar de caso a mitad de conversación

Volver a llamar a `establecer_expediente_activo` con el otro expediente. El anterior
deja de estar al alcance en el acto: no hay mezcla ni "arrastre" del caso previo.
Para quedarse sin expediente activo (al cerrar un asunto),
`establecer_expediente_activo(limpiar=true)`.

## Si el abogado tiene los expedientes repartidos

Se pueden añadir varias carpetas madre; las subcarpetas de cada una siguen siendo
expedientes independientes. Y si su montaje es "una carpeta por caso" en vez de una
carpeta madre, `ROBIN_EXPEDIENTE_DEPTH=0` hace que cada carpeta vigilada sea, ella
misma, un expediente.

## Comprobarlo

`npm run test:aislamiento` levanta el servidor real sobre una carpeta madre con tres
casos y cruza cada caso contra el material de los otros dos por las cuatro vías de
lectura (buscar, listar, documento íntegro y fragmento suelto).
