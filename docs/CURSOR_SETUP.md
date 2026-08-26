# RobinSearch en Cursor

## 1. Instalar

```bash
npm install -g @robinlawyer/robin-search
```

## 2. Configurar `~/.cursor/mcp.json` (global) o `.cursor/mcp.json` (por proyecto)

```json
{
  "mcpServers": {
    "robin-lawyer": {
      "url": "https://api.robinlawyer.ai/mcp",
      "headers": { "Authorization": "Bearer TU_TOKEN_ROBIN_LAWYER" }
    },
    "robin-search": {
      "command": "robin-search",
      "env": {
        "ROBIN_FOLDER": "/ruta/a/carpeta/expedientes"
      }
    }
  }
}
```

El servidor local no lleva token: la sesión se inicia con tu cuenta de Robin Lawyer.

## 3. Iniciar sesión

```bash
robin-search login   # abre el navegador y guarda la sesión
```

También se dispara solo la primera vez que uses la búsqueda. (IT sin navegador: `ROBIN_TOKEN`.)

## 4. Verificar

Settings → **Tools & MCP** → `robin-search` debe aparecer en verde con sus herramientas.

## Nota sobre el límite de herramientas de Cursor

Cursor limita a ~40 herramientas activas. Las 5 de RobinSearch + las 93 de Robin Lawyer
remoto lo superan. Si usas ambos, desactiva desde **Tools & MCP** las herramientas de Robin
Lawyer que no necesites en ese proyecto para dejar sitio a la búsqueda local.
