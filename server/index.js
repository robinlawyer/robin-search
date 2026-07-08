#!/usr/bin/env node
// Robin Search — servidor MCP local (stdio). Expone las 5 herramientas de búsqueda sobre
// los documentos del expediente. stdout está reservado para el protocolo JSON-RPC de MCP;
// todo el logging va a fichero y stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { config, VERSION } from './config.js';
import { log } from './logger.js';
import { bootstrap } from './bootstrap.js';
import { fail } from './tools/util.js';

import buscarDocumentos from './tools/buscar_documentos.js';
import indexarCarpeta from './tools/indexar_carpeta.js';
import obtenerFragmento from './tools/obtener_fragmento.js';
import listarDocumentos from './tools/listar_documentos_indexados.js';
import estadoServidor from './tools/estado_servidor.js';

const TOOLS = [
  buscarDocumentos,
  indexarCarpeta,
  obtenerFragmento,
  listarDocumentos,
  estadoServidor,
];

const byName = new Map(TOOLS.map((t) => [t.definition.name, t]));

async function main() {
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('Servidor MCP conectado (stdio)', { carpeta: config.watchedFolder });

  // El indexado inicial y el watcher arrancan en segundo plano: el servidor responde
  // desde el primer momento (estado_servidor informará "indexando").
  bootstrap({ initialIndex: true, watch: true, warmModel: true }).catch((err) =>
    log.error('Fallo en bootstrap', { err: String(err) }),
  );
}

main().catch((err) => {
  log.error('Fallo fatal al arrancar el servidor', { err: String(err) });
  process.stderr.write(`robin-search: fallo al arrancar: ${err?.message ?? err}\n`);
  process.exit(1);
});
