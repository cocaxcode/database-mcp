<p align="center">
  <h1 align="center">@cocaxcode/database-mcp</h1>
  <p align="center">
    <strong>Your databases, one conversation away.</strong><br/>
    26 tools &middot; PostgreSQL &middot; MySQL &middot; SQLite &middot; Rollback &middot; Dump/Restore &middot; Schema auto-discovery
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/v/@cocaxcode/database-mcp.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/dm/@cocaxcode/database-mcp.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/tools-26-blueviolet?style=flat-square" alt="26 tools" />
</p>

<p align="center">
  <a href="#quick-overview">Overview</a> &middot;
  <a href="#just-talk-to-it">Just Talk to It</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#tool-reference">Tool Reference</a> &middot;
  <a href="#storage">Storage</a> &middot;
  <a href="#architecture">Architecture</a>
</p>

---

## Quick Overview

The most complete MCP server for databases. 26 tools across 3 engines (PostgreSQL, MySQL, SQLite), with named connection management, automatic rollback, dump/restore, schema auto-discovery via MCP Resources, and full query history — all from natural language.

This is not just a query runner. It is a full database workbench: create and switch named connections like git branches, introspect schemas at three levels of detail, get pre-mutation snapshots on every write, undo mistakes with reverse SQL, dump and restore entire databases, and track every query you run — per project, per connection.

You describe what you need. The AI reads your schema, writes the SQL, and executes it safely — with automatic LIMIT injection, pre-mutation snapshots, and confirmation before destructive operations. No cloud accounts, no ORMs, no config files. Credentials never leave your machine. Everything runs locally.

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code**, **Codex CLI**, **Gemini CLI**, and any MCP-compatible client.

---

## Just Talk to It

You don't need to memorize tool names or SQL syntax. Just say what you want.

```
> "Connect to my local PostgreSQL on port 5432, database myapp, user admin"

> "Show me all tables"

> "What columns does the users table have?"

> "Show me the last 10 orders with the customer name"
  → AI reads FKs from schema, builds the JOIN, applies LIMIT 10

> "Insert a test user called Alice"
  → Snapshot captured for rollback

> "Oops, undo that"
  → Rows restored via reverse SQL

> "Switch to production"
  → Instant context change, all queries now go to prod

> "Delete all inactive users"
  → "This will affect N rows. Call again with confirm=true to proceed."

> "What did I run today?"
  → Full query history with timestamps and execution times

> "Dump the database — structure and data"
  → SQL file generated, ready for restore
```

The AI already knows your schema through **MCP Resources**. It reads `db://schema` to discover tables and `db://tables/{name}/schema` for columns, foreign keys, and indexes. When you ask for data across tables, it builds correct JOINs automatically.

---

## Installation

### Claude Code

```bash
claude mcp add --scope user database -- npx -y @cocaxcode/database-mcp@latest
```

### Claude Desktop

Add to your config file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest"]
    }
  }
}
```

<details>
<summary><strong>Cursor / Windsurf</strong></summary>

Add to `.cursor/mcp.json` or `.windsurf/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest"]
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code</strong></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "database": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest"]
    }
  }
}
```
</details>

<details>
<summary><strong>Codex CLI (OpenAI)</strong></summary>

```bash
codex mcp add database -- npx -y @cocaxcode/database-mcp@latest
```

Or add to `~/.codex/config.toml`:

```toml
[mcp_servers.database]
command = "npx"
args = ["-y", "@cocaxcode/database-mcp@latest"]
```
</details>

<details>
<summary><strong>Gemini CLI (Google)</strong></summary>

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest"]
    }
  }
}
```
</details>

### Connect on startup with `--dsn`

Pass a DSN to auto-create a connection on startup:

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest", "--dsn", "postgresql://user:pass@localhost:5432/mydb"]
    }
  }
}
```

Supported formats: `postgresql://`, `mysql://`, `sqlite:///path/to/file.db`, `sqlite://:memory:`

### Driver installation

Install only the driver(s) you need — they load dynamically at runtime:

```bash
npm install -g postgres       # PostgreSQL (postgres.js)
npm install -g mysql2         # MySQL
npm install -g sql.js         # SQLite (runs in-process, no native bindings)
```

