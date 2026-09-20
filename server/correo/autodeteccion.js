// Averiguar el servidor de correo a partir de la dirección, sin preguntarle nada al abogado.
//
// NO SE CONSULTA LA BASE DE DATOS DE MOZILLA (autoconfig.thunderbird.net), que es lo que hacen
// Thunderbird y Outlook. Preguntarle a un tercero «¿cuál es el servidor de asesoria-ibc.com?»
// es contarle a ese tercero dónde tiene el correo este despacho — justo lo contrario de lo que
// vendemos. Aquí solo se habla con el DNS del dominio del propio abogado y con su servidor.
//
// Dos vías, por orden:
//   1. RFC 6186: los registros SRV que el dominio publica para decir dónde está su correo.
//   2. Los nombres de toda la vida (mail./imap./smtp.<dominio>), comprobados de verdad
//      abriendo el puerto y leyendo el saludo del servidor. Un DNS comodín («*.dominio»)
//      resuelve cualquier nombre: sin abrir el puerto, la detección se inventaba servidores.

import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

const ESPERA_MS = 4000;

export function dominioDe(direccion) {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(String(direccion || '').trim());
  return m ? m[1].toLowerCase() : null;
}

async function srv(nombre) {
  try {
    const rs = await dns.resolveSrv(nombre);
    return rs
      .filter((r) => r.name && r.name !== '.')   // "." = «este servicio no se ofrece» (RFC 2782)
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight)
      .map((r) => ({ host: r.name.replace(/\.$/, ''), puerto: r.port }));
  } catch {
    return [];
  }
}

// Abre el puerto y lee el saludo. Devuelve { saludo, certificado } — `saludo` es null si ahí no
// hay servidor de correo (o si el certificado no vale). Es la única prueba de que ahí hay un
// servidor y no un comodín del DNS apuntando a la web del despacho.
//
// El certificado importa MÁS de lo que parece: en el hosting compartido español el servidor
// responde en «mail.tu-dominio.es» pero presenta un certificado a nombre del proveedor
// («*.correoseguro.dinaserver.com», comprobado el 20-sep-2026 con el buzón de un cliente real).
// La conexión se rechaza, como debe ser, pero el nombre que sí vale está DENTRO del certificado
// rechazado: se guarda para probarlo después, en vez de decirle al abogado que no hay servidor.
export function saludo(host, puerto, { seguro = true, esperaMs = ESPERA_MS } = {}) {
  return new Promise((resolve) => {
    let socket;
    let texto = '';
    let hecho = false;
    let certificado = null;
    const fin = (linea) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(tope);
      try { socket?.destroy(); } catch { /* ya cerrado */ }
      resolve({ saludo: linea, certificado });
    };
    const tope = setTimeout(() => fin(null), esperaMs);
    try {
      socket = seguro
        // `servername` para SNI: sin él, un servidor compartido presenta el certificado de otro
        // dominio. `rejectUnauthorized` se deja en su valor por defecto (validar).
        ? tls.connect({ host, port: puerto, servername: host }, () => { /* a esperar el saludo */ })
        : net.connect({ host, port: puerto });
    } catch {
      return fin(null);
    }
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      texto += d;
      if (texto.includes('\n')) fin(texto.split('\n')[0].trim());
    });
    socket.on('error', (err) => {
      // El único error del que se saca algo: el certificado es válido pero es de otro nombre.
      if (err?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        const nombres = String(err.message || '').match(/DNS:([^\s,]+)/g) || [];
        certificado = { motivo: 'nombre_no_coincide', nombres: nombres.map((n) => n.slice(4)) };
      }
      fin(null);
    });
    socket.on('close', () => fin(texto ? texto.split('\n')[0].trim() : null));
  });
}

