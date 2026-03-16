import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Storage } from '../lib/storage.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { Connection, ConnectionType, ConnectionMode } from '../lib/types.js'
import { resolveDriver } from '../drivers/registry.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerConnectionTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
): void {
  // ── conn_create ──
  server.tool(
    'conn_create',
    'Crea una nueva conexion a base de datos (PostgreSQL, MySQL o SQLite).',
    {
      name: z.string().describe('Nombre de la conexion (ej: local-pg, staging-mysql)'),
      type: z.enum(['postgresql', 'mysql', 'sqlite']).describe('Tipo de base de datos'),
      mode: z.enum(['read-only', 'read-write']).default('read-only').describe('Modo de acceso (default: read-only)'),
      dsn: z.string().optional().describe('Connection string completo (ej: postgresql://user:pass@host:5432/db)'),
      host: z.string().optional().describe('Host del servidor'),
      port: z.number().optional().describe('Puerto'),
      database: z.string().optional().describe('Nombre de la base de datos'),
      user: z.string().optional().describe('Usuario'),
      password: z.string().optional().describe('Password'),
      filepath: z.string().optional().describe('Ruta al archivo SQLite (omitir para :memory:)'),
    },
    async (params) => {
      try {
        const now = new Date().toISOString()
        const conn: Connection = {
          name: params.name,
          type: params.type as ConnectionType,
          mode: (params.mode ?? 'read-only') as ConnectionMode,
          dsn: params.dsn,
          host: params.host,
          port: params.port,
          database: params.database,
          user: params.user,
          password: params.password,
          filepath: params.filepath,
          createdAt: now,
          updatedAt: now,
        }

        await storage.createConnection(conn)
        return text(`Conexion '${params.name}' creada (${params.type}, ${params.mode ?? 'read-only'})`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_list ──
  server.tool(
    'conn_list',
    'Lista todas las conexiones disponibles e indica cual esta activa.',
    {},
    async () => {
      try {
        const items = await storage.listConnections()
        if (items.length === 0) return text('No hay conexiones configuradas')
        return text(JSON.stringify(items, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_get ──
  server.tool(
    'conn_get',
    'Obtiene los detalles de una conexion. El password se muestra enmascarado.',
    {
      name: z.string().describe('Nombre de la conexion'),
    },
    async (params) => {
      try {
        const conn = await storage.getConnection(params.name)
        if (!conn) return error(`Conexion '${params.name}' no encontrada`)

        // Enmascarar password
        const safe = { ...conn }
        if (safe.password) safe.password = '***'
        if (safe.dsn) {
          safe.dsn = safe.dsn.replace(/:([^@]+)@/, ':***@')
        }

        return text(JSON.stringify(safe, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_set ──
  server.tool(
    'conn_set',
    'Actualiza un campo de una conexion existente.',
    {
      name: z.string().describe('Nombre de la conexion'),
      key: z.string().describe('Campo a actualizar (host, port, database, user, password, dsn, filepath, mode)'),
      value: z.string().describe('Nuevo valor'),
    },
    async (params) => {
      try {
        const validKeys = ['host', 'port', 'database', 'user', 'password', 'dsn', 'filepath', 'mode']
        if (!validKeys.includes(params.key)) {
          return error(`Campo invalido '${params.key}'. Campos validos: ${validKeys.join(', ')}`)
        }

        const update: Record<string, unknown> = {}
        if (params.key === 'port') {
          update[params.key] = parseInt(params.value, 10)
        } else {
          update[params.key] = params.value
        }

        await storage.updateConnection(params.name, update as Partial<Connection>)
        return text(`Campo '${params.key}' actualizado en conexion '${params.name}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_switch ──
  server.tool(
    'conn_switch',
    'Cambia la conexion activa. Si se especifica project, solo aplica a ese directorio.',
    {
      name: z.string().describe('Nombre de la conexion a activar'),
      project: z.string().optional().describe('Ruta del proyecto (si se omite, cambia global)'),
    },
    async (params) => {
      try {
        // Desconectar driver actual
        await manager.disconnectActive()

        await storage.setActiveConnection(params.name, params.project)
        const scope = params.project ? ` para proyecto '${params.project}'` : ' (global)'
        return text(`Conexion activa cambiada a '${params.name}'${scope}`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_rename ──
  server.tool(
    'conn_rename',
    'Renombra una conexion existente.',
    {
      name: z.string().describe('Nombre actual de la conexion'),
      new_name: z.string().describe('Nuevo nombre'),
    },
    async (params) => {
      try {
        await storage.renameConnection(params.name, params.new_name)
        return text(`Conexion '${params.name}' renombrada a '${params.new_name}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_delete (con confirmacion) ──
  server.tool(
    'conn_delete',
    'Elimina una conexion. IMPORTANTE: pide confirmacion al usuario antes de llamar esta tool con confirm=true.',
    {
      name: z.string().describe('Nombre de la conexion a eliminar'),
      confirm: z.boolean().default(false).describe('Debe ser true para confirmar. Pregunta al usuario antes de poner true.'),
    },
    async (params) => {
      try {
        const conn = await storage.getConnection(params.name)
        if (!conn) return error(`Conexion '${params.name}' no encontrada`)

        if (!params.confirm) {
          return text(`Estas seguro de eliminar la conexion '${params.name}' (${conn.type})? Esta accion no se puede deshacer. Llama conn_delete con confirm=true para confirmar.`)
        }

        // Desconectar si es la activa
        if (manager.getActiveConnectionName() === params.name) {
          await manager.disconnectActive()
        }

        await storage.deleteConnection(params.name)
        return text(`Conexion '${params.name}' eliminada`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_duplicate ──
  server.tool(
    'conn_duplicate',
    'Duplica una conexion existente con un nuevo nombre.',
    {
      name: z.string().describe('Nombre de la conexion a duplicar'),
      new_name: z.string().describe('Nombre para la copia'),
    },
    async (params) => {
      try {
        await storage.duplicateConnection(params.name, params.new_name)
        return text(`Conexion '${params.name}' duplicada como '${params.new_name}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_test ──
  server.tool(
    'conn_test',
    'Prueba la conexion a una base de datos. Ejecuta SELECT 1 y mide la latencia.',
    {
      name: z.string().describe('Nombre de la conexion a probar'),
    },
    async (params) => {
      try {
        const conn = await storage.getConnection(params.name)
        if (!conn) return error(`Conexion '${params.name}' no encontrada`)

        const driver = resolveDriver(conn)
        const start = performance.now()

        try {
          await driver.connect()
          await driver.execute('SELECT 1')
          const latency = Math.round(performance.now() - start)
          await driver.disconnect()

          return text(`Conexion '${params.name}' OK — ${conn.type} — ${latency}ms`)
        } catch (e) {
          await driver.disconnect().catch(() => {})
          return error(`Conexion '${params.name}' fallo: ${e instanceof Error ? e.message : String(e)}`)
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_project_list ──
  server.tool(
    'conn_project_list',
    'Lista todos los proyectos con conexiones especificas asignadas.',
    {},
    async () => {
      try {
        const projectConns = await storage.listProjectConnections()
        const entries = Object.entries(projectConns)

        if (entries.length === 0) {
          return text('No hay conexiones especificas por proyecto. Todos usan la conexion global.')
        }

        return text(JSON.stringify(
          entries.map(([project, conn]) => ({ project, connection: conn })),
          null,
          2,
        ))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_project_clear ──
  server.tool(
    'conn_project_clear',
    'Elimina la asociacion de conexion especifica de un proyecto.',
    {
      project: z.string().describe('Ruta del proyecto'),
    },
    async (params) => {
      try {
        const removed = await storage.clearProjectConnection(params.project)
        if (!removed) {
          return text(`No hay conexion especifica para el proyecto '${params.project}'`)
        }
        return text(`Conexion especifica eliminada para proyecto '${params.project}'. Usara la conexion global.`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