> **Note:** When using `npx`, drivers must be installed globally. If you install the server globally (`npm install -g @cocaxcode/database-mcp`), drivers can be local or global.

---

## Features

### Multi-database, one interface

Most database MCP servers make you reconfigure credentials every session. This one does not. Named connections persist globally — create them once, use them forever.

**Named connections work like git branches.** You create `dev`, `staging`, `prod` once and they are always there. Switching is instant — one command, zero reconfiguration:

```
"Create a connection called prod with DSN postgresql://admin:pass@db.example.com:5432/api"
"Create a read-only connection called analytics pointing to ./data/metrics.db"
"Switch to prod"           → queries go to PostgreSQL
"Switch to analytics"      → queries go to SQLite
"Duplicate prod as prod-readonly with read-only mode"
```

**Project-scoped connections** let different projects use different active databases without interfering. Working on project A with `dev`? Switch to project B and it remembers you were using `prod` there. Each project tracks its own active connection independently:

```
"Switch to staging for this project"
"Show which projects have connections"
"Clear the project connection"           → falls back to global active
```

**100% local credentials.** Every connection is stored as a JSON file in `~/.database-mcp/connections/`. Passwords never leave your machine. Nothing is sent to the cloud. Nothing is committed to git. Your credentials are yours.

**Live management.** Create, duplicate, rename, test, export, and switch connections mid-conversation. No restart needed, no config file editing, no context loss.

### Safety built in

| Protection | How it works |
|---|---|
| Read-only mode | Connection-level enforcement — blocks all mutations |
| Confirmation required | Destructive ops require explicit `confirm: true` |
| Auto LIMIT | Read queries get `LIMIT 100` by default (respects existing LIMIT) |
| Password masking | Credentials shown as `***` in `conn_get` output |
| Pre-mutation snapshots | Every INSERT/UPDATE/DELETE captures row state for rollback |
| Auto gitignore | `.database-mcp/` added to `.gitignore` on first write |

### Rollback snapshots

Every mutation captures a pre-state snapshot. Undo anything.

```
"Show me available rollbacks"
"Rollback the last delete"
  → "This will INSERT 47 rows back into orders. Confirm?"
  → Rows restored via reverse SQL
```

| Original operation | Rollback generates |
|---|---|
| `DELETE WHERE id = 5` | `INSERT INTO ... VALUES (...)` |
| `UPDATE SET name = 'Bob'` | `UPDATE SET name = 'Alice'` (pre-update values) |
| `INSERT INTO ...` | `DELETE WHERE id = {new_id}` |
| DDL (CREATE, ALTER, DROP) | Logged but not reversible |

### Schema introspection

Three levels of detail, with pattern filtering:

```
"List all tables"                         → names only (fast)
"Show me the users table with columns"    → columns + types + nullable
"Full schema for orders including FKs"    → columns + foreign keys + indexes
"Tables starting with user"              → pattern: 'user%'
```

MCP Resources (`db://schema` and `db://tables/{name}/schema`) give AI agents automatic access to your schema — no manual SQL needed for multi-table queries.

### Query execution with EXPLAIN

```
"Show me all users"
  → SELECT * FROM users LIMIT 100         ← auto LIMIT

"Show the execution plan for this query"
  → EXPLAIN ANALYZE with dialect-specific syntax (PostgreSQL/MySQL/SQLite)
```

### Dump and restore

Full database backup in SQL format — structure only or structure + data.

```
"Dump the database"
  → Choose: structure only or full
  → Choose: all tables or specific ones
  → SQL file saved to .database-mcp/dumps/

"Restore from the last dump"
  → Lists available dumps, asks for confirmation, executes
```

Generated SQL handles `DROP TABLE IF EXISTS`, FK disable/enable, and dialect-aware DDL.

### Query history

Every query logged per-project with timestamp, connection, execution time, and result type.

```
"What queries did I run today?"
"Show me only mutations"
"History for the prod connection"
```

### Export and import connections

```
"Export all connections"                    → JSON with masked passwords
"Export with secrets included"             → JSON with real credentials
"Import these connections: { ... }"        → creates missing connections
```

