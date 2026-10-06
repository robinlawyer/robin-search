#!/usr/bin/env node
// RobinSearch — servidor MCP local (stdio). Expone las herramientas de búsqueda sobre
// los documentos del expediente. stdout está reservado para el protocolo JSON-RPC de MCP;
// todo el logging va a fichero y stderr.

// Antes que nada: con un Node demasiado antiguo se dice claro y se sale (version-node.js).
import './version-node.js';
// IMPORTANTE: primero de todo, blindar stdout (redirige console.* de las librerías a stderr).
import './stdio-guard.js';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { bootstrap } from './bootstrap.js';
import { fail } from './tools/util.js';
import * as diagnostico from './diagnostico.js';
import * as escritor from './escritor.js';
import * as registry from './indexer/registry.js';
import { usarCertificadosDelSistema, proxyIgnorado } from './red-corporativa.js';
import { piezasDe } from './estructura/piezas.js';

import buscarDocumentos from './tools/buscar_documentos.js';
import indexarCarpeta from './tools/indexar_carpeta.js';
import obtenerFragmento from './tools/obtener_fragmento.js';
import obtenerDocumento from './tools/obtener_documento.js';
import indiceDocumento from './tools/indice_documento.js';
import leerSeccion from './tools/leer_seccion.js';
import listarDocumentos from './tools/listar_documentos_indexados.js';
import establecerExpedienteActivo from './tools/establecer_expediente_activo.js';
import estadoServidor from './tools/estado_servidor.js';
import siguientePorRevisar from './tools/siguiente_por_revisar.js';
import anotar from './tools/anotar.js';
import obtenerAnotaciones from './tools/obtener_anotaciones.js';
import cambiosExpediente from './tools/cambios_expediente.js';
import { HERRAMIENTAS_CONSULTA, alConsultar, expedienteDeLaLlamada } from './consultas.js';
import buscarCorreos from './tools/buscar_correos.js';
import leerCorreo from './tools/leer_correo.js';
import leerAdjunto from './tools/leer_adjunto.js';
import archivarCorreo from './tools/archivar_correo.js';
import guardarBorrador from './tools/guardar_borrador.js';
import enviarCorreo from './tools/enviar_correo.js';

const TOOLS = [
  buscarDocumentos,
  indexarCarpeta,
  obtenerFragmento,
  obtenerDocumento,
  // Buscar por estructura (correo de Juan del 1-oct-2026): el índice de un documento y la lectura
  // de una sección, para seguir las remisiones internas («según el Anexo II»).
  indiceDocumento,
  leerSeccion,
  listarDocumentos,
  establecerExpedienteActivo,
  estadoServidor,
  // Barrido exhaustivo del expediente (due diligence sobre lo que no cabe en contexto).
  siguientePorRevisar,
  anotar,
  obtenerAnotaciones,
  // Delta del data room respecto de lo revisado (1-oct-2026).
  cambiosExpediente,
  // Correo del abogado (1.7.0). Viven aquí, en su ordenador, por la misma razón que los
  // expedientes: la contraseña del buzón de un despacho es el acceso a su correspondencia
  // entera, y esa no la custodiamos nosotros. Se ofrecen siempre; si no hay cuenta conectada,
  // cada una lo dice y explica dónde se conecta.
  buscarCorreos,
  leerCorreo,
  leerAdjunto,
  archivarCorreo,
  guardarBorrador,
  enviarCorreo,
];

const byName = new Map(TOOLS.map((t) => [t.definition.name, t]));

