// reconectar_robinsearch — vuelve a conectar RobinSearch con la cuenta de RobinLawyer.ai con un
// CÓDIGO (RFC 8628) que el abogado introduce en robinlawyer.ai/conectar desde cualquier navegador,
// también el del móvil (Juan, 8-oct-2026). Sin puerto local ni «dile a Claude que has terminado».

import { ok, fail } from './util.js';
import {
  authStatus, iniciarDispositivo, estadoDispositivo, textoDispositivo, mantenerSesion, authPromptResult,
} from '../auth/oauth.js';
import { ultimoErrorRed } from '../auth/oauth.js';

export const definition = {
  name: 'reconectar_robinsearch',
  title: 'Reconectar RobinSearch con RobinLawyer.ai',
  description:
    'Úsala cuando el abogado pida «reconectar RobinSearch», cuando otra herramienta de RobinSearch ' +
    'diga que hay que conectar o volver a autorizar, o cuando estado_servidor avise de que la ' +
    'licencia de este equipo está a punto de vencer. Primero intenta renovar sola (sin hacer nada el ' +
    'abogado); si no puede, da un código para introducir en robinlawyer.ai/conectar desde cualquier ' +
    'navegador. Muéstrale al abogado el código y la dirección tal cual. Llamarla otra vez mientras el ' +
    'código sigue vivo dice si ya se ha conectado.',
  inputSchema: {
    type: 'object',
    properties: {
      nuevo_codigo: {
        type: 'boolean',
        description: 'true para pedir un código nuevo aunque haya uno vivo (por ejemplo, si el abogado lo perdió). Por defecto false.',
      },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export async function handler(args = {}) {
  const vivo = estadoDispositivo();
  if (vivo?.estado === 'conectado') {
    const s = await authStatus();
    return ok({ conectado: true, usuario: s.usuario, licencia: s.licencia, mensaje: 'RobinSearch ya está conectado. Puedes repetir la petición.' });
  }
  if (vivo?.estado === 'esperando' && !args.nuevo_codigo) {
    return ok({ conectado: false, esperando_codigo: true, codigo: vivo.user_code, url: vivo.verification_uri, caduca_en_s: vivo.caduca_en_s, mensaje: textoDispositivo(vivo) });
  }
  if (vivo?.estado === 'denegado' && !args.nuevo_codigo) {
    return fail('El código se rechazó en robinlawyer.ai/conectar. Si fue un error, pide uno nuevo (nuevo_codigo: true).', { denegado: true });
  }
  if (!args.nuevo_codigo) {
    // Lo primero, sin molestar a nadie: renovar con la llave que ya hay.
    await mantenerSesion();
    const s = await authStatus();
    if (s.autenticado && s.licencia?.uso && s.licencia?.modo === 'licencia') {
      return ok({ conectado: true, usuario: s.usuario, licencia: s.licencia, mensaje: 'RobinSearch está conectado y su licencia renovada; no hace falta hacer nada.' });
    }
  }
  const d = await iniciarDispositivo({ forzar: Boolean(args.nuevo_codigo) });
  if (d?.user_code) {
    return ok({ conectado: false, esperando_codigo: true, codigo: d.user_code, url: d.verification_uri, caduca_en_s: d.caduca_en_s, mensaje: textoDispositivo(d) });
  }
  if (d?.sin_conexion) return authPromptResult(null, { sin_conexion: true, error_red: ultimoErrorRed() });
  if (d?.version_no_soportada) return authPromptResult(null, { version_no_soportada: true, version_minima: null });
  return fail('No se ha podido pedir un código de conexión ahora mismo. Vuelve a intentarlo en un minuto; si sigue, escribe a hola@robinlawyer.ai.');
}

export default { definition, handler };