---

## Tool Reference

26 tools in 7 categories, plus 2 MCP Resources:

| Category | Tools | Count |
|----------|-------|:-----:|
| **Connections** | `conn_create` `conn_list` `conn_get` `conn_set` `conn_switch` `conn_rename` `conn_delete` `conn_duplicate` `conn_test` `conn_project_list` `conn_project_clear` `conn_export` `conn_import` | 13 |
| **Schema** | `search_schema` | 1 |
| **Queries** | `execute_query` `execute_mutation` `explain_query` | 3 |
| **Dump** | `db_dump` `db_restore` `db_dump_list` | 3 |
| **Rollback** | `rollback_list` `rollback_apply` | 2 |
| **History** | `history_list` `history_clear` | 2 |
| **Config** | `config_get` `config_set` | 2 |

**Resources:** `db://schema` &middot; `db://tables/{tableName}/schema`

> **Tip:** You never need to call these tools directly. Just describe what you want and the AI picks the right one.

---

## Storage

Storage is split into two locations by design. This separation is intentional and solves a real problem: your credentials belong to you, your project history belongs to the project.

**Global: `~/.database-mcp/`** — connections, credentials, and settings. Lives in your home directory. Never inside a project. Never in git. Never shared with anyone unless you explicitly export them.

**Per-project: `{project}/.database-mcp/`** — query history, rollback snapshots, and database dumps. Lives inside the project directory and is automatically added to `.gitignore` on first write.

```
~/.database-mcp/                          # Global (configurable via DATABASE_MCP_DIR)
├── connections/
│   └── {name}.json                       # Connection configs (passwords stored locally)
├── active-conn                           # Global active connection name
├── config.json                           # Saved settings
└── project-conn/
    └── {project-hash}                    # Per-project active connection

{your-project}/.database-mcp/            # Per-project (auto-gitignored)
├── history.json                          # Query history (max 5000)
├── rollbacks.json                        # Pre-mutation snapshots (max 1000)
└── dumps/
    └── {conn}-{timestamp}-{mode}.sql     # Database dumps
```

The result: you can share a project repo freely — collaborators get the history and rollback structure, but zero credentials. They create their own connections locally.

### Configuration

Configurable from the conversation or via environment variables:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_MCP_DIR` | Global storage directory | `~/.database-mcp/` |
| `DATABASE_MCP_MAX_ROLLBACKS` | Max rollback snapshots per project | `1000` |
| `DATABASE_MCP_MAX_HISTORY` | Max history entries per project | `5000` |

```
"Set max rollbacks to 2000"
"Set max history to 10000"
```

Priority: **env var > saved config > default**.

> **Warning:** If you override `DATABASE_MCP_DIR` to a path inside a git repository, add `.database-mcp/` to your `.gitignore` to avoid pushing credentials.

---

## Architecture

```
src/
├── index.ts              # Entry point (StdioServerTransport, --dsn flag)
├── server.ts             # createServer() factory
├── tools/                # 26 tool handlers (one file per category)
├── resources/            # MCP Resources (schema auto-discovery)
├── services/             # Business logic
│   ├── connection-manager    # Lazy connect, driver caching
│   ├── schema-introspector   # Multi-dialect introspection (3 detail levels)
│   ├── query-executor        # Read/mutation/explain with safety
│   ├── rollback-manager      # Snapshot capture + reverse SQL
│   ├── history-logger        # Per-project query log
│   └── dump-manager          # Dump/restore (SQL generation)
├── drivers/              # Database adapters (postgres, mysql, sqlite)
├── lib/                  # Types, storage, sanitization
└── utils/                # SQL classifier, parser, formatter
```

- **Zero runtime deps** beyond `@modelcontextprotocol/sdk` and `zod`
- **Strict TypeScript** — no `any`
- **Dynamic driver loading** — `import('postgres')` / `import('mysql2/promise')` / `import('sql.js')` at runtime
- **< 60KB** bundled via tsup
- **Factory pattern** — `createServer(storageDir?, projectDir?)` for isolated test instances

---

[MIT](./LICENSE) · Built by [cocaxcode](https://github.com/cocaxcode)
