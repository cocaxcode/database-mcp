# CLAUDE.md — @cocaxcode/database-mcp

## Project Overview

MCP server for database connectivity. Multi-DB (PostgreSQL, MySQL, SQLite), connection management, schema introspection, query execution with rollback and history. 19 tools, 88 tests.

## Stack

- TypeScript 5.x (strict mode, ESM)
- @modelcontextprotocol/sdk 1.27.x (unified package)
- Zod 3.25+ for schema validation
- Vitest for testing (InMemoryTransport + SQLite :memory:)
- tsup for building (ESM output with shebang)
- Drivers: postgres, mysql2, sql.js (optional peer deps, dynamic import)

## Architecture

```
src/
├── index.ts              # Entry point (shebang + StdioServerTransport, --dsn flag)
├── server.ts             # createServer(storageDir?, projectDir?) factory
├── tools/                # MCP tool registration (one file per group)
│   ├── connection.ts     # conn_create/list/get/set/switch/rename/delete/duplicate/test/project_list/project_clear (11)
│   ├── schema.ts         # search_schema (1)
│   ├── query.ts          # execute_query/execute_mutation/explain_query (3)
│   ├── rollback.ts       # rollback_list/rollback_apply (2)
│   └── history.ts        # history_list/history_clear (2)
├── resources/
│   └── schema.ts         # MCP Resources: db://schema, db://tables/{tableName}/schema
├── services/             # Business logic with DB interaction
│   ├── connection-manager.ts  # Lazy connect, driver caching, getActiveDriver()
│   ├── schema-introspector.ts # Multi-dialect schema queries (3 detail levels)
│   ├── query-executor.ts      # Read (LIMIT injection), mutation (mode check), explain
│   ├── rollback-manager.ts    # Pre-mutation snapshots, reverse SQL generation
│   └── history-logger.ts      # Per-project query history (5000 max)
├── drivers/              # Database adapters (dynamic import)
│   ├── interface.ts      # DatabaseDriver interface
│   ├── sqlite.ts         # sql.js adapter (:memory: + file)
│   ├── postgres.ts       # postgres.js adapter (DSN or config)
│   ├── mysql.ts          # mysql2/promise adapter (DSN or config)
│   └── registry.ts       # resolveDriver() factory
├── lib/                  # Pure logic (no DB dependency)
│   ├── types.ts          # All TypeScript interfaces
│   ├── sanitize.ts       # sanitizeName() for connection names
│   └── storage.ts        # JSON file storage in ~/.database-mcp/
├── utils/
│   ├── sql-classifier.ts     # classifySql() → read/write/ddl
│   ├── sql-parser-light.ts   # extractTableAndWhere() for rollback
│   ├── result-formatter.ts   # formatQueryResult() with 25KB truncation
│   └── gitignore-checker.ts  # Auto-add .database-mcp/ to .gitignore
├── types/                # Module declarations for optional deps
│   ├── sql.js.d.ts
│   ├── postgres.d.ts
│   └── mysql2.d.ts
└── __tests__/
    ├── helpers.ts         # createTestClient() with InMemoryTransport
    └── *.test.ts          # 10 test files, 88 tests
```

## Key Patterns

- **Factory function**: `createServer(storageDir?, projectDir?)` for testability
- **SDK imports**: Deep paths — `@modelcontextprotocol/sdk/server/mcp.js`
- **Tool API**: `.tool(name, description, schema, handler)` with raw Zod shapes (NOT z.object)
- **Error handling**: Return `{ isError: true }`, never throw from tool handlers
- **Logging**: ONLY `console.error()` — stdout is reserved for JSON-RPC
- **Storage**: Split — global connections in `~/.database-mcp/`, per-project history+rollbacks in `{projectDir}/.database-mcp/`
- **Confirm pattern**: Destructive tools (conn_delete, rollback_apply) require `confirm: true` parameter
- **Dynamic drivers**: `import('postgres')` / `import('mysql2/promise')` / `import('sql.js')` at runtime
- **SQL classification**: Strip comments/strings first, match first keyword → read/write/ddl
- **LIMIT injection**: Read queries get default LIMIT 100, respects existing LIMIT clause

## Storage Layout

```
~/.database-mcp/                    # Global (configurable via DATABASE_MCP_DIR)
├── connections/
│   └── {name}.json                 # Connection configs
├── active-conn                     # Global active connection
└── project-conn/
    └── {project-hash}              # Per-project active connection

{projectDir}/.database-mcp/         # Per-project (auto-gitignored)
├── history.json                    # Query history (5000 max)
└── rollbacks.json                  # Pre-mutation snapshots (500 max)
```

## Commands

```bash
npm test          # Run all tests (88)
npm run build     # Build with tsup
npm run typecheck # TypeScript check
npm run lint      # ESLint
npm run inspector # Test with MCP Inspector
```

## Conventions

- Spanish for user-facing strings (tool descriptions, error messages)
- English for code (variable names, comments)
- No semi, single quotes, trailing commas (Prettier)
- All tool handlers follow try/catch → isError pattern
- Tests use SQLite :memory: via createTestClient() helper
