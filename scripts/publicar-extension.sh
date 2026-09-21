#!/bin/bash
# Publica la EXTENSIÓN (.mcpb) y anuncia su versión en la raíz del fichero de versiones.
#
# POR QUÉ EXISTE ESTE GUION. `publicar.sh` (en robin-desktop) solo toca la sección `app` del
# fichero de versiones y dice, con todas las letras, que la raíz no se toca. La raíz es LA VERSIÓN
# DE LA EXTENSIÓN, que es lo que compara `server/update.js` para avisar al abogado. Subir el .mcpb
# sin actualizar la raíz deja a todo el mundo sin enterarse de que hay versión nueva: pasó en
# septiembre de 2026 y la raíz se quedó en la 1.3.1 mientras se publicaban la 1.4, la 1.5 y la 1.6.
#
# Uso, desde robin-local-installer/:   NOTAS="…" bash scripts/publicar-extension.sh
#
# Hace, en este orden y parando al primer fallo:
#   1. Comprueba que el .mcpb está construido y que dice la misma versión que package.json.
#   2. Lo sube por scp y contrasta la huella sha-256 de lo que quedó en el servidor.
#   3. Actualiza la RAÍZ del fichero de versiones por git (commit + push bajo el mismo flock que
#      los crons de despliegue: con scp duraría hasta el próximo reset, porque está versionado).
#   4. Comprueba DESDE FUERA que la raíz anuncia esta versión y que el .mcpb servido tiene la
#      misma huella que el local.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVIDOR=root@5.189.141.180
CLAVE="$HOME/.ssh/id_jurix_server"
REMOTO=/opt/jurix/frontend/descargas
BASE=https://robinlawyer.ai/descargas/
PAQUETE=dist/robin-search.mcpb

V=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
VM=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
NOTAS="${NOTAS:-RobinSearch $V.}"

echo "### RobinSearch (extensión) $V"
[ -f "$PAQUETE" ] || { echo "   FALTA $PAQUETE — construye antes: npm run pack:mcpb"; exit 1; }
[ "$V" = "$VM" ] || { echo "   ABORTO: package.json dice $V y manifest.json dice $VM"; exit 1; }
HUELLA=$(shasum -a 256 "$PAQUETE" | cut -d' ' -f1)
echo "   $PAQUETE  $(du -m "$PAQUETE" | cut -f1) MB  ${HUELLA:0:12}…"

echo "### 1. Subiendo"
scp -i "$CLAVE" -q "$PAQUETE" "$SERVIDOR:$REMOTO/robin-search.mcpb"
REMOTA=$(ssh -i "$CLAVE" "$SERVIDOR" "sha256sum $REMOTO/robin-search.mcpb | cut -d' ' -f1")
[ "$REMOTA" = "$HUELLA" ] || { echo "   ABORTO: la huella del servidor ($REMOTA) no coincide"; exit 1; }
echo "   huella correcta en el servidor"

echo "### 2. Anunciando la versión en la RAÍZ del fichero de versiones"
ssh -i "$CLAVE" "$SERVIDOR" "V='$V' BASE='$BASE' HUELLA='$HUELLA' NOTAS=$(printf %q "$NOTAS") flock /tmp/deploy-frontend.lock bash -s" <<'REMOTO_SH'
set -euo pipefail
cd /opt/jurix/frontend
git fetch -q origin main
[ "$(git rev-parse @)" = "$(git rev-parse origin/main)" ] || { echo "   ABORTO: HEAD != origin/main"; exit 1; }
python3 - <<'PY'
import json, os, collections
O = collections.OrderedDict
p = "descargas/robin-search-latest.json"
d = json.load(open(p), object_pairs_hook=O)
# Solo la raíz: la sección `app` la gobierna publicar.sh de robin-desktop.
d["version"] = os.environ["V"]
d["url"] = os.environ["BASE"] + "robin-search.mcpb"
# La huella es lo que permite que la APP se baje la extension y la instale
# sola: sin ella lo unico honesto es abrir la descarga en el navegador, y el
# abogado se queda con un .mcpb de 250 MB en Descargas sin saber que hacer
# (Eduardo, 21-sep-2026). Un cliente viejo ignora esta clave sin enterarse.
d["sha256"] = os.environ["HUELLA"]
d["notas"] = os.environ["NOTAS"]
open(p, "w").write(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
PY
git add descargas/robin-search-latest.json
git -c user.name="Robin Deploy" -c user.email="deploy@robinlawyer.ai" commit -q -m "descargas: la extension anuncia la $V

La raiz del fichero de versiones es lo que compara server/update.js para avisar
al abogado. Sin esto, el .mcpb nuevo esta servido pero nadie se entera."
git push -q origin main
echo "   publicado: $(git log --oneline -1)"
REMOTO_SH

echo "### 3. Comprobando desde fuera"
RAIZ=$(curl -sS "${BASE}robin-search-latest.json")
ANUNCIA=$(echo "$RAIZ" | python3 -c "import sys,json;print(json.load(sys.stdin)['version'])")
[ "$ANUNCIA" = "$V" ] || { echo "   ABORTO: el feed anuncia la $ANUNCIA"; exit 1; }
ANUNCIA_H=$(echo "$RAIZ" | python3 -c "import sys,json;print(json.load(sys.stdin).get('sha256',''))")
[ "$ANUNCIA_H" = "$HUELLA" ] || { echo "   ABORTO: el feed anuncia otra huella ($ANUNCIA_H)"; exit 1; }
echo "   el feed anuncia la extensión $ANUNCIA con su huella"
SERVIDA=$(curl -sS "${BASE}robin-search.mcpb" | shasum -a 256 | cut -d' ' -f1)
[ "$SERVIDA" = "$HUELLA" ] || { echo "   ABORTO: el .mcpb servido tiene otra huella ($SERVIDA)"; exit 1; }
echo "   el .mcpb servido es byte a byte el que construimos"
echo "### Listo."
