# Despliegue IT — RobinSearch

Dos vías según el cliente del despacho.

## A) Claude Desktop — allowlist de empresa (`.mcpb`)

Para despachos con plan **Team/Enterprise**, el `.mcpb` se distribuye por política del sistema
(JAMF en macOS, Intune en Windows) y se autoriza vía allowlist de extensiones gestionada por el
IT del despacho. Cada abogado solo selecciona la carpeta en el diálogo nativo; la sesión se
inicia con su cuenta de Robin Lawyer en el navegador (o, headless, con `ROBIN_TOKEN`).

## B) Claude Code / Cursor — npm + pre-indexado headless

### Instalación silenciosa

```bash
npm install -g @robinlawyer/robin-search
```

### Pre-indexar el expediente (sin interacción)

```bash
robin-search --silent --token="TOKEN" --folder="C:\Expedientes"
```

- Indexa la carpeta una vez y sale con código **0** (o **1** si hubo errores de indexado, **2**
  si falta la carpeta).
- Descarga el modelo e5-small la primera vez (cacheado en el dir de datos).
- Integrable en scripts de GPO / JAMF / Intune.

### Variables de entorno equivalentes a los flags

| Flag         | Variable          |
| ------------ | ----------------- |
| `--token`    | `ROBIN_TOKEN`     |
| `--folder`   | `ROBIN_FOLDER`    |
| `--data-dir` | `ROBIN_DATA_DIR`  |

### Velocidad de indexado y memoria

El cálculo de vectores (lo que más tarda) se reparte en hilos de trabajo locales. Por defecto,
uno por núcleo menos uno, como mucho 4 y sin pasar del 30 % de la memoria del equipo (cada hilo
ocupa ~1,1 GB mientras indexa; terminado el indexado, los hilos de más se sueltan a los 2 min).

| Variable            | Efecto                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| `ROBIN_EMBED_HILOS` | `0`: todo en el hilo principal (como hasta la 1.5.0). `N`: N hilos exactos.  |

El índice y los resultados de búsqueda son idénticos con cualquier valor.

### PDF protegidos con contraseña

Muchos juzgados, bancos y aseguradoras mandan sus PDF cifrados, siempre con la misma contraseña.
RobinSearch no la guarda ni la pide nunca por el chat: se pone en el entorno del servicio y se
prueba al abrir un PDF cifrado.

| Variable           | Efecto                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| `ROBIN_PDF_CLAVES` | Contraseñas a probar, separadas por `;` o salto de línea. No se registran. |

Sin ella, esos documentos no fallan «por un error»: salen en `estado_servidor` como
`no_indexables.protegidos`, con lo que el abogado tiene que hacer.

### Documentos que la nube todavía no ha bajado

Un fichero de iCloud, OneDrive o Dropbox que está en la carpeta pero no en el disco no se cuenta
como error: RobinSearch **pide su descarga** y lo vuelve a mirar con espera creciente (2 min, 5,
15, 45, 2 h…) hasta indexarlo. Si tras un día sigue sin contenido, se da por vacío.

| Variable                 | Efecto                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `ROBIN_NUBE_POR_TANDA`   | Cuántas descargas se piden por pasada (por defecto 20).        |
| `ROBIN_NUBE_REVISAR_MS`  | Cada cuánto se revisa la lista (por defecto 2 min).            |
| `ROBIN_NUBE_DIAS_MAX`    | Días insistiendo antes de darlo por vacío (por defecto 1).     |

### Directorios de datos (para respaldo/limpieza)

| SO      | Ruta                                                             |
| ------- | --------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/RobinLawyer/robin-search`          |
| Windows | `%APPDATA%\RobinLawyer\robin-search`                             |
| Linux   | `~/.local/share/robin-lawyer/robin-search`                       |

Contiene `index/` (vectra), `files.json` (registro incremental) y `logs/`. Ningún documento
original; se puede borrar para forzar un re-indexado limpio.
