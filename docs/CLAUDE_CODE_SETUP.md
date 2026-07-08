# Robin Search en Claude Code / Antigravity

## 1. Instalar el servidor

```bash
npm install -g @robinlawyer/local-server
```

## 2. Configurar `~/.claude.json`

Junto al MCP remoto de Robin Lawyer (Paso 1), añade el servidor local (Paso 2):

```json
{
  "mcpServers": {
    "robin-lawyer": {
      "type": "http",
      "url": "https://api.robinlawyer.ai/mcp"
    },
    "robin-local": {
      "type": "stdio",
      "command": "robin-local",
      "env": {
        "ROBIN_TOKEN": "TU_TOKEN_ROBIN",
        "ROBIN_FOLDER": "/ruta/a/carpeta/expedientes"
      }
    }
  }
}
```

Sin instalación global, usa `node` directamente:

```json
{
  "mcpServers": {
    "robin-local": {
      "type": "stdio",
      "command": "node",
      "args": ["/ruta/al/robin-local-installer/server/index.js"],
      "env": {
        "ROBIN_TOKEN": "TU_TOKEN_ROBIN",
        "ROBIN_FOLDER": "/ruta/a/carpeta/expedientes"
      }
    }
  }
}
```

## 3. Verificar

```bash
claude mcp list
# robin-local   stdio   ✓
```

En el primer arranque el servidor descarga el modelo e5-small (~120-150 MB, una sola vez) e
indexa la carpeta en segundo plano. `estado_servidor` informa del progreso.
