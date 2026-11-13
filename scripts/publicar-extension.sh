#!/bin/bash
# SUBE la EXTENSIÓN (.mcpb). NO la anuncia.
#
# 🔴 13-nov-2026 (Juan, «Calendario de actualizaciones»): el fichero de versiones ya no se toca
# desde aquí. Lo escribe SOLO scripts/publicar-semana.sh de robin-desktop —la publicación semanal,
# con la app, RobinSearch y el plugin juntos y un solo aviso—, que además lo FIRMA
# (server/firma.js): un fichero de versiones retocado sin firmar haría que ningún RobinSearch se
# instalase solo. publicar-semana.sh llama a este guion para la subida.
#
# HISTORIA (lo que sigue explica por qué la raíz del fichero importa; hoy la escribe
# publicar-semana.sh):
#
# POR QUÉ EXISTE ESTE GUION. `publicar.sh` (en robin-desktop) solo toca la sección `app` del
# fichero de versiones y dice, con todas las letras, que la raíz no se toca. La raíz es LA VERSIÓN
# DE LA EXTENSIÓN, que es lo que compara `server/update.js` para avisar al abogado. Subir el .mcpb
# sin actualizar la raíz deja a todo el mundo sin enterarse de que hay versión nueva: pasó en
# septiembre de 2026 y la raíz se quedó en la 1.3.1 mientras se publicaban la 1.4, la 1.5 y la 1.6.
#
# Uso: lo llama publicar-semana.sh (RS=<esta carpeta>). A mano: bash scripts/publicar-extension.sh
#
# Hace, en este orden y parando al primer fallo:
#   1. Comprueba que el .mcpb está construido y que dice la misma versión que package.json.
#   2. Lo sube por scp y contrasta la huella sha-256 de lo que quedó en el servidor.
#   3. Comprueba DESDE FUERA que el .mcpb servido tiene la misma huella que el local.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVIDOR=root@5.189.141.180
CLAVE="$HOME/.ssh/id_jurix_server"
REMOTO=/opt/jurix/frontend/descargas
BASE=https://robinlawyer.ai/descargas/
PAQUETE=dist/robin-search.mcpb

V=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
VM=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")

echo "### RobinSearch (extensión) $V"
[ -f "$PAQUETE" ] || { echo "   FALTA $PAQUETE — construye antes: npm run pack:mcpb"; exit 1; }
[ "$V" = "$VM" ] || { echo "   ABORTO: package.json dice $V y manifest.json dice $VM"; exit 1; }
HUELLA=$(shasum -a 256 "$PAQUETE" | cut -d' ' -f1)
echo "   $PAQUETE  $(du -m "$PAQUETE" | cut -f1) MB  ${HUELLA:0:12}…"

echo "### 1. Subiendo"
# Con reintentos y con ServerAliveInterval: en un enlace que pierde paquetes (6-nov-2026) el scp
# se queda colgado a 0 KB/s sin dar error, y la publicación no terminaba nunca.
for intento in 1 2 3 4; do
  scp -i "$CLAVE" -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -q "$PAQUETE" "$SERVIDOR:$REMOTO/robin-search.mcpb" && break
  [ "$intento" = 4 ] && { echo "   ABORTO: no se pudo subir el paquete tras 4 intentos"; exit 1; }
  echo "   se cortó la subida (intento $intento); reintentando…"; sleep 5
done
REMOTA=$(ssh -i "$CLAVE" "$SERVIDOR" "sha256sum $REMOTO/robin-search.mcpb | cut -d' ' -f1")
[ "$REMOTA" = "$HUELLA" ] || { echo "   ABORTO: la huella del servidor ($REMOTA) no coincide"; exit 1; }
echo "   huella correcta en el servidor"

echo "### 2. Comprobando desde fuera"
SERVIDA=$(curl -sS "${BASE}robin-search.mcpb" | shasum -a 256 | cut -d' ' -f1)
[ "$SERVIDA" = "$HUELLA" ] || { echo "   ABORTO: el .mcpb servido tiene otra huella ($SERVIDA)"; exit 1; }
echo "   el .mcpb servido es byte a byte el que construimos"
echo "### Subida hecha. Se ANUNCIA con scripts/publicar-semana.sh de robin-desktop."