// Qué anuncia el servidor que sabe hacer. Importa una cosa por encima de todo: «LOGINDISABLED».
// Microsoft lo anuncia en outlook.office365.com Y en imap-mail.outlook.com (comprobado en vivo
// el 20-sep-2026): ahí la contraseña NO sirve, solo OAuth, y el servidor no lo dice de otra
// forma. Sin esto, el abogado ve «usuario o contraseña incorrectos», jura que son correctos y
// la llamada acaba en soporte.
export function capacidades(host, puerto, { esperaMs = ESPERA_MS } = {}) {
  return new Promise((resolve) => {
    let texto = '';
    let pedido = false;
    let hecho = false;
    const fin = (v) => { if (!hecho) { hecho = true; clearTimeout(tope); try { socket.destroy(); } catch { /* nada */ } resolve(v); } };
    const tope = setTimeout(() => fin(null), esperaMs);
    let socket;
    try {
      socket = tls.connect({ host, port: puerto, servername: host });
    } catch {
      return resolve(null);
    }
    socket.setEncoding('utf8');
    socket.on('data', (d) => {
      texto += d;
      if (!pedido && texto.includes('\n')) { pedido = true; socket.write('rs CAPABILITY\r\n'); return; }
      const m = /^\* CAPABILITY (.*)$/im.exec(texto);
      if (m) fin(m[1].trim().toUpperCase().split(/\s+/));
    });
    socket.on('error', () => fin(null));
    socket.on('close', () => fin(null));
  });
}

// ¿Este servidor solo admite OAuth? (Microsoft 365 y Outlook.com personal, hoy.)
export function exigeOauth(caps) {
  return Array.isArray(caps) && caps.includes('LOGINDISABLED') && caps.some((c) => c.startsWith('AUTH=XOAUTH2'));
}

const esImap = (s) => /^\*\s+OK/i.test(s || '');
const esSmtp = (s) => /^220[\s-]/.test(s || '');

// Un SMTP en el 587 saluda EN CLARO y solo sube a TLS con STARTTLS, así que el saludo no dice
// nada del certificado: el fallo aparecía después, al enviar, con un «certificado no válido»
// que el abogado no sabe traducir. Aquí se hace el STARTTLS de verdad y se valida el
// certificado, igual que hará nodemailer al mandar el correo.
function starttls(host, puerto, esperaMs = ESPERA_MS) {
  return new Promise((resolve) => {
    let socket;
    let certificado = null;
    let fase = 'saludo';
    let buffer = '';
    let hecho = false;
    const fin = (ok) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(tope);
      try { socket?.destroy(); } catch { /* ya cerrado */ }
      resolve({ ok, certificado });
    };
    const tope = setTimeout(() => fin(false), esperaMs);
    try {
      socket = net.connect({ host, port: puerto });
    } catch {
      return fin(false);
    }
    socket.setEncoding('utf8');
    socket.on('error', () => fin(false));
    socket.on('close', () => fin(false));
    socket.on('data', (d) => {
      buffer += d;
      if (!/\r?\n$/.test(buffer)) return;
      const texto = buffer;
      buffer = '';
      if (fase === 'saludo') {
        if (!esSmtp(texto)) return fin(false);
        fase = 'ehlo';
        socket.write('EHLO robinsearch.local\r\n');
      } else if (fase === 'ehlo') {
        if (!/STARTTLS/i.test(texto)) return fin(false);
        fase = 'starttls';
        socket.write('STARTTLS\r\n');
      } else if (fase === 'starttls') {
        if (!/^220/.test(texto)) return fin(false);
        fase = 'tls';
        socket.removeAllListeners('data');
        const seguro = tls.connect({ socket, servername: host }, () => fin(true));
        seguro.on('error', (err) => {
          if (err?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
            const nombres = String(err.message || '').match(/DNS:([^\s,]+)/g) || [];
            certificado = { motivo: 'nombre_no_coincide', nombres: nombres.map((n) => n.slice(4)) };
          }
          fin(false);
        });
      }
    });
  });
}

// Nombres que sugiere un certificado rechazado. Un comodín «*.proveedor.com» no se puede usar
// tal cual, pero el hosting compartido nombra cada buzón por su dominio con guiones
// («asesoria-ibc-com.correoseguro.dinaserver.com»): se deriva y se prueba. Si el certificado
// trae un nombre concreto, ese también.
function nombresDelCertificado(certificado, dominio) {
  const out = [];
  for (const n of certificado?.nombres || []) {
    if (n.startsWith('*.')) out.push(`${dominio.replace(/\./g, '-')}.${n.slice(2)}`);
    else out.push(n);
  }
  return [...new Set(out)];
}

