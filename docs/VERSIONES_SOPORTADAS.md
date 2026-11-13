# Versiones de RobinSearch soportadas por el servidor

Los clientes no se actualizan solos: cada versión hay que aceptarla en Claude (o con el botón de
RobinDesktop). Por eso el servidor es **compatible hacia atrás**:

- Toda versión puede renovar su sesión y reconectar mientras no esté por debajo de la **versión
  mínima soportada** (`ROBINSEARCH_VERSION_MINIMA` en el servidor; vacía = todas).
- Las versiones anteriores a la 1.12.0 no dicen su versión (mandan «node»): se tratan siempre como
  soportadas.
- Regla: se soportan **al menos las dos últimas versiones menores publicadas** y nunca se sube la
  mínima sin **aviso previo de 30 días**:
  1. Se anuncia en `descargas/robin-search-latest.json` con `version_minima` y `version_minima_desde`
     (fecha). Desde la 1.12.0, RobinSearch lo dice en el chat a quien tenga una versión anterior.
  2. Se mira en /admin → RobinSearch → sesiones cuántas instalaciones quedarían fuera.
  3. Llegada la fecha, se fija `ROBINSEARCH_VERSION_MINIMA`.
- Por debajo de la mínima el servidor responde `426 version_no_soportada`: RobinSearch NO borra la
  sesión (con la versión nueva renueva sin volver a entrar), sigue con el certificado de licencia
  mientras valga y le dice al abogado qué versión necesita.

## El fichero de versiones va firmado (1.13.3, 13-nov-2026)

Desde la 1.13.0 RobinSearch instala solo la versión publicada (`server/motor.js`). Desde la
1.13.3 lo hace **solo si el fichero de versiones viene firmado** con la clave de RobinLawyer.ai
(`server/firma.js`): la firma Ed25519 de los bytes exactos de `robin-search-latest.json` se
sirve al lado, en `robin-search-latest.json.sig`, y la clave privada no está en el servidor. Sin
firma válida se avisa de la versión nueva, pero no se instala nada.

El fichero lo escribe y lo firma **solo** `scripts/publicar-semana.sh` de robin-desktop (la
publicación semanal: app, RobinSearch y plugin juntos). `scripts/publicar-extension.sh` solo sube
el `.mcpb`. `version_minima` y `version_minima_desde` los pone esa misma publicación cuando es
urgente (`--urgente`), a la vez que la mínima de RobinDesktop (`app.minima`), con la fecha a 30
días; ver «Los dos campos de mínima» en `docs/actualizaciones.md` de robin-desktop.
