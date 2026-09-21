// Servidor IMAP de mentira, lo justo para probar el módulo de correo SIN un buzón real.
//
// POR QUÉ. Las pruebas tienen que correr en el portátil de cualquiera y en CI, sin credenciales
// y sin red. Y sobre todo: tienen que poder simular lo que NO se puede pedirle a un servidor de
// verdad — que la carpeta de borradores se llame «INBOX.Drafts», que el servidor no anuncie
// SPECIAL-USE, que la contraseña sea rechazada, que se corte a mitad de un FETCH.
//
// Implementa solo lo que usa RobinSearch: CAPABILITY, LOGIN, LIST, SELECT/EXAMINE, UID SEARCH,
// UID FETCH, APPEND (con APPENDUID), UID STORE, UID EXPUNGE, NOOP y LOGOUT. No pretende ser un
// servidor IMAP: pretende ser EL servidor de las pruebas.
import net from 'node:net';

const cita = (s) => (s === null || s === undefined ? 'NIL' : `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);

// «Nombre» <buzon@dominio> → la forma de dirección del ENVELOPE: (nombre ruta buzón dominio)
function direccion(bruta) {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<?([^@<>\s]+)@([^@<>\s]+)>?\s*$/.exec(String(bruta || ''));
  if (!m) return null;
  return `(${cita(m[1] ? m[1].trim() : null)} NIL ${cita(m[2])} ${cita(m[3])})`;
}

const listaDirecciones = (v) => {
  const xs = (Array.isArray(v) ? v : [v]).filter(Boolean).map(direccion).filter(Boolean);
  return xs.length ? `(${xs.join('')})` : 'NIL';
};

export class BuzonFalso {
  // `special` = false para simular un servidor viejo que NO anuncia SPECIAL-USE (y obliga a
  // RobinSearch a reconocer la carpeta por su nombre).
  // `token` = entra por XOAUTH2 con ese token de acceso (Microsoft 365, Gmail). Si se da,
  // el servidor anuncia AUTH=XOAUTH2; con `soloOauth` además anuncia LOGINDISABLED y rechaza
  // el LOGIN de toda la vida, que es exactamente lo que hacen los servidores de Microsoft.
  constructor({ usuario, clave, token = null, soloOauth = false, delimitador = '.', special = true } = {}) {
    this.usuario = usuario;
    this.clave = clave;
    this.token = token;
    this.soloOauth = soloOauth;
    this.delimitador = delimitador;
    this.special = special;
    this.carpetas = new Map();
    this.siguienteUid = new Map();
    this.uidValidity = 1;
    this.registro = [];      // qué órdenes ha recibido (las pruebas lo miran)
    this.cortarEn = null;    // nombre de orden en la que cortar la conexión, para probar caídas
    for (const [ruta, especial] of [['INBOX', null], [`INBOX${delimitador}Drafts`, '\\Drafts'], [`INBOX${delimitador}Sent`, '\\Sent'], [`INBOX${delimitador}Trash`, '\\Trash']]) {
      this.carpetas.set(ruta, { especial, mensajes: [] });
      this.siguienteUid.set(ruta, 1);
    }
  }

  anadir(ruta, { de, para, asunto, fecha = new Date(), cuerpo = '', leido = false, banderas = [], messageId = null, cabecerasExtra = '', charset = 'utf-8', mime = null }) {
    const carpeta = this.carpetas.get(ruta);
    if (!carpeta) throw new Error(`no existe ${ruta}`);
    const uid = this.siguienteUid.get(ruta);
    this.siguienteUid.set(ruta, uid + 1);
    const id = messageId || `<${uid}.${Date.now()}@prueba.local>`;
    // Ojo con la línea EN BLANCO entre cabeceras y cuerpo: es lo que separa las dos mitades de
    // un correo. Filtrarla «porque está vacía» deja un mensaje sin cuerpo y sin que nada falle.
    const cabeceras = [
      `From: ${de}`,
      `To: ${Array.isArray(para) ? para.join(', ') : para}`,
      `Subject: ${asunto}`,
      `Date: ${fecha.toUTCString()}`,
      `Message-ID: ${id}`,
      'MIME-Version: 1.0',
      `Content-Type: text/plain; charset=${charset}`,
      ...(cabecerasExtra ? [cabecerasExtra] : []),
    ];
    const fuente = mime || `${cabeceras.join('\r\n')}\r\n\r\n${cuerpo}`;
    const bytes = Buffer.isBuffer(fuente) ? fuente : Buffer.from(fuente, charset.toLowerCase().startsWith('utf') ? 'utf8' : 'latin1');
    const m = {
      uid,
      fuente: bytes,
      banderas: new Set([...(leido ? ['\\Seen'] : []), ...banderas]),
      de, para, asunto, fecha, messageId: id, charset,
      multiparte: Boolean(mime),
    };
    carpeta.mensajes.push(m);
    return uid;
  }

  envelope(m) {
    return `(${cita(m.fecha.toUTCString())} ${cita(m.asunto)} ${listaDirecciones(m.de)} ${listaDirecciones(m.de)} ${listaDirecciones(m.de)} ${listaDirecciones(m.para)} NIL NIL NIL ${cita(m.messageId)})`;
  }

  // Trocea un mensaje multipart por su frontera. Devuelve, por cada parte, sus cabeceras y su
  // cuerpo TAL CUAL viaja (sin deshacer el base64): eso lo hace el cliente, que para eso lee el
  // Content-Transfer-Encoding de las cabeceras de la parte.
  partes(m) {
    if (m._partes) return m._partes;
    const texto = m.fuente.toString('binary');
    const frontera = /boundary="?([^";\r\n]+)"?/i.exec(texto)?.[1];
    if (!frontera) return (m._partes = []);
    const trozos = texto.split(`--${frontera}`).slice(1, -1);
    m._partes = trozos.map((t) => {
      const corte = t.indexOf('\r\n\r\n');
      const cabeceras = corte < 0 ? '' : t.slice(0, corte + 4).replace(/^\r\n/, '');
      const cuerpo = corte < 0 ? '' : t.slice(corte + 4).replace(/\r\n$/, '');
      return { cabeceras: Buffer.from(cabeceras, 'binary'), cuerpo: Buffer.from(cuerpo, 'binary') };
    });
    return m._partes;
  }

  bodystructure(m) {
    // Estructura impuesta a mano: sirve para simular lo que no se puede meter en el repositorio,
    // como un adjunto de 20 MB (el servidor solo ANUNCIA su tamaño; nadie lo descarga).
    if (m.bodystructure) return m.bodystructure;
    // Si no, un mensaje con partes de verdad: se describe lo que hay, no una plantilla.
    const ps = this.partes(m);
    if (m.multiparte && ps.length) {
      const trozos = ps.map((parte) => {
        const c = parte.cabeceras.toString('utf8');
        const tipo = (/Content-Type:\s*([^;\r\n]+)/i.exec(c)?.[1] || 'text/plain').trim();
        const [t1, t2] = tipo.split('/');
        const nombre = /(?:file)?name="?([^";\r\n]+)"?/i.exec(c)?.[1] || null;
        const codif = (/Content-Transfer-Encoding:\s*(\S+)/i.exec(c)?.[1] || '7BIT').toUpperCase();
        const adjunto = /Content-Disposition:\s*attachment/i.test(c);
        const params = nombre ? `("NAME" ${cita(nombre)})` : '("CHARSET" "utf-8")';
        const disp = adjunto && nombre ? `("ATTACHMENT" ("FILENAME" ${cita(nombre)}))` : 'NIL';
        return `(${cita(t1.toUpperCase())} ${cita((t2 || 'plain').toUpperCase())} ${params} NIL NIL ${cita(codif)} ${parte.cuerpo.length} NIL ${disp} NIL NIL)`;
      });
      return `(${trozos.join('')} "MIXED" ("BOUNDARY" "x") NIL NIL NIL)`;
    }
    if (m.multiparte) {
      // text/plain + un adjunto PDF: lo justo para probar que se listan los adjuntos y que se
      // elige la parte de texto correcta.
      return '(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 120 5 NIL NIL NIL NIL)'
        + '("APPLICATION" "PDF" ("NAME" "burofax.pdf") NIL NIL "BASE64" 20971520 NIL ("ATTACHMENT" ("FILENAME" "burofax.pdf")) NIL NIL)'
        + ' "MIXED" ("BOUNDARY" "limite") NIL NIL NIL)';
    }
    const cuerpo = this.cuerpoDe(m);
    return `("TEXT" "PLAIN" ("CHARSET" ${cita(m.charset)}) NIL NIL "8BIT" ${cuerpo.length} ${cuerpo.toString('latin1').split('\n').length} NIL NIL NIL NIL)`;
  }

  cuerpoDe(m) {
    const i = m.fuente.indexOf('\r\n\r\n');
    return i < 0 ? Buffer.alloc(0) : m.fuente.slice(i + 4);
  }

  cabecerasDe(m) {
    const i = m.fuente.indexOf('\r\n\r\n');
    return i < 0 ? m.fuente : m.fuente.slice(0, i + 4);
  }
}

// Lo que este servidor dice saber hacer. Se usa en el saludo y en CAPABILITY: tienen que decir
// lo mismo, como en un servidor real.
function capacidadesDe(buzon) {
  return [
    'IMAP4rev1', 'UIDPLUS', 'NAMESPACE',
    ...(buzon.special ? ['SPECIAL-USE'] : []),
    ...(buzon.token ? ['AUTH=XOAUTH2', 'SASL-IR'] : []),
    ...(buzon.soloOauth ? ['LOGINDISABLED'] : []),
  ];
}

export function levantar(buzon) {
  const servidor = net.createServer((socket) => {
    let seleccionada = null;
    let soloLectura = false;
    let buffer = '';
    let literalPendiente = null;
    // Trozo de orden ya leído cuando la orden venía partida por un literal. Un cliente manda
    // «UID SEARCH SUBJECT {12}» + los bytes + el resto: con «Señalamiento» (una ñ basta) la
    // búsqueda viajaba así y el servidor de pruebas no la entendía.
    let lineaParcial = '';
    // Respuestas de un intercambio SASL en curso (XOAUTH2).
    let pendienteSasl = null;
    let esperaCierreSasl = null;

    const escribir = (t) => { try { socket.write(t.endsWith('\r\n') ? t : `${t}\r\n`); } catch { /* cerrada */ } };
    // El saludo lleva la lista de capacidades COMPLETA, como los servidores de verdad: un
    // cliente decide con ella si puede usar XOAUTH2 y, si no la ve, ni lo intenta («Unsupported
    // authentication mechanism») sin llegar a preguntar.
    escribir(`* OK [CAPABILITY ${capacidadesDe(buzon).join(' ')}] Servidor de pruebas de RobinSearch`);

    const atender = (linea) => {
      const m = /^(\S+)\s+(\S+)\s*([\s\S]*)$/.exec(linea);
      if (!m) return escribir('* BAD orden sin etiqueta');
      const [, etiqueta, ordenBruta, resto] = m;
      const orden = ordenBruta.toUpperCase();
      buzon.registro.push(`${orden} ${resto}`.trim());
      if (buzon.cortarEn && orden === buzon.cortarEn) { socket.destroy(); return; }

      if (orden === 'CAPABILITY') {
        escribir(`* CAPABILITY ${capacidadesDe(buzon).join(' ')}`);
        return escribir(`${etiqueta} OK CAPABILITY`);
      }
      if (orden === 'ID') return escribir(`* ID NIL\r\n${etiqueta} OK ID`);
      // Sin NAMESPACE, imapflow deduce el prefijo mirando el LIST y se inventaba rutas del tipo
      // «INBOX.Trash.INBOX.Drafts»: un APPEND a la carpeta de borradores acababa en ninguna parte.
      if (orden === 'NAMESPACE') {
        escribir(`* NAMESPACE (("" "${buzon.delimitador}")) NIL NIL`);
        return escribir(`${etiqueta} OK NAMESPACE`);
      }
      if (orden === 'NOOP') return escribir(`${etiqueta} OK NOOP`);
      if (orden === 'LOGOUT') { escribir('* BYE'); escribir(`${etiqueta} OK LOGOUT`); return socket.end(); }
      // XOAUTH2: «AUTHENTICATE XOAUTH2 <base64>», o sin el base64 y con continuación.
      if (orden === 'AUTHENTICATE') {
        const [, mecanismo, inicial] = /^(\S+)\s*([\s\S]*)$/.exec(resto) || [];
        if (String(mecanismo).toUpperCase() !== 'XOAUTH2' || !buzon.token) {
          return escribir(`${etiqueta} NO mecanismo no soportado`);
        }
        const comprobar = (b64) => {
          let claro = '';
          try { claro = Buffer.from(String(b64).trim(), 'base64').toString('utf8'); } catch { /* basura */ }
          const u = /user=([^\u0001]+)/.exec(claro);
          const t = /auth=Bearer ([^\u0001]+)/.exec(claro);
          if (u && t && u[1] === buzon.usuario && t[1] === buzon.token) return escribir(`${etiqueta} OK AUTHENTICATE`);
          // Así responde un servidor de verdad a un token caducado: un reto en base64 que el
          // cliente tiene que contestar con una línea vacía antes de recibir el NO.
          escribir(`+ ${Buffer.from(JSON.stringify({ status: '401', schemes: 'Bearer', scope: 'mail' })).toString('base64')}`);
          esperaCierreSasl = etiqueta;
        };
        if (inicial) return comprobar(inicial);
        pendienteSasl = comprobar;
        return escribir('+ ');
      }
      if (orden === 'LOGIN') {
        if (buzon.soloOauth) return escribir(`${etiqueta} NO [AUTHENTICATIONFAILED] LOGIN is disabled`);
        // Los dos argumentos pueden ir entre comillas Y la contraseña puede acabar en ESPACIO:
        // recortarlo «por si acaso» hacía que una contraseña legítima se rechazara.
        const partes = [...String(resto).matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)]
          .map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]));
        const [u, c] = partes;
        if (u !== buzon.usuario || c !== buzon.clave) return escribir(`${etiqueta} NO [AUTHENTICATIONFAILED] Authentication failed.`);
        return escribir(`${etiqueta} OK LOGIN`);
      }
      if (orden === 'LIST' || orden === 'LSUB') {
        for (const [ruta, c] of buzon.carpetas) {
          const marcas = [c.especial && buzon.special ? c.especial : null].filter(Boolean);
          escribir(`* ${orden} (${marcas.join(' ')}) "${buzon.delimitador}" ${cita(ruta)}`);
        }
        return escribir(`${etiqueta} OK ${orden}`);
      }
      if (orden === 'SELECT' || orden === 'EXAMINE') {
        const ruta = (resto.trim().replace(/^"|"$/g, ''));
        const c = buzon.carpetas.get(ruta);
        if (!c) return escribir(`${etiqueta} NO [NONEXISTENT] No existe esa carpeta`);
        seleccionada = ruta;
        soloLectura = orden === 'EXAMINE';
        escribir(`* ${c.mensajes.length} EXISTS`);
        escribir('* 0 RECENT');
        escribir('* FLAGS (\\Seen \\Draft \\Deleted \\Answered \\Flagged)');
        escribir(`* OK [UIDVALIDITY ${buzon.uidValidity}]`);
        escribir(`* OK [UIDNEXT ${buzon.siguienteUid.get(ruta)}]`);
        return escribir(`${etiqueta} OK [${soloLectura ? 'READ-ONLY' : 'READ-WRITE'}] ${orden}`);
      }
      if (orden === 'UID') {
        const m2 = /^(\S+)\s*([\s\S]*)$/.exec(resto);
        return atenderUid(etiqueta, (m2?.[1] || '').toUpperCase(), m2?.[2] || '');
      }
      if (orden === 'APPEND') return escribir(`${etiqueta} BAD APPEND sin literal`);
      if (orden === 'CLOSE') { seleccionada = null; return escribir(`${etiqueta} OK CLOSE`); }
      return escribir(`${etiqueta} BAD orden no soportada por el servidor de pruebas: ${orden}`);
    };

    const mensajes = () => buzon.carpetas.get(seleccionada)?.mensajes || [];

    function filtrar(criterio) {
      const c = criterio.trim();
      let out = mensajes();
      // Un cliente IMAP solo entrecomilla lo que lo necesita: «FROM vidal» viaja sin comillas.
      const de = /FROM\s+(?:"([^"]*)"|(\S+))/i.exec(c);
      const asunto = /SUBJECT\s+(?:"([^"]*)"|(\S+))/i.exec(c);
      const desde = /SINCE\s+(\S+)/i.exec(c);
      const hasta = /BEFORE\s+(\S+)/i.exec(c);
      const valor = (m) => (m[1] !== undefined ? m[1] : m[2]).toLowerCase();
      if (de) out = out.filter((m) => String(m.de).toLowerCase().includes(valor(de)));
      if (asunto) out = out.filter((m) => String(m.asunto).toLowerCase().includes(valor(asunto)));
      if (/\bUNSEEN\b/i.test(c)) out = out.filter((m) => !m.banderas.has('\\Seen'));
      if (desde) out = out.filter((m) => m.fecha >= new Date(desde[1].replace(/-/g, ' ')));
      if (hasta) out = out.filter((m) => m.fecha < new Date(hasta[1].replace(/-/g, ' ')));
      return out;
    }

    function enRango(rango) {
      const uids = new Set();
      for (const trozo of rango.split(',')) {
        const [a, b] = trozo.split(':');
        for (const m of mensajes()) {
          const alto = b === '*' ? Infinity : Number(b ?? a);
          if (m.uid >= Number(a) && m.uid <= alto) uids.add(m.uid);
        }
      }
      return mensajes().filter((m) => uids.has(m.uid));
    }

    function atenderUid(etiqueta, sub, resto) {
      if (sub === 'SEARCH') {
        const encontrados = filtrar(resto);
        escribir(`* SEARCH ${encontrados.map((m) => m.uid).join(' ')}`.trim());
        return escribir(`${etiqueta} OK UID SEARCH`);
      }
      if (sub === 'FETCH') {
        const [, rango, queBruto] = /^(\S+)\s+([\s\S]*)$/.exec(resto) || [];
        const que = String(queBruto || '').toUpperCase();
        for (const m of enRango(rango || '')) {
          const seq = mensajes().indexOf(m) + 1;
          const piezas = [`UID ${m.uid}`];
          if (que.includes('FLAGS')) piezas.push(`FLAGS (${[...m.banderas].join(' ')})`);
          if (que.includes('ENVELOPE')) piezas.push(`ENVELOPE ${buzon.envelope(m)}`);
          if (que.includes('BODYSTRUCTURE')) piezas.push(`BODYSTRUCTURE ${buzon.bodystructure(m)}`);
          if (que.includes('RFC822.SIZE')) piezas.push(`RFC822.SIZE ${m.fuente.length}`);
          // Una respuesta sin etiqueta va en UNA línea: el «)» de cierre NO puede ir en otra
          // (imapflow responde «ParserError» y el FETCH se pierde entero).
          socket.write(`* ${seq} FETCH (${piezas.join(' ')}`);
          // Las partes del cuerpo van como literales: {n}\r\n<bytes>
          const partes = [...que.matchAll(/BODY(?:\.PEEK)?\[([^\]]*)\](?:<(\d+)\.(\d+)>)?/g)];
          for (const [, parte, desde, largo] of partes) {
            let datos;
            const mime = /^(\d+)\.MIME$/i.exec(parte);
            const numero = /^(\d+)$/.exec(parte);
            const ps = buzon.partes(m);
            if (!parte) datos = m.fuente;
            else if (/^HEADER/i.test(parte)) datos = buzon.cabecerasDe(m);
            else if (mime && ps[Number(mime[1]) - 1]) datos = ps[Number(mime[1]) - 1].cabeceras;
            else if (numero && ps[Number(numero[1]) - 1]) datos = ps[Number(numero[1]) - 1].cuerpo;
            else datos = buzon.cuerpoDe(m);
            if (desde !== undefined) datos = datos.slice(Number(desde), Number(desde) + Number(largo));
            // La clave se devuelve EN MINÚSCULAS y sin el «<origen>»: es como la indexa imapflow
            // (tools.js), y con «BODY[TEXT]<0>» la parte llegaba vacía sin dar ningún error.
            socket.write(` BODY[${parte.toLowerCase()}] {${datos.length}}\r\n`);
            socket.write(datos);
          }
          socket.write(')\r\n');
        }
        return escribir(`${etiqueta} OK UID FETCH`);
      }
      if (sub === 'STORE') {
        const [, rango, resto2] = /^(\S+)\s+([\s\S]*)$/.exec(resto) || [];
        const banderas = (resto2.match(/\\\w+/g) || []);
        const quitar = /^-/.test(resto2.trim());
        for (const m of enRango(rango || '')) {
          for (const b of banderas) { if (quitar) m.banderas.delete(b); else m.banderas.add(b); }
          escribir(`* ${mensajes().indexOf(m) + 1} FETCH (UID ${m.uid} FLAGS (${[...m.banderas].join(' ')}))`);
        }
        return escribir(`${etiqueta} OK UID STORE`);
      }
      if (sub === 'EXPUNGE') {
        const carpeta = buzon.carpetas.get(seleccionada);
        const fuera = enRango((/^(\S+)/.exec(resto) || [])[1] || '');
        carpeta.mensajes = carpeta.mensajes.filter((m) => !fuera.includes(m));
        for (const m of fuera) escribir(`* ${m.uid} EXPUNGE`);
        return escribir(`${etiqueta} OK UID EXPUNGE`);
      }
      return escribir(`${etiqueta} BAD UID ${sub} no soportado`);
    }

    // APPEND llega con literal: «tag APPEND "carpeta" (\Draft) "fecha" {1234}» y después los bytes.
    socket.on('data', (trozo) => {
      buffer += trozo.toString('binary');
      for (;;) {
        if (literalPendiente) {
          if (buffer.length < literalPendiente.bytes) return;
          const datos = Buffer.from(buffer.slice(0, literalPendiente.bytes), 'binary');
          buffer = buffer.slice(literalPendiente.bytes);
          if (literalPendiente.orden) {
            lineaParcial = `${literalPendiente.previo}"${datos.toString('utf8').replace(/"/g, '\\"')}"`;
            literalPendiente = null;
            continue;
          }
          const { etiqueta, ruta, banderas } = literalPendiente;
          literalPendiente = null;
          const carpeta = buzon.carpetas.get(ruta);
          if (!carpeta) { escribir(`${etiqueta} NO [TRYCREATE] No existe esa carpeta`); }
          else {
            const uid = buzon.siguienteUid.get(ruta);
            buzon.siguienteUid.set(ruta, uid + 1);
            const cabeceras = datos.toString('utf8');
            const asunto = (/^Subject:\s*(.*)$/im.exec(cabeceras) || [])[1] || '';
            const id = (/^Message-ID:\s*(.*)$/im.exec(cabeceras) || [])[1] || null;
            carpeta.mensajes.push({
              uid, fuente: datos, banderas: new Set(banderas), asunto,
              de: (/^From:\s*(.*)$/im.exec(cabeceras) || [])[1] || '',
              para: (/^To:\s*(.*)$/im.exec(cabeceras) || [])[1] || '',
              fecha: new Date(), messageId: id, charset: 'utf-8', multiparte: false,
            });
            escribir(`${etiqueta} OK [APPENDUID ${buzon.uidValidity} ${uid}] APPEND`);
          }
          continue;
        }
        const corte = buffer.indexOf('\r\n');
        if (corte < 0) return;
        // El buffer se lee en binario (los literales son bytes); la ORDEN, en cambio, viene en
        // UTF-8: sin decodificarla, «SUBJECT "Señalamiento"» llegaba como «SeÃ±alamiento» y la
        // búsqueda no encontraba nada.
        const linea = lineaParcial + Buffer.from(buffer.slice(0, corte), 'binary').toString('utf8');
        lineaParcial = '';
        buffer = buffer.slice(corte + 2);
        const ap = /^(\S+)\s+APPEND\s+"?([^"\s]+)"?\s*(\([^)]*\))?\s*(?:"[^"]*")?\s*\{(\d+)\+?\}$/i.exec(linea);
        if (ap) {
          literalPendiente = { etiqueta: ap[1], ruta: ap[2], banderas: (ap[3] || '').replace(/[()]/g, '').split(/\s+/).filter(Boolean), bytes: Number(ap[4]) };
          buzon.registro.push(`APPEND ${ap[2]} ${ap[3] || ''}`.trim());
          escribir('+ adelante');
          continue;
        }
        // Cualquier otra orden con literal al final: se pide continuación, se leen los bytes y
        // se pegan como texto entrecomillado al resto de la orden.
        const lit = /\{(\d+)\+?\}$/.exec(linea);
        if (lit) {
          literalPendiente = { orden: true, previo: linea.slice(0, lit.index), bytes: Number(lit[1]) };
          escribir('+ adelante');
          continue;
        }
        // Dentro de un intercambio SASL, la línea no es una orden: es la respuesta del cliente.
        if (esperaCierreSasl) {
          const t = esperaCierreSasl;
          esperaCierreSasl = null;
          escribir(`${t} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)`);
          continue;
        }
        if (pendienteSasl) {
          const fn = pendienteSasl;
          pendienteSasl = null;
          fn(linea);
          continue;
        }
        atender(linea);
      }
    });
    socket.on('error', () => { /* el cliente se fue */ });
  });
  return new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve({ servidor, puerto: servidor.address().port })));
}

export default { BuzonFalso, levantar };
