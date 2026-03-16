import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RollbackManager } from '../services/rollback-manager.js'
import type { ConnectionManager } from '../services/connection-manager.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerRollbackTools(
  server: McpServer,
  rollbackMgr: RollbackManager,
  manager: ConnectionManager,
): void {
  // ── rollback_list ──
  server.tool(
    'rollback_list',
    'Lista los rollback snapshots disponibles. Muestra las mutaciones recientes que se pueden revertir.',
    {
      limit: z.number().default(20).describe('Cantidad maxima de resultados (default: 20)'),
      connection: z.string().optional().describe('Filtrar por nombre de conexion'),
    },
    async (params) => {
      try {
        const snapshots = await rollbackMgr.list({
          limit: params.limit,
          connection: params.connection,
        })

        if (snapshots.length === 0) {
          return text('No hay rollbacks disponibles')
        }

        // Mostrar resumen compacto
        const summary = snapshots.map((s) => ({
          id: s.id,
          type: s.type,
          table: s.table ?? 'N/A',
          sql: s.sql.substring(0, 100) + (s.sql.length > 100 ? '...' : ''),
          connection: s.connection,
          timestamp: s.timestamp,
          rows: s.affectedRows?.length ?? 0,
        }))

        return text(JSON.stringify(summary, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── rollback_apply (con confirmacion) ──
  server.tool(
    'rollback_apply',
    'Revierte una mutacion usando un rollback snapshot. IMPORTANTE: confirma con el usuario antes de ejecutar con confirm=true.',
    {
      id: z.string().describe('ID del rollback snapshot'),
      confirm: z.boolean().default(false).describe('Debe ser true para confirmar. Pregunta al usuario antes.'),
    },
    async (params) => {
      try {
        const snap = await rollbackMgr.get(params.id)
        if (!snap) return error(`Rollback '${params.id}' no encontrado`)

        if (snap.type === 'ddl') {
          return text(
            `Rollback automatico no disponible para operaciones DDL (${snap.sql.substring(0, 50)}...). Necesitas recrear la estructura manualmente.`,
          )
        }

        const reverseSql = rollbackMgr.generateReverseSql(snap)
        if (!reverseSql.length) {
          return error('No se puede generar SQL inverso para este rollback (sin datos suficientes)')
        }

        if (!params.confirm) {
          const preview = reverseSql.slice(0, 3).join('\n')
          const more = reverseSql.length > 3 ? `\n... y ${reverseSql.length - 3} mas` : ''
          return text(`Revertir ${snap.type} en '${snap.table}'?\n\nSQL a ejecutar:\n${preview}${more}\n\nLlama rollback_apply con confirm=true para ejecutar.`)
        }

        const driver = await manager.getActiveDriver()
        const result = await rollbackMgr.apply(params.id, driver)

        return text(`Rollback aplicado: ${reverseSql.length} sentencia(s) ejecutada(s). ${result.affectedRows ?? 0} fila(s) afectada(s).`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
