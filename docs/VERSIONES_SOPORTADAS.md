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
