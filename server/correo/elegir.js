// Qué cuenta de correo usa cada herramienta (varias cuentas, 26-sep-2026).
//
// Juan: «igual que en Expedientes se puede configurar más de una carpeta, que en Correo
// electrónico se pueda configurar también más de una cuenta». Con una sola cuenta nada cambia:
// las herramientas no necesitan que se les diga cuál. Con varias, la regla es no adivinar donde
// adivinar mal hace daño:
//
//   · BUSCAR sin decir cuenta busca en TODAS, y cada correo devuelto dice de cuál es.
//   · Todo lo que va por `uid` (leer, leer un adjunto, archivar, responder) EXIGE la cuenta: un
//     uid solo vale dentro de su buzón, y el mismo número en otro buzón es OTRO correo. Leerlo
//     en la cuenta equivocada sería servir el correo de otra persona como si fuera el pedido.
//   · ENVIAR exige la cuenta: un correo que sale a nombre de quien no es no se puede recoger.
//   · Un BORRADOR nuevo va a la principal si no se dice otra, y la respuesta dice cuál.
//
// Ligero a propósito (solo ajustes.js): se carga al declarar las herramientas.

import { leerCorreo, leerCuentas } from './ajustes.js';
import { SIN_CUENTA } from './avisos.js';

export const PROPIEDAD_CUENTA = {
  type: 'string',
  description:
    'Dirección de la cuenta de correo, cuando el abogado tiene varias conectadas (cada correo de '
    + 'buscar_correos trae la suya en "cuenta"). Si solo hay una, se puede omitir.',
};

const lista = (cuentas) => cuentas.map((c) => c.usuario).join(', ');

// { cfg } con la cuenta elegida, o { error, extra } listo para fail().
export function elegirCuenta(args, { exigeSiVarias = false, porque = '' } = {}) {
  const pedida = typeof args?.cuenta === 'string' && args.cuenta.trim() ? args.cuenta.trim() : null;
  const cuentas = leerCuentas();
  if (!cuentas.length) return { error: SIN_CUENTA, extra: { motivo: 'sin_cuenta' } };
  if (pedida) {
    const cfg = leerCorreo(pedida);
    if (cfg.desconocida || !cfg.configurado) {
      return {
        error: `La cuenta «${pedida}» no está conectada en este ordenador. Las conectadas son: ${lista(cuentas)}.`,
        extra: { motivo: 'cuenta_desconocida', cuentas: cuentas.map((c) => c.usuario) },
      };
    }
    return { cfg };
  }
  if (exigeSiVarias && cuentas.length > 1) {
    return {
      error: `Hay ${cuentas.length} cuentas de correo conectadas (${lista(cuentas)}) y ${porque}. `
        + 'Indica cuál con "cuenta".',
      extra: { motivo: 'falta_cuenta', cuentas: cuentas.map((c) => c.usuario) },
    };
  }
  return { cfg: { ...cuentas[0], cuentas: cuentas.map((c) => c.usuario) } };
}

export default { elegirCuenta, PROPIEDAD_CUENTA };
