import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { HistoryLogger } from '../services/history-logger.js'
import { text, error } from '../lib/response.js'

export function registerHistoryTools(
  server: McpServer,
  historyLogger: HistoryLogger,
): void {
  // ── history_list ──
  server.tool(
    'history_list',
    'Lista el historial de consultas ejecutadas. Filtrable por tipo, conexion y estado.',
    {
      limit: z.number().default(20).describe('Cantidad maxima de resultados (default: 20)'),
      type: z.string().optional().describe('Filtrar por tipo (read, write, ddl, explain)'),
      connection: z.string().optional().describe('Filtrar por nombre de conexion'),
      success: z.boolean().optional().describe('Filtrar por exito (true) o fallo (false)'),
    },
    async (params) => {
      try {
        const entries = await historyLogger.list({
          limit: params.limit,
          type: params.type,
          connection: params.connection,
          success: params.success,
        })

        if (entries.length === 0) {
          return text('No hay historial de consultas')
        }

        // Mostrar resumen compacto
        const summary = entries.map((e) => ({
          id: e.id,
          type: e.type,
          sql: e.sql.substring(0, 100) + (e.sql.length > 100 ? '...' : ''),
          connection: e.connection,
          executionTimeMs: e.executionTimeMs,
          rowCount: e.rowCount,
          affectedRows: e.affectedRows,
          success: e.success,
          error: e.error,
          timestamp: e.timestamp,
        }))

        return text(JSON.stringify(summary, null, 2))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── history_clear ──
  server.tool(
    'history_clear',
    'Limpia el historial de consultas. Opcionalmente solo las anteriores a una fecha.',
    {
      before: z.string().optional().describe('Fecha ISO 8601. Si se especifica, solo elimina entradas anteriores'),
    },
    async (params) => {
      try {
        const deleted = await historyLogger.clear(params.before)
        return text(`Historial limpiado: ${deleted} entrada(s) eliminada(s)`)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
