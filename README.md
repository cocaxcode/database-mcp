# @cocaxcode/database-mcp

MCP server para conectividad con bases de datos. Multi-DB (PostgreSQL, MySQL, SQLite), gestion de conexiones, introspeccion de schema, ejecucion de queries con rollback e historial.

## Instalacion

```bash
npm install -g @cocaxcode/database-mcp
```

Instala el driver que necesites:

```bash
# PostgreSQL
npm install -g postgres

# MySQL
npm install -g mysql2

# SQLite
npm install -g sql.js
```

## Configuracion

### Claude Desktop

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp"]
    }
  }
}
```

### Con DSN directo

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp", "--dsn", "postgresql://user:pass@localhost:5432/mydb"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add database-mcp -- npx -y @cocaxcode/database-mcp
```

## Tools (19)

### Conexiones (11)

| Tool | Descripcion |
|------|-------------|
| `conn_create` | Crear conexion (PostgreSQL, MySQL, SQLite) |
| `conn_list` | Listar conexiones guardadas |
| `conn_get` | Ver detalles de una conexion (password enmascarado) |
| `conn_set` | Modificar propiedades de una conexion |
| `conn_switch` | Cambiar la conexion activa |
| `conn_rename` | Renombrar una conexion |
| `conn_delete` | Eliminar conexion (requiere confirmacion) |
| `conn_duplicate` | Duplicar una conexion existente |
| `conn_test` | Probar conectividad |
| `conn_project_list` | Listar conexiones asociadas a proyectos |
| `conn_project_clear` | Limpiar conexion activa del proyecto |

### Schema (1)

| Tool | Descripcion |
|------|-------------|
| `search_schema` | Buscar tablas, columnas, FK e indices. 3 niveles de detalle: names, summary, full |

### Queries (3)

| Tool | Descripcion |
|------|-------------|
| `execute_query` | Ejecutar SELECT (read-only, LIMIT automatico) |
| `execute_mutation` | Ejecutar INSERT/UPDATE/DELETE (captura snapshot para rollback) |
| `explain_query` | Ver plan de ejecucion (EXPLAIN) |

### Rollback (2)

| Tool | Descripcion |
|------|-------------|
| `rollback_list` | Ver snapshots disponibles |
| `rollback_apply` | Revertir una mutacion (requiere confirmacion) |

### Historial (2)

| Tool | Descripcion |
|------|-------------|
| `history_list` | Ver historial de queries con filtros |
| `history_clear` | Limpiar historial |

## MCP Resources

El servidor expone resources para que agentes AI puedan auto-descubrir el schema:

- `db://schema` — Schema completo de la base activa
- `db://tables/{tableName}/schema` — Schema detallado de una tabla (columnas, FK, indices)

Esto permite que un agente construya JOINs automaticamente a partir de lenguaje natural.

## Seguridad

- Las conexiones en modo `read-only` bloquean mutaciones
- Las operaciones destructivas requieren `confirm: true`
- Los passwords se enmascaran en `conn_get`
- LIMIT automatico en queries de lectura (default 100)
- Datos per-project se agregan automaticamente al `.gitignore`

## Almacenamiento

```
~/.database-mcp/              # Conexiones (global)
{proyecto}/.database-mcp/     # Historial y rollbacks (per-project)
```

La ruta global se puede configurar con la variable de entorno `DATABASE_MCP_DIR`.

## Desarrollo

```bash
git clone https://github.com/cocaxcode/database-mcp.git
cd database-mcp
npm install
npm test          # 88 tests
npm run build     # Build con tsup
npm run typecheck # Verificar tipos
```

## Licencia

MIT
