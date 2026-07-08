# Robin Search en Cursor

## 1. Instalar

```bash
npm install -g @robinlawyer/local-server
```

## 2. Configurar `~/.cursor/mcp.json` (global) o `.cursor/mcp.json` (por proyecto)

```json
{
  "mcpServers": {
    "robin-lawyer": {
      "url": "https://api.robinlawyer.ai/mcp",
      "headers": { "Authorization": "Bearer TU_TOKEN_ROBIN_LAWYER" }
    },
    "robin-local": {
      "command": "robin-local",
      "env": {
        "ROBIN_TOKEN": "TU_TOKEN_ROBIN",
        "ROBIN_FOLDER": "/ruta/a/carpeta/expedientes"
      }
    }
  }
}
```

## 3. Verificar

Settings → **Tools & MCP** → `robin-local` debe aparecer en verde con sus 5 herramientas.

## Nota sobre el límite de herramientas de Cursor

Cursor limita a ~40 herramientas activas. Las 5 de Robin Search + las 101 de Robin Lawyer
remoto lo superan. Si usas ambos, desactiva desde **Tools & MCP** las herramientas de Robin
Lawyer que no necesites en ese proyecto para dejar sitio a la búsqueda local.