async function main() {
  // Antes de cualquier conexión: los certificados raíz que IT instala en el sistema (red-corporativa.js).
  const certificados = usarCertificadosDelSistema();
  log.info('Certificados del sistema', certificados);
  if (proxyIgnorado()) {
    log.warn('Hay un proxy configurado en el entorno pero Node no lo usa (falta NODE_USE_ENV_PROXY=1)');
  }

  // Salida ordenada (Claude cierra, SIGTERM, stdin cerrado) frente a caída: la primera suelta el
  // índice y borra la marca de fase; una caída deja la marca y el siguiente arranque la atiende.
  // Antes, una promesa rechazada sin capturar tumbaba el proceso en silencio.
  const { salirLimpio } = diagnostico.instalarManejadores({
    alCerrar: () => {
      registry.guardarPendiente();
      escritor.soltar();
    },
  });

  const server = new Server(
    { name: 'robin-search', version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.definition.name,
      title: t.definition.title,
      description: t.definition.description,
      inputSchema: t.definition.inputSchema,
      annotations: t.definition.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = byName.get(name);
    if (!tool) return fail(`Herramienta desconocida: ${name}`);
    try {
      const res = await tool.handler(args || {});
      // 6-oct-2026 (Juan): en la primera consulta sobre un expediente tras una pausa, lo que ha
      // cambiado desde la última vez, para que Claude se lo diga al abogado sin que lo pregunte.
      if (HERRAMIENTAS_CONSULTA.has(name) && !res?.isError && res?.structuredContent) {
        const cambios = alConsultar(expedienteDeLaLlamada(args));
        if (cambios) {
          res.structuredContent = { ...res.structuredContent, cambios_desde_tu_ultima_consulta: cambios };
          res.content = [
            { type: 'text', text: JSON.stringify(res.structuredContent, null, 2) },
            ...(res.content || []).slice(1),
          ];
        }
      }
      // PUNTO DE RESPUESTA ÚNICO: todo lo que devuelven las herramientas vuelve a Claude por aquí.
      // Aquí va el filtro de salida del anonimizador cuando se enchufe. Las herramientas de
      // estructura (indice_documento, leer_seccion y la sección de cada fragmento de
      // buscar_documentos) dejan en piezasDe(res) qué texto del despacho llevan y en qué posición
      // del documento, para tapar con el documento entero a la vista (condición de Juan, 1-oct-2026).
      if (process.env.ROBIN_PRUEBA_PIEZAS === '1' && res?.structuredContent) {
        res.structuredContent = { ...res.structuredContent, _piezas_prueba: piezasDe(res).flatMap((d) => d.piezas.map((p) => p.valor)) };
      }
      return res;
    } catch (err) {
      log.error('Error ejecutando herramienta', { name, err: String(err) });
      return fail(`Error ejecutando ${name}: ${err?.message ?? err}`);
    }
  });

  server.onclose = () => salirLimpio('cliente_desconectado');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Sin esto, al cerrar Claude el proceso seguía vivo (el watcher lo mantiene) hasta que lo
  // mataban a la fuerza: un huérfano con el índice abierto. Solo si llegó a hablar un cliente:
  // lanzado sin entrada (stdin a /dev/null: pruebas, un servicio de IT), el fin de stdin llega
  // al instante y no significa que nadie se haya ido.
  let huboCliente = false;
  process.stdin.on('data', () => {
    huboCliente = true;
  });
  process.stdin.on('end', () => {
    if (huboCliente) salirLimpio('stdin_cerrado');
  });
  log.info('Servidor MCP conectado (stdio)', { carpeta: config.watchedFolder });
  // HUELLA en el registro de Claude (23-sep-2026). Claude guarda lo que el servidor
  // escribe por stderr en «mcp-server-<nombre>.log», y ese <nombre> lo pone la
  // instalación: en tres equipos Windows de la 1.8.4 no había NINGÚN fichero cuyo
  // nombre contuviera «robinsearch» (claude_log: sin_fichero), así que toda
  // reapertura volvía a quedar como caída INCIERTA. Con esta línea nuestro registro
  // se reconoce por lo que DICE y no por cómo se llame el fichero. stderr es seguro
  // en MCP stdio: stdout está reservado al protocolo JSON-RPC.
  // 🔴 29-sep-2026: con el Node que trae Claude (UtilityProcess) stderr acaba en main.log,
  // no en «mcp-server-<nombre>.log»; el registro se reconoce sobre todo por la ETIQUETA
  // con que Claude firma nuestras líneas (diagnostico.js, fuenteLogClaude).
  process.stderr.write(`robin-search: servidor listo (v${VERSION})\n`);

  // El indexado inicial y el watcher arrancan en segundo plano: el servidor responde
  // desde el primer momento (estado_servidor informará "indexando"). Se espera a que Claude
  // termine el saludo (`initialized`): arrancar antes metía trabajo síncrono entre la llegada de
  // `initialize` y su respuesta, y con un índice grande Claude cortaba por tiempo. Sin cliente
  // (pruebas, servicio de IT) se arranca igual a los pocos segundos.
  let arrancado = false;
  const arrancar = () => {
    if (arrancado) return;
    arrancado = true;
    bootstrap({ initialIndex: true, watch: true, warmModel: true, control: true }).catch((err) =>
      log.error('Fallo en bootstrap', { err: String(err) }),
    );
  };
  server.oninitialized = () => setImmediate(arrancar);
  setTimeout(arrancar, 3000); // sin unref: sin cliente, es lo que mantiene vivo el proceso
}

main().catch((err) => {
  log.error('Fallo fatal al arrancar el servidor', { err: String(err) });
  process.stderr.write(`robin-search: fallo al arrancar: ${err?.message ?? err}\n`);
  process.exit(1);
});
