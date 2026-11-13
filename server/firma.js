// FIRMA DEL FICHERO DE VERSIONES (1.13.3, 13-nov-2026; Juan, «Re: Calendario de actualizaciones»).
//
// 🔴 EL HUECO. Desde la 1.13.0 el motor se baja y se ejecuta solo (motor.js): sin que el abogado
// pulse nada ni Claude pida confirmación. Lo único que se comprobaba era la huella sha-256 que
// publica… el mismo servidor que sirve el paquete. Contra un proxy o una wifi ajena vale (va por
// HTTPS y la huella tiene que cuadrar), pero quien controlase el servidor de robinlawyer.ai podría
// publicar un paquete suyo con su huella, y se ejecutaría con acceso a los documentos del abogado.
//
// EL ARREGLO. El fichero de versiones se firma con una clave Ed25519 que NO está en el servidor:
// vive en el ordenador desde el que se publica (scripts/publicar-semana.sh de robin-desktop) y la
// firma se sirve al lado, en `robin-search-latest.json.sig` (base64 de la firma de los bytes
// EXACTOS del JSON). Aquí van las claves PÚBLICAS: sin una firma válida de una de ellas no se
// instala ningún motor (el aviso de versión nueva sí se da: no ejecuta nada).
//
// Dos claves: la principal y una de reserva guardada aparte. Si la principal se pierde o se
// compromete, se firma con la de reserva y la versión siguiente cambia la lista: los equipos
// no se quedan sin poder actualizarse.
import crypto from 'node:crypto';

export const CLAVES_FEED = [
  // principal (13-nov-2026)
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA7zBbnvZHTCwdkqleB5Bdfr+ElOCqnyJuSqbLdf/nyPE=\n-----END PUBLIC KEY-----\n',
  // reserva (13-nov-2026)
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAzBE0Q0H+qG6VO18urSZ399smenppeeM67KifxPcQixI=\n-----END PUBLIC KEY-----\n',
];

function claves() {
  // Solo para las pruebas (que firman con una clave suya contra un servidor en 127.0.0.1): exige
  // además ROBIN_MOTOR_PERMITIR_LOCAL, que es lo que ya deja bajar de 127.0.0.1.
  const prueba = process.env.ROBIN_FEED_CLAVE_PRUEBA;
  if (prueba && process.env.ROBIN_MOTOR_PERMITIR_LOCAL === '1') return [...CLAVES_FEED, prueba];
  return CLAVES_FEED;
}

// true solo si `firmaB64` es una firma Ed25519 válida de `bytes` con una de las claves.
export function feedFirmado(bytes, firmaB64) {
  try {
    const firma = Buffer.from(String(firmaB64 || '').trim(), 'base64');
    if (firma.length !== 64) return false;
    const datos = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
    return claves().some((pem) => {
      try {
        return crypto.verify(null, datos, crypto.createPublicKey(pem), firma);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export default { feedFirmado, CLAVES_FEED };
