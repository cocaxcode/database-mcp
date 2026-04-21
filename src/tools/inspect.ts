import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { QueryCache } from '../services/query-cache.js'
import { text, error } from '../lib/response.js'

export function registerInspectTools(server: McpServer, cache: QueryCache): void {
  server.tool(
    'inspect_last_query',
    'Recupera el result completo (sin celdas truncadas, sin row cap) de un execute_query / execute_mutation / explain_query previo. Usa el call_id que aparece en la response comprimida. Sin call_id devuelve el más reciente. NO re-ejecuta el SQL.',
    {
      call_id: z
        .string()
        .optional()
        .describe(
          "ID devuelto en el campo 'call_id' de un result comprimido. Si se omite, devuelve el último query guardado (warning si hay varios en los últimos 5s).",
        ),
    },
    async (params) => {
      try {
        const entry = await cache.get(params.call_id)
        if (!entry) {
          return error(
            params.call_id
              ? `No se encontró query con call_id="${params.call_id}". Puede haber expirado (TTL 1h) o no existir.`
              : 'No hay queries guardadas aún. Ejecuta execute_query primero.',
          )
        }

        const warnings: string[] = []
        if (!params.call_id) {
          const recent = cache.recentCount(5000)
          if (recent > 1) {
            warnings.push(
              `⚠️ ${recent} queries en los últimos 5s — ambigüedad posible. Pasa call_id explícito si no es la que esperas.`,
            )
          }
        }

        const payload = {
          call_id: entry.call_id,
          saved_at: new Date(entry.saved_at).toISOString(),
          sql: entry.sql,
          connection: entry.connection,
          result: entry.result,
        }

        const content =
          (warnings.length > 0 ? warnings.join('\n') + '\n\n' : '') +
          JSON.stringify(payload, null, 2)
        return text(content)
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
