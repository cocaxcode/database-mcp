import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import { SchemaIntrospector } from '../services/schema-introspector.js'

export function registerSchemaResources(
  server: McpServer,
  manager: ConnectionManager,
): void {
  // ── db://schema (static resource) ──
  server.resource(
    'db-schema',
    'db://schema',
    {
      description: 'Schema completo de la base de datos activa (tablas, columnas, FK, indices)',
      mimeType: 'application/json',
    },
    async (uri) => {
      const driver = await manager.getActiveDriver()
      const tables = await SchemaIntrospector.getTables(driver, { detailLevel: 'full' })

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(tables, null, 2),
          },
        ],
      }
    },
  )

  // ── db://tables/{tableName}/schema (dynamic resource) ──
  server.resource(
    'db-table-schema',
    new ResourceTemplate('db://tables/{tableName}/schema', { list: undefined }),
    {
      description: 'Schema de una tabla especifica con columnas, FK e indices',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const tableName = variables.tableName as string
      const driver = await manager.getActiveDriver()
      const tables = await SchemaIntrospector.getTables(driver, {
        pattern: tableName,
        detailLevel: 'full',
      })

      const table = tables.find((t) => t.name === tableName)
      if (!table) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Tabla '${tableName}' no encontrada` }),
            },
          ],
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(table, null, 2),
          },
        ],
      }
    },
  )
}
