import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import { SchemaIntrospector } from '../services/schema-introspector.js'
import type { DetailLevel } from '../lib/types.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerSchemaTools(
  server: McpServer,
  manager: ConnectionManager,
): void {
  // ── search_schema ──
  server.tool(
    'search_schema',
    'Busca tablas/vistas en el schema de la base de datos. Soporta 3 niveles de detalle: names (solo nombres), summary (nombres + columnas), full (todo + FK + indices).',
    {
      object_type: z.enum(['table', 'view', 'all']).default('all').describe('Tipo de objeto a buscar'),
      pattern: z.string().optional().describe('Patron de busqueda (ej: "user%", "%order%")'),
      schema: z.string().optional().describe('Schema (solo PostgreSQL, default: public)'),
      detail_level: z.enum(['names', 'summary', 'full']).default('summary').describe('Nivel de detalle'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const tables = await SchemaIntrospector.getTables(driver, {
          objectType: (params.object_type ?? 'all') as 'table' | 'view' | 'all',
          pattern: params.pattern,
          schema: params.schema,
          detailLevel: (params.detail_level ?? 'summary') as DetailLevel,
        })

        if (tables.length === 0) {
          return text('No se encontraron tablas/vistas con los filtros especificados')
        }

        return text(JSON.stringify(tables, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
