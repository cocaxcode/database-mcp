import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Storage } from '../lib/storage.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { Connection, ConnectionType, ConnectionMode } from '../lib/types.js'
import { resolveDriver } from '../drivers/registry.js'
import { text, error } from '../lib/response.js'

export function registerConnectionTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
): void {
  // ── conn_create ──
  server.tool(
    'conn_create',
    'Crea una nueva conexion a base de datos (PostgreSQL, MySQL o SQLite). SIEMPRE pregunta al usuario a que grupo pertenece.',
    {
      name: z.string().describe('Nombre de la conexion (ej: local-pg, staging-mysql)'),
      type: z.enum(['postgresql', 'mysql', 'sqlite']).describe('Tipo de base de datos'),
      group: z.string().describe('Nombre del grupo al que pertenece. PREGUNTA AL USUARIO — si no existe se crea automaticamente'),
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
        // Crear grupo si no existe
        const existingGroup = await storage.getGroup(params.group)
        if (!existingGroup) {
          await storage.createGroup(params.group)
        }

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
          group: params.group,
          createdAt: now,
          updatedAt: now,
        }

        await storage.createConnection(conn)

        // Si es la primera conexion del grupo y no hay default, marcarla
        const group = await storage.getGroup(params.group)
        if (group && !group.default) {
          await storage.setGroupDefault(params.group, params.name)
        }

        return text(`Conexion '${params.name}' creada (${params.type}, ${params.mode ?? 'read-only'}) — grupo: '${params.group}'`)
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

        // Validar valor de mode
        if (params.key === 'mode' && params.value !== 'read-only' && params.value !== 'read-write') {
          return error(`Valor invalido para mode: '${params.value}'. Valores validos: read-only, read-write`)
        }

        const update: Record<string, unknown> = {}
        if (params.key === 'port') {
          const port = parseInt(params.value, 10)
          if (isNaN(port) || port < 1 || port > 65535) {
            return error(`Puerto invalido: '${params.value}'. Debe ser un numero entre 1 y 65535.`)
          }
          update[params.key] = port
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
    'Cambia la conexion activa (de sesion). Para cambiar el default permanente usa conn_set_default.',
    {
      name: z.string().describe('Nombre de la conexion a activar'),
      project: z.string().optional().describe('Ruta del proyecto (si se omite, usa el directorio actual)'),
    },
    async (params) => {
      try {
        await manager.disconnectActive()

        await storage.setActiveConnection(params.name, params.project)
        const scope = params.project ?? process.cwd()
        return text(`Conexion activa cambiada a '${params.name}' para '${scope}'`)
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

  // ── conn_export ──
  server.tool(
    'conn_export',
    'Exporta conexiones a JSON. Por defecto enmascara passwords — usa include_secrets=true para incluirlos.',
    {
      name: z.string().optional().describe('Nombre de una conexion especifica (omitir para exportar todas)'),
      include_secrets: z.boolean().default(false).describe('Incluir passwords y DSNs sin enmascarar'),
    },
    async (params) => {
      try {
        let connections: Connection[]

        if (params.name) {
          const conn = await storage.getConnection(params.name)
          if (!conn) return error(`Conexion '${params.name}' no encontrada`)
          connections = [conn]
        } else {
          const items = await storage.listConnections()
          if (items.length === 0) return text('No hay conexiones para exportar')

          const all = await Promise.all(items.map((i) => storage.getConnection(i.name)))
          connections = all.filter((c): c is Connection => c !== null)
        }

        // Enmascarar si no se piden secretos
        const exported = connections.map((conn) => {
          if (params.include_secrets) return conn
          const safe = { ...conn }
          if (safe.password) safe.password = '***'
          if (safe.dsn) safe.dsn = safe.dsn.replace(/:([^@]+)@/, ':***@')
          return safe
        })

        const bundle = {
          version: 1,
          exportedAt: new Date().toISOString(),
          connections: exported,
        }

        const warning = params.include_secrets
          ? '\n\n⚠ ATENCION: Este export incluye passwords y DSNs sin enmascarar. No lo compartas ni lo incluyas en logs.'
          : ''
        return text(JSON.stringify(bundle, null, 2) + warning)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_import ──
  server.tool(
    'conn_import',
    'Importa conexiones desde un JSON exportado. Omite conexiones que ya existen (usa overwrite=true para reemplazar).',
    {
      json: z.string().describe('JSON con las conexiones a importar (formato de conn_export)'),
      overwrite: z.boolean().default(false).describe('Reemplazar conexiones existentes con el mismo nombre'),
    },
    async (params) => {
      try {
        const bundle = JSON.parse(params.json) as { connections?: Connection[] }
        const connections = bundle.connections
        if (!connections?.length) return error('No se encontraron conexiones en el JSON')

        const results: string[] = []
        let imported = 0
        let skipped = 0

        for (const conn of connections) {
          if (!conn.name || !conn.type) {
            results.push(`  Omitida: entrada sin nombre o tipo`)
            skipped++
            continue
          }

          const existing = await storage.getConnection(conn.name)

          if (existing && !params.overwrite) {
            results.push(`  Omitida: '${conn.name}' ya existe (usa overwrite=true para reemplazar)`)
            skipped++
            continue
          }

          // Si tiene passwords enmascarados, advertir
          if (conn.password === '***' || conn.dsn?.includes(':***@')) {
            results.push(`  Advertencia: '${conn.name}' tiene credenciales enmascaradas — edita con conn_set despues de importar`)
          }

          const now = new Date().toISOString()
          if (existing) {
            await storage.deleteConnection(conn.name)
          }
          await storage.createConnection({
            ...conn,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
          })
          results.push(`  Importada: '${conn.name}' (${conn.type})`)
          imported++
        }

        const summary = `${imported} importada(s), ${skipped} omitida(s)`
        return text(`Importacion completada: ${summary}\n\n${results.join('\n')}`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_group_create ──
  server.tool(
    'conn_group_create',
    'Crea un nuevo grupo de conexiones. Luego añade scopes (directorios) con conn_group_add_scope.',
    {
      name: z.string().describe('Nombre del grupo (ej: cocaxcode, optimizatusol)'),
    },
    async (params) => {
      try {
        await storage.createGroup(params.name)
        return text(`Grupo '${params.name}' creado. Usa conn_group_add_scope para añadir directorios.`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_group_list ──
  server.tool(
    'conn_group_list',
    'Lista todos los grupos con sus scopes, default y conexiones.',
    {},
    async () => {
      try {
        const groups = await storage.listGroups()
        if (groups.length === 0) {
          return text('No hay grupos configurados. Usa conn_group_create para crear uno.')
        }
        return text(JSON.stringify(groups, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_group_delete ──
  server.tool(
    'conn_group_delete',
    'Elimina un grupo. Las conexiones del grupo NO se eliminan pero quedaran huerfanas.',
    {
      name: z.string().describe('Nombre del grupo a eliminar'),
    },
    async (params) => {
      try {
        await storage.deleteGroup(params.name)
        return text(`Grupo '${params.name}' eliminado.`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_group_add_scope ──
  server.tool(
    'conn_group_add_scope',
    'Añade un directorio (scope) a un grupo. Las conexiones del grupo seran accesibles desde ese directorio.',
    {
      group: z.string().describe('Nombre del grupo'),
      scope: z.string().optional().describe('Ruta del directorio. Si se omite, usa el directorio actual'),
    },
    async (params) => {
      try {
        const scope = params.scope ?? process.cwd()
        await storage.addScopeToGroup(params.group, scope)
        return text(`Scope '${scope}' añadido al grupo '${params.group}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_group_remove_scope ──
  server.tool(
    'conn_group_remove_scope',
    'Quita un directorio (scope) de un grupo.',
    {
      group: z.string().describe('Nombre del grupo'),
      scope: z.string().optional().describe('Ruta del directorio a quitar. Si se omite, usa el directorio actual'),
    },
    async (params) => {
      try {
        const scope = params.scope ?? process.cwd()
        await storage.removeScopeFromGroup(params.group, scope)
        return text(`Scope '${scope}' eliminado del grupo '${params.group}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_set_default ──
  server.tool(
    'conn_set_default',
    'Marca una conexion como el default de su grupo. El default se activa automaticamente al entrar al proyecto.',
    {
      name: z.string().describe('Nombre de la conexion a marcar como default'),
    },
    async (params) => {
      try {
        const conn = await storage.getConnection(params.name)
        if (!conn) return error(`Conexion '${params.name}' no encontrada`)
        if (!conn.group) return error(`La conexion '${params.name}' no pertenece a ningun grupo`)
        await storage.setGroupDefault(conn.group, params.name)
        return text(`Conexion '${params.name}' marcada como default del grupo '${conn.group}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── conn_set_group ──
  server.tool(
    'conn_set_group',
    'Asigna o cambia el grupo de una conexion existente.',
    {
      connection: z.string().describe('Nombre de la conexion'),
      group: z.string().describe('Nombre del grupo'),
    },
    async (params) => {
      try {
        await storage.setConnectionGroup(params.connection, params.group)
        return text(`Conexion '${params.connection}' asignada al grupo '${params.group}'`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
