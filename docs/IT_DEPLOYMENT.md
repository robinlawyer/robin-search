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

### Directorios de datos (para respaldo/limpieza)

| SO      | Ruta                                                             |
| ------- | --------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/RobinLawyer/robin-search`          |
| Windows | `%APPDATA%\RobinLawyer\robin-search`                             |
| Linux   | `~/.local/share/robin-lawyer/robin-search`                       |

Contiene `index/` (vectra), `files.json` (registro incremental) y `logs/`. Ningún documento
original; se puede borrar para forzar un re-indexado limpio.
