import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { DumpManager } from '../services/dump-manager.js'
import type { Storage } from '../lib/storage.js'
import { SchemaIntrospector } from '../services/schema-introspector.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerDumpTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
  dumpMgr: DumpManager,
): void {
  // ── db_dump ──
  server.tool(
    'db_dump',
    'Exporta la base de datos a un archivo SQL. Permite elegir si exportar solo estructura o tambien datos, y si exportar todas las tablas o solo algunas. Si no se pasan opciones, primero muestra las tablas disponibles para que el usuario elija.',
    {
      mode: z.enum(['schema', 'full']).optional().describe('schema = solo estructura (DDL), full = estructura + datos. Si no se pasa, pregunta al usuario.'),
      tables: z.array(z.string()).optional().describe('Lista de tablas a exportar. Si no se pasa, pregunta al usuario.'),
      all_tables: z.boolean().optional().describe('true para exportar todas las tablas sin preguntar'),
      schema: z.string().optional().describe('Schema de PostgreSQL (default: public)'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'

        // Verificar modo read-write para dumps con datos
        if (params.mode === 'full') {
          const activeConnName = await storage.getActiveConnection()
          if (activeConnName) {
            const conn = await storage.getConnection(activeConnName)
            if (conn?.mode === 'read-only') {
              // read-only puede exportar sin problema, es solo lectura
            }
          }
        }

        // Si no se paso mode, preguntar
        if (!params.mode) {
          return text(
            'Como quieres exportar la base de datos?\n\n' +
            '1. **Solo estructura** (CREATE TABLE, indices, foreign keys) → llama db_dump con mode="schema"\n' +
            '2. **Estructura + datos** (CREATE TABLE + INSERT para cada fila) → llama db_dump con mode="full"\n\n' +
            'Elige una opcion.',
          )
        }

        // Si no se pasaron tablas ni all_tables, listar las disponibles
        if (!params.tables && !params.all_tables) {
          const tables = await SchemaIntrospector.getTables(driver, {
            schema: params.schema,
            objectType: 'table',
            detailLevel: 'names',
          })

          if (tables.length === 0) {
            return error('No se encontraron tablas en la base de datos')
          }

          // En modo full, mostrar conteo de filas por tabla
          if (params.mode === 'full') {
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
              'Que quieres exportar?\n\n' +
              `1. **Todas las tablas** → llama db_dump con mode="full" y all_tables=true\n` +
              `2. **Solo algunas** → llama db_dump con mode="full" y tables=["tabla1", "tabla2"]\n`,
            )
          }

          // En modo schema, solo nombres
          const tableList = tables.map((t) => `  - ${t.name}`).join('\n')

          return text(
            `Tablas disponibles (${tables.length}):\n\n${tableList}\n\n` +
            'Que quieres exportar?\n\n' +
            `1. **Todas las tablas** → llama db_dump con mode="${params.mode}" y all_tables=true\n` +
            `2. **Solo algunas** → llama db_dump con mode="${params.mode}" y tables=["tabla1", "tabla2"]\n`,
          )
        }

        // Ejecutar dump
        const result = await dumpMgr.dump(driver, connName, {
          includeData: params.mode === 'full',
          tables: params.all_tables ? undefined : params.tables,
          schema: params.schema,
        })

        const sizeKB = (result.sizeBytes / 1024).toFixed(1)
        const lines = [
          'Dump completado:',
          '',
          `  Archivo:  ${result.filename}`,
          `  Tablas:   ${result.tables}`,
          `  Filas:    ${result.totalRows}`,
          `  Tamano:   ${sizeKB} KB`,
          `  Ruta:     ${result.filepath}`,
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