// Recorre candidatos hasta que uno conteste lo que tiene que contestar. Si ninguno contesta pero
// alguno se quedó a las puertas por el nombre del certificado, se prueban los nombres que el
// propio certificado señala — que es como se configura de verdad el hosting compartido.
async function primeroQueResponda(candidatos, valido, dominio) {
  const porCertificado = [];
  const probar = async (c) => {
    // En STARTTLS no basta el saludo: hay que subir a TLS para ver el certificado.
    if (c.seguridad === 'starttls') {
      const r = await starttls(c.host, c.puerto);
      return { vale: r.ok, certificado: r.certificado };
    }
    const r = await saludo(c.host, c.puerto, { seguro: c.seguro !== false });
    return { vale: valido(r.saludo), certificado: r.certificado, saludo: r.saludo };
  };
  for (const c of candidatos) {
    const r = await probar(c);
    if (r.vale) return { ...c, saludo: r.saludo };
    if (r.certificado && dominio) {
      for (const host of nombresDelCertificado(r.certificado, dominio)) porCertificado.push({ ...c, host });
    }
  }
  for (const c of porCertificado) {
    const r = await probar(c);
    if (r.vale) return { ...c, saludo: r.saludo, viaCertificado: true };
  }
  return null;
}

// Devuelve { imap, smtp, via } con lo que se haya podido confirmar. Lo que no se confirme
// queda a null: es mejor que el abogado lo rellene en «Ajustes avanzados» a que RobinSearch
// se invente un servidor y luego falle el login con un mensaje que no se entiende.
export async function detectar(direccion) {
  const dominio = dominioDe(direccion);
  if (!dominio) return { error: 'La dirección de correo no es válida.' };

  const via = { imap: null, smtp: null };

  // 1. SRV. `_imaps` es IMAP sobre TLS directo (993); `_submission`, SMTP de envío (587);
  //    `_submissions`, SMTP sobre TLS directo (465).
  const srvImap = [...(await srv(`_imaps._tcp.${dominio}`)).map((x) => ({ ...x, tls: true }))];
  const srvSmtp = [
    ...(await srv(`_submissions._tcp.${dominio}`)).map((x) => ({ ...x, seguridad: 'tls', seguro: true })),
    ...(await srv(`_submission._tcp.${dominio}`)).map((x) => ({ ...x, seguridad: 'starttls', seguro: false })),
  ];

  let imap = await primeroQueResponda(srvImap, esImap, dominio);
  if (imap) via.imap = 'srv';
  let smtp = await primeroQueResponda(srvSmtp, esSmtp, dominio);
  if (smtp) via.smtp = 'srv';

  // 2. Los nombres de siempre. El orden importa: `mail.` es con diferencia el más común en
  //    hosting español (Dinahosting, Arsys, CDmon, 1&1) y se prueba primero.
  const nombres = ['mail', 'imap', 'correo', 'smtp', 'mx'];
  if (!imap) {
    const candidatos = [...nombres, null].map((p) => ({ host: p ? `${p}.${dominio}` : dominio, puerto: 993, tls: true, seguro: true }));
    imap = await primeroQueResponda(candidatos, esImap, dominio);
    if (imap) via.imap = imap.viaCertificado ? 'certificado' : 'convencion';
  }
  if (!smtp) {
    const candidatos = [];
    for (const p of [...nombres, null]) {
      const host = p ? `${p}.${dominio}` : dominio;
      candidatos.push({ host, puerto: 587, seguridad: 'starttls', seguro: false });
      candidatos.push({ host, puerto: 465, seguridad: 'tls', seguro: true });
    }
    smtp = await primeroQueResponda(candidatos, esSmtp, dominio);
    if (smtp) via.smtp = smtp.viaCertificado ? 'certificado' : 'convencion';
  }

  // El saludo del servidor puede llevar su nombre de máquina: no se devuelve hacia arriba.
  return {
    dominio,
    imap: imap ? { host: imap.host, puerto: imap.puerto, tls: true } : null,
    smtp: smtp ? { host: smtp.host, puerto: smtp.puerto, seguridad: smtp.seguridad } : null,
    via,
  };
}

export default { detectar, dominioDe, saludo, capacidades, exigeOauth };
