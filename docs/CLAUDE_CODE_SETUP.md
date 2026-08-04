# RobinSearch en Claude Code / Antigravity

## 1. Instalar el servidor

```bash
npm install -g @robinlawyer/robin-search
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
    "robin-search": {
      "type": "stdio",
      "command": "robin-search",
      "env": {
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
    "robin-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/ruta/al/robin-search/server/index.js"],
      "env": {
        "ROBIN_FOLDER": "/ruta/a/carpeta/expedientes"
      }
    }
  }
}
```

No se configura ningún token: la sesión se inicia con tu cuenta de Robin Lawyer (ver paso 3).

## 3. Iniciar sesión

```bash
robin-search login   # abre el navegador, inicias sesión en Robin Lawyer, se guarda la sesión
```

También se dispara solo la primera vez que Claude use una herramienta de búsqueda. Para
despliegue IT sin navegador, usa `ROBIN_TOKEN` con una clave pre-provisionada.

## 4. Verificar

```bash
claude mcp list
# robin-search   stdio   ✓
```

En el primer arranque el servidor descarga el modelo e5-small (~120-150 MB, una sola vez) e
indexa la carpeta en segundo plano. `estado_servidor` informa del progreso y del estado de sesión.
