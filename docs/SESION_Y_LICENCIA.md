# Sesión y licencia de RobinSearch (desde la 1.12.0)

Criterio (Juan, 8-oct-2026, caso Pedro): **un abogado que solo abre Claude, sin abrir nunca
RobinDesktop, debe poder trabajar con RobinSearch durante meses sin que nada se rompa.**
RobinDesktop queda para lo suyo (configuración, licencias, facturación, actualizaciones, panel).

## Qué decide si RobinSearch se puede usar

Un **certificado de licencia** firmado por RobinLawyer.ai (Ed25519) y guardado en el ordenador
(`licencia.json`). RobinSearch lo comprueba **sin red** con la clave pública que lleva dentro
(`server/auth/licencia.js`). Contiene: titular, despacho, plan, estado de la licencia, si da derecho
de uso, `valido_hasta` y los días de gracia.

| Situación | Qué pasa |
|---|---|
| Certificado vigente (30 días desde que se emite) | Todo funciona, con o sin red. |
| Vencido porque no se ha podido renovar (sin red) | 30 días más de **gracia**; el chat avisa de la acción exacta. |
| La licencia ha terminado (fin de la demo, sin pagar) | No hay gracia: el certificado ya lleva esa fecha. Mensaje claro. |
| El titular desconecta el equipo en /devices | En cuanto RobinSearch vuelve a hablar con el servidor, borra el certificado. |

Las herramientas son 100 % locales (expedientes, índice, anotaciones, **correo por IMAP/SMTP**):
ninguna usa la sesión para nada, así que todas dependen solo del certificado. Esto no envía nada
nuevo al servidor; solo cambia cuándo se comprueba la licencia.

## La sesión se mantiene sola

- **Al arrancar** (a los 10 s, para no gastar la llave en la sonda que Claude lanza y mata) **y cada
  24 h**: si a la llave de acceso le quedan menos de 12 h se renueva, por la conexión de salida,
  sin navegador ni puertos; si toca (más de 24 h), se renueva el certificado.
- La **llave de renovación** vive en el llavero del sistema (Acceso a Llaveros en macOS, DPAPI en
  Windows, Secret Service en Linux), no en `auth.json`. Si el llavero falla, queda en `auth.json`
  (0600) como hasta la 1.11 y el estado lo dice (`llave_renovacion: "fichero"`).
- **Cerrojo entre procesos** (`sesion.lock`): dos instancias no gastan la misma llave; dentro del
  cerrojo se relee la llave y, si otra acaba de renovar, se usa lo suyo.
- El servidor **rota** la llave en cada uso, **detecta la reutilización** y revoca la cadena
  (RFC 9700), con un **margen de 120 s** que devuelve el mismo par (cortes de red, peticiones en
  paralelo). Caducidad **deslizante de 90 días** y **tope absoluto de 12 meses** desde la última
  autorización explícita.
- Cuando RobinDesktop pide el token para su cuadro de mando, también renueva sesión y certificado.

## Reconectar: código de dispositivo (RFC 8628)

Cuando de verdad hay que volver a autorizar, las herramientas (y `reconectar_robinsearch`) dan un
código: «abre robinlawyer.ai/conectar en cualquier navegador (también el del móvil) e introduce el
código BRQX-HTKD». La página enseña qué equipo pide acceso (nombre, sistema, ciudad aproximada con la
base local DB-IP) y pide confirmación. RobinSearch sondea el servidor y queda conectado solo. Contra
el phishing por código: aviso «solo continúa si acabas de pedirlo tú», 10 minutos y un solo uso,
intentos fallidos limitados por código, IP y usuario, correo al titular por cada equipo nuevo, y la
lista de equipos con «Desconectar» en /devices.

El login por navegador con vuelta a `127.0.0.1` sigue existiendo para RobinDesktop (`robin-search
login`) y como respaldo si el servidor no ofrece el código.

## Avisos y rastro

- En las respuestas de las herramientas (`aviso_robinsearch`, como mucho cada 6 h) y en
  `estado_servidor` (`aviso_sesion`): licencia a ≤ 5 días de vencer o en gracia, versión nueva,
  versión mínima anunciada.
- Correo al titular a 7 y a 2 días de que una instalación se quede sin uso (job diario 08:10).
- Registro en el servidor de cada conexión con su resultado y **motivo** (`events`,
  `robinsearch.conexion`): `version_no_soportada`, `llave_caducada`, `llave_reutilizada_cadena_revocada`,
  `equipo_desconectado`, `tope_absoluto`, `codigo_caducado`, `pkce_no_coincide`…
- Panel /admin → RobinSearch → «sesiones»: instalaciones que caducan en ≤ 7 días o ya caducadas.
- Cada proceso apunta su último éxito/error de conexión en `conexion.json`. Si el que conecta ve que
  otro (p. ej. el que lanza Claude) lleva más de un día sin poder, manda un aviso técnico
  `sin_conexion_otro_proceso` con el código de error: la causa de un caso como el de Pedro, sin
  adivinarla.

Pruebas: `scripts/test-sesion-sin-robindesktop.mjs` (las siete de Juan: 30/60/90 días sin
RobinDesktop, gracia, código, llave copiada, dos instancias, corte de red, versión antigua).
