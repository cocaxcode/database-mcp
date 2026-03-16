import type { DatabaseDriver } from './interface.js'
import type { Connection, ConnectionType } from '../lib/types.js'
import { SQLiteAdapter } from './sqlite.js'
import { PostgresAdapter } from './postgres.js'
import { MySQLAdapter } from './mysql.js'

/**
 * Resuelve el driver adecuado segun el tipo de conexion.
 */
export function resolveDriver(conn: Connection): DatabaseDriver {
  switch (conn.type) {
    case 'sqlite':
      return new SQLiteAdapter(conn.filepath)

    case 'postgresql':
      return new PostgresAdapter({
        dsn: conn.dsn,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: conn.user,
        password: conn.password,
      })

    case 'mysql':
      return new MySQLAdapter({
        dsn: conn.dsn,
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: conn.user,
        password: conn.password,
      })

    default:
      throw new Error(`Tipo de base de datos no soportado: ${conn.type as string}`)
  }
}

/**
 * Lista de tipos soportados para validacion.
 */
export const SUPPORTED_TYPES: ConnectionType[] = ['postgresql', 'mysql', 'sqlite']
