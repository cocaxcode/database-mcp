import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { DumpManager } from '../services/dump-manager.js'
import type { Storage } from '../lib/storage.js'
import { SchemaIntrospector } from '../services/schema-introspector.js'
import { text, error } from '../lib/response.js'

export function registerDumpTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
  dumpMgr: DumpManager,
): void {
  // ── db_dump ──
  server.tool(
    'db_dump',
    'Exporta la base de datos a un archivo SQL. Flujo conversacional: primero pregunta si exportar todas las tablas o personalizar, luego que contenido incluir (estructura, datos o todo).',
    {
      scope: z.enum(['all', 'custom']).optional().describe('all = todas las tablas, custom = elegir tablas. Si no se pasa, pregunta.'),
      content: z.enum(['schema', 'data', 'full']).optional().describe('schema = solo estructura, data = solo datos, full = todo. Si no se pasa, pregunta.'),
      tables: z.array(z.string()).optional().describe('Tablas a exportar (solo cuando scope="custom").'),
      schema: z.string().optional().describe('Schema de PostgreSQL (default: public)'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'

        // Paso 1: Si no se paso scope, preguntar total o personalizada
        if (!params.scope) {
          return text(
            'Como quieres exportar?\n\n' +
            '1. **Todas las tablas** → llama db_dump con scope="all"\n' +
            '2. **Personalizar tablas** → llama db_dump con scope="custom"\n\n' +
            'Elige una opcion.',
          )
        }

        // Paso 2: Si scope=custom y no se pasaron tablas, listar disponibles con conteos
        if (params.scope === 'custom' && !params.tables) {
          const tables = await SchemaIntrospector.getTables(driver, {
            schema: params.schema,
            objectType: 'table',
            detailLevel: 'names',
          })

          if (tables.length === 0) {
            return error('No se encontraron tablas en la base de datos')
          }

          const counts: { name: string; rows: number }[] = []
          let totalRows = 0

          for (const t of tables) {
            try {
              const result = await driver.execute(`SELECT COUNT(*) as cnt FROM "${t.name}"`)
              const cnt = Number(result.rows[0]?.cnt ?? 0)
              counts.push({ name: t.name, rows: cnt })
              totalRows += cnt
            } catch {
              counts.push({ name: t.name, rows: -1 })
            }
          }

          const maxNameLen = Math.max(...counts.map((c) => c.name.length))
          const tableList = counts.map((c) => {
            const rowsStr = c.rows >= 0 ? `${c.rows.toLocaleString()} filas` : 'error al contar'
            return `  - ${c.name.padEnd(maxNameLen)}  (${rowsStr})`
          }).join('\n')

          return text(
            `Tablas disponibles (${tables.length}, ${totalRows.toLocaleString()} filas en total):\n\n${tableList}\n\n` +
            'Que tablas quieres exportar?\n\n' +
            `Llama db_dump con scope="custom" y tables=["tabla1", "tabla2"]`,
          )
        }

        // Paso 3: Si no se paso content, preguntar que incluir
        if (!params.content) {
          const scopeParam = params.scope === 'all'
            ? 'scope="all"'
            : `scope="custom" tables=${JSON.stringify(params.tables)}`

          return text(
            'Que contenido quieres exportar?\n\n' +
            `1. **Solo estructura** (CREATE TABLE, indices, FKs) → llama db_dump con ${scopeParam} content="schema"\n` +
            `2. **Solo datos** (INSERT statements) → llama db_dump con ${scopeParam} content="data"\n` +
            `3. **Todo** (estructura + datos) → llama db_dump con ${scopeParam} content="full"\n\n` +
            'Elige una opcion.',
          )
        }

        // Ejecutar dump
        const result = await dumpMgr.dump(driver, connName, {
          includeSchema: params.content === 'schema' || params.content === 'full',
          includeData: params.content === 'data' || params.content === 'full',
          tables: params.scope === 'custom' ? params.tables : undefined,
          schema: params.schema,
        })

        const sizeKB = (result.sizeBytes / 1024).toFixed(1)
        const contentLabel = params.content === 'schema'
          ? 'solo estructura'
          : params.content === 'data'
            ? 'solo datos'
            : 'estructura + datos'
        const lines = [
          'Dump completado:',
          '',
          `  Archivo:   ${result.filename}`,
          `  Contenido: ${contentLabel}`,
          `  Tablas:    ${result.tables}`,
          `  Filas:     ${result.totalRows}`,
          `  Tamano:    ${sizeKB} KB`,
          `  Ruta:      ${result.filepath}`,
          '',
          'Para restaurar en otra base de datos, usa db_restore.',
        ]

        return text(lines.join('\n'))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── db_restore ──
  server.tool(
    'db_restore',
    'Restaura un dump SQL en la base de datos activa. IMPORTANTE: esta operacion es destructiva (DROP TABLE + CREATE TABLE). Pide confirmacion al usuario antes de ejecutar con confirm=true.',
    {
      filename: z.string().optional().describe('Nombre del archivo SQL a restaurar (de la carpeta dumps). Si no se pasa, lista los disponibles.'),
      confirm: z.boolean().default(false).describe('Debe ser true para confirmar. Pregunta al usuario antes.'),
    },
    async (params) => {
      try {
        // Si no se paso filename, listar dumps disponibles
        if (!params.filename) {
          const dumps = await dumpMgr.list()

          if (dumps.length === 0) {
            return text('No hay dumps disponibles. Usa db_dump para crear uno primero.')
          }

          const list = dumps.map((d) => {
            const sizeKB = (d.sizeBytes / 1024).toFixed(1)
            return `  - ${d.filename} (${sizeKB} KB, ${d.createdAt})`
          }).join('\n')

          return text(
            `Dumps disponibles:\n\n${list}\n\n` +
            'Llama db_restore con el filename del dump que quieres restaurar.',
          )
        }

        // Verificar modo read-write
        const activeConnName = await storage.getActiveConnection()
        if (activeConnName) {
          const conn = await storage.getConnection(activeConnName)
          if (conn?.mode === 'read-only') {
            return error(`La conexion '${activeConnName}' esta en modo read-only. Cambia a read-write con conn_set.`)
          }
        }

        // Sin confirmacion, mostrar preview
        if (!params.confirm) {
          return text(
            `Estas seguro de restaurar '${params.filename}' en la conexion activa?\n\n` +
            'ATENCION: Esta operacion ejecuta DROP TABLE + CREATE TABLE. Los datos existentes en las tablas afectadas se perderan.\n\n' +
            `Llama db_restore con filename="${params.filename}" y confirm=true para ejecutar.`,
          )
        }

        const driver = await manager.getActiveDriver()
        const result = await dumpMgr.restore(driver, params.filename)

        const lines = [
          'Restauracion completada:',
          '',
          `  Sentencias ejecutadas: ${result.statements}`,
        ]

        if (result.errors.length > 0) {
          lines.push(`  Errores: ${result.errors.length}`)
          lines.push('')
          for (const err of result.errors.slice(0, 10)) {
            lines.push(`  ${err}`)
          }
          if (result.errors.length > 10) {
            lines.push(`  ... y ${result.errors.length - 10} errores mas`)
          }
        } else {
          lines.push('  Errores: 0')
        }

        return text(lines.join('\n'))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── db_dump_list ──
  server.tool(
    'db_dump_list',
    'Lista los dumps disponibles en el proyecto actual.',
    {},
    async () => {
      try {
        const dumps = await dumpMgr.list()

        if (dumps.length === 0) {
          return text('No hay dumps disponibles. Usa db_dump para crear uno.')
        }

        const list = dumps.map((d) => {
          const sizeKB = (d.sizeBytes / 1024).toFixed(1)
          return { filename: d.filename, size: `${sizeKB} KB`, created: d.createdAt }
        })

        return text(JSON.stringify(list, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
