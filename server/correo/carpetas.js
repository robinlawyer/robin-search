// Dónde están de verdad «Borradores» y «Enviados» en el buzón del abogado.
//
// AQUÍ ES DONDE SE PIERDE LA TARDE. La carpeta de borradores NO se llama «Drafts» en todas
// partes: en Dovecot —que es lo que corre en casi todo el hosting español— cuelga de la bandeja
// de entrada y se llama «INBOX.Drafts»; en un servidor en español puede ser «Borradores»; en
// uno en catalán, «Esborranys»; y el separador de niveles puede ser «.» o «/». Un APPEND a
// «Drafts» a pelo crea una carpeta NUEVA y suelta, y el borrador que el abogado espera ver en
// su Outlook no aparece por ninguna parte.
//
// Por eso se pregunta al servidor con SPECIAL-USE (RFC 6154): él dice cuál de sus carpetas
// tiene el atributo \Drafts y cuál el \Sent. Lo que hacen Apple Mail y Outlook.
// Los nombres por convención son solo la red de seguridad para servidores viejos que no lo
// anuncian; si tampoco hay eso, se dice claramente en vez de inventar una carpeta.

import { log } from '../logger.js';
import { leerCorreo, guardarCorreo } from './ajustes.js';

// Nombres habituales, por si el servidor no anuncia SPECIAL-USE. Sin acentos y en minúsculas:
// se comparan ya normalizados.
const CONVENCION = {
  borradores: ['drafts', 'borradores', 'borrador', 'esborranys', 'zirriborroak', 'rascunhos', 'brouillons', 'entwurfe'],
  enviados: ['sent', 'sent items', 'sent messages', 'enviados', 'elementos enviados', 'correo enviado', 'enviats', 'bidalitakoak'],
};

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// El último tramo del nombre: de «INBOX.Drafts» interesa «Drafts».
function hoja(ruta, delimitador) {
  const d = delimitador || '/';
  const i = ruta.lastIndexOf(d);
  return i >= 0 ? ruta.slice(i + d.length) : ruta;
}

// Memoria del proceso: el LIST completo de un buzón con muchas carpetas no es gratis y esto no
// cambia entre llamadas. Lo persistente vive en ajustes.json.
const cache = new Map();

async function listar(cliente) {
  // imapflow pide LIST con SPECIAL-USE cuando el servidor lo soporta y cae a XLIST si no.
  const buzones = await cliente.list();
  return buzones.map((b) => ({
    ruta: b.path,
    delimitador: b.delimiter,
    // `specialUse` llega como '\\Drafts'; algunos servidores solo lo ponen en `flags`.
    especial: b.specialUse || [...(b.flags || [])].find((f) => /^\\(Drafts|Sent|Trash|Junk|Archive|All)$/i.test(f)) || null,
  }));
}

function porEspecial(buzones, atributo) {
  return buzones.find((b) => String(b.especial || '').toLowerCase() === atributo.toLowerCase())?.ruta || null;
}

function porConvencion(buzones, clase) {
  const nombres = CONVENCION[clase];
  // Primero las que cuelgan de INBOX (Dovecot) y luego las de primer nivel: en un servidor con
  // las dos, la que usa el cliente de correo del abogado es la de INBOX.
  const candidatas = buzones.filter((b) => nombres.includes(sinAcentos(hoja(b.ruta, b.delimitador))));
  const deInbox = candidatas.find((b) => /^INBOX[./]/i.test(b.ruta));
  return (deInbox || candidatas[0])?.ruta || null;
}

// Resuelve una carpeta especial. `clase` = 'borradores' | 'enviados'.
// Orden: lo que el abogado haya fijado a mano → SPECIAL-USE → convención → null.
export async function resolver(cliente, clase) {
  const cfg = leerCorreo();
  const fijada = cfg.carpetas?.[clase];
  if (fijada) return fijada;
  const enMemoria = cache.get(clase);
  if (enMemoria) return enMemoria;

  const buzones = await listar(cliente);
  const atributo = clase === 'borradores' ? '\\Drafts' : '\\Sent';
  let ruta = porEspecial(buzones, atributo);
  const via = ruta ? 'special-use' : 'convencion';
  if (!ruta) ruta = porConvencion(buzones, clase);
  if (!ruta) {
    log.warn('El servidor de correo no declara la carpeta especial', { clase, via: 'ninguna' });
    return null;
  }
  cache.set(clase, ruta);
  // Se recuerda en ajustes.json para no volver a hacer el LIST en el próximo arranque. El
  // nombre de una carpeta del sistema no es contenido del abogado.
  try {
    guardarCorreo({ carpetas: { ...cfg.carpetas, [clase]: ruta } });
  } catch (err) {
    log.warn('No se pudo recordar la carpeta especial', { clase, err: String(err?.message ?? err) });
  }
  log.info('Carpeta especial resuelta', { clase, via });
  return ruta;
}

// Para la pantalla de «Conectar» y para las pruebas: el mapa entero, con el separador y por qué
// vía se ha resuelto cada una. Nunca devuelve el nombre de carpetas de clientes.
export async function inventario(cliente) {
  const buzones = await listar(cliente);
  const salida = { delimitador: buzones[0]?.delimitador || null, carpetas: {}, especiales: {}, total: buzones.length };
  for (const clase of ['borradores', 'enviados']) {
    const atributo = clase === 'borradores' ? '\\Drafts' : '\\Sent';
    const especial = porEspecial(buzones, atributo);
    salida.carpetas[clase] = especial || porConvencion(buzones, clase);
    salida.especiales[clase] = especial ? 'special-use' : (salida.carpetas[clase] ? 'convencion' : 'no_encontrada');
  }
  salida.conSpecialUse = buzones.filter((b) => b.especial).map((b) => ({ ruta: b.ruta, especial: b.especial }));
  return salida;
}

export function olvidarCache() {
  cache.clear();
}

export default { resolver, inventario, olvidarCache };
