#!/usr/bin/env node
// RobinSearch — servidor MCP local (stdio). Expone las herramientas de búsqueda sobre
// los documentos del expediente. stdout está reservado para el protocolo JSON-RPC de MCP;
// todo el logging va a fichero y stderr.

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

import buscarDocumentos from './tools/buscar_documentos.js';
import indexarCarpeta from './tools/indexar_carpeta.js';
import obtenerFragmento from './tools/obtener_fragmento.js';
import obtenerDocumento from './tools/obtener_documento.js';
import listarDocumentos from './tools/listar_documentos_indexados.js';
import establecerExpedienteActivo from './tools/establecer_expediente_activo.js';
import estadoServidor from './tools/estado_servidor.js';
import siguientePorRevisar from './tools/siguiente_por_revisar.js';
import anotar from './tools/anotar.js';
import obtenerAnotaciones from './tools/obtener_anotaciones.js';

const TOOLS = [
  buscarDocumentos,
  indexarCarpeta,
  obtenerFragmento,
  obtenerDocumento,
  listarDocumentos,
  establecerExpedienteActivo,
  estadoServidor,
  // Barrido exhaustivo del expediente (due diligence sobre lo que no cabe en contexto).
  siguientePorRevisar,
  anotar,
  obtenerAnotaciones,
];

const byName = new Map(TOOLS.map((t) => [t.definition.name, t]));

async function main() {
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
      return await tool.handler(args || {});
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

  // Solo pruebas automáticas: una promesa rechazada que nadie recoge no debe tumbar el servidor.
  if (process.env.ROBIN_PRUEBA_RECHAZO === '1') {
    setTimeout(() => {
      Promise.reject(new Error('rechazo de prueba leyendo /Users/prueba/Expedientes/Pérez - Divorcio/demanda.pdf'));
    }, 300);
  }
}

main().catch((err) => {
  log.error('Fallo fatal al arrancar el servidor', { err: String(err) });
  process.stderr.write(`robin-search: fallo al arrancar: ${err?.message ?? err}\n`);
  process.exit(1);
});
