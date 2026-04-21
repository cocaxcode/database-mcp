<p align="center">
  <h1 align="center">@cocaxcode/database-mcp</h1>
  <p align="center">
    <strong>Your databases, one conversation away.</strong><br/>
    33 tools &middot; PostgreSQL &middot; MySQL &middot; SQLite &middot; Connection Groups &middot; Rollback &middot; Dump/Restore &middot; Schema auto-discovery
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/v/@cocaxcode/database-mcp.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/dm/@cocaxcode/database-mcp.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/tools-33-blueviolet?style=flat-square" alt="33 tools" />
</p>

<p align="center">
  <a href="#quick-overview">Overview</a> &middot;
  <a href="#just-talk-to-it">Just Talk to It</a> &middot;
  <a href="#connection-groups">Connection Groups</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#tool-reference">Tool Reference</a> &middot;
  <a href="#storage">Storage</a> &middot;
  <a href="#architecture">Architecture</a>
</p>

---

## Quick Overview

The most complete MCP server for databases. 33 tools across 3 engines (PostgreSQL, MySQL, SQLite), with connection groups, named connection management, automatic rollback, dump/restore, schema auto-discovery via MCP Resources, and full query history — all from natural language.

This is not just a query runner. It is a full database workbench: organize connections into groups scoped to your project directories, set defaults that persist between sessions, introspect schemas at three levels of detail, get pre-mutation snapshots on every write, undo mistakes with reverse SQL, dump and restore entire databases, and track every query you run — per project, per connection.

Every connection belongs to a group. Groups have scopes (directories), a default connection, and an active connection. When you work inside a scoped directory, you only see that group's connections — no clutter, no confusion.

You describe what you need. The AI reads your schema, writes the SQL, and executes it safely — with automatic LIMIT injection, pre-mutation snapshots, and confirmation before destructive operations. No cloud accounts, no ORMs, no config files. Credentials never leave your machine. Everything runs locally.

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **VS Code**, **Codex CLI**, **Gemini CLI**, and any MCP-compatible client.

---

## Just Talk to It

You don't need to memorize tool names or SQL syntax. Just say what you want.

```
> "Connect to my local PostgreSQL on port 5432, database myapp, user admin"

> "Create a group called backend and add this directory"

> "Connect to my PostgreSQL on localhost, put it in the backend group"

> "Set local-pg as the default connection"

> "Show me all tables"

> "What columns does the users table have?"

> "Show me the last 10 orders with the customer name"
  -> AI reads FKs from schema, builds the JOIN, applies LIMIT 10

> "Insert a test user called Alice"
  -> Snapshot captured for rollback

> "Oops, undo that"
  -> Rows restored via reverse SQL

> "Switch to the production database for this session"
  -> Instant context change, all queries now go to prod

> "Delete all inactive users"
  -> "This will affect N rows. Call again with confirm=true to proceed."

> "What did I run today?"
  -> Full query history with timestamps and execution times

> "Dump the database — structure and data"
  -> SQL file generated, ready for restore
```

The AI already knows your schema through **MCP Resources**. It reads `db://schema` to discover tables and `db://tables/{name}/schema` for columns, foreign keys, and indexes. When you ask for data across tables, it builds correct JOINs automatically.

---

## Connection Groups

Every connection belongs to a group. Groups are the organizing unit for your database connections — they keep things scoped, clean, and automatic.

A group has three key concepts:

- **Scopes**: directories that share the group's connections. When you work inside a scoped directory, you only see that group's connections. No global clutter.
- **Default**: the connection that activates automatically when you enter a scoped directory. Persists between sessions.
- **Active**: the connection being used right now. Session only — resets to the default on restart.

Here is a practical workflow:

```
"Create a group called backend"
"Add this directory as scope"
"Create a PostgreSQL connection called local-dev in the backend group"   <- auto-default (first connection)
"Create another called production in backend"
"List connections"                                                       <- shows local-dev (active, default)
"Switch to production"                                                   <- session only
"Set production as default"                                              <- persists between sessions
```

The first connection added to a group becomes the default automatically. Switching connections only changes the active for the current session — restart and you are back to the default. If you want the change to stick, set a new default explicitly.

This means you can safely switch to production for a quick query and know that next time you open the project, you will be back on your development database.

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

Most database MCP servers make you reconfigure credentials every session. This one does not. Named connections persist inside groups — create them once, use them forever.

**Named connections work like git branches.** You create `dev`, `staging`, `prod` once inside a group and they are always there. Switching is instant — one command, zero reconfiguration:

```
"Create a group called my-project and add this directory as scope"
"Create a connection called dev with host localhost, database myapp, user admin in my-project"
"Create a read-only connection called analytics pointing to ./data/metrics.db in my-project"
"Switch to dev"               -> queries go to PostgreSQL
"Switch to analytics"         -> queries go to SQLite
"Duplicate dev as dev-readonly with read-only mode"
```

**Group-scoped connections** mean different projects see different databases automatically. Working on project A? You see project A's group and connections. Switch to project B's directory and it picks up project B's group with its own default. No manual switching, no interference between projects:

```
"Create a group called frontend with scope /home/user/frontend"
"Create a group called backend with scope /home/user/backend"
```

Now each directory has its own isolated set of connections.

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
  -> "This will INSERT 47 rows back into orders. Confirm?"
  -> Rows restored via reverse SQL
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
"List all tables"                         -> names only (fast)
"Show me the users table with columns"    -> columns + types + nullable
"Full schema for orders including FKs"    -> columns + foreign keys + indexes
"Tables starting with user"              -> pattern: 'user%'
```

MCP Resources (`db://schema` and `db://tables/{name}/schema`) give AI agents automatic access to your schema — no manual SQL needed for multi-table queries.

### Query execution with EXPLAIN

```
"Show me all users"
  -> SELECT * FROM users LIMIT 100         <- auto LIMIT

"Show the execution plan for this query"
  -> EXPLAIN ANALYZE with dialect-specific syntax (PostgreSQL/MySQL/SQLite)
```

### Compression modes (v0.3+)

SQL results often carry TEXT / JSON / HTML columns that can be kilobytes per row. AI agents pay for every byte that reaches the context window. `execute_query`, `execute_mutation` and `explain_query` accept four optional parameters that cut 60-95% of those tokens while keeping rows and structure intact.

| Param | Values | What it does |
|---|---|---|
| `verbosity` | `'minimal'` / `'normal'` (default) / `'full'` | Controls detail level |
| `only_columns` | `['id', 'title']` | Returns only these columns (client-side projection) |
| `max_cell_bytes` | number (default `500`) | Per-cell byte cap for `'normal'` |
| `max_rows_in_response` | number | Row cap beyond SQL LIMIT |

**Modes:**

- **`minimal`** — only `rowCount`, `executionTimeMs`, `affectedRows`, and a preview of the first row. Ideal for INSERT/UPDATE/DELETE confirmation, COUNT queries, polling. *Saves ~90-95% tokens.*
- **`normal`** *(default)* — full rows, but each cell truncated to `max_cell_bytes` with a `…(+NB)` marker. Preserves table structure. *Saves ~60-80% tokens on wide rows.*
- **`full`** — entire result untouched. Use when you need the complete value of every cell.

**Typical savings on `SELECT * FROM blog_posts LIMIT 100`** where `content` is ~2KB HTML per row (~200KB total):

| Mode | Tokens consumed | Savings |
|---|---|---|
| `full` | ~50,000 | 0% (baseline) |
| `normal` (500B cells) | ~12,500 | ~75% |
| `only_columns: ['id','title','slug']` | ~2,500 | ~95% |
| `minimal` | ~300 | ~99% |

> For a head-to-head comparison against raw `psql` with measured numbers, see [Native alternatives](#native-alternatives-real-token-cost) below.

**Recovering the full result:** every compressed response includes a `call_id`. If you need the complete cells later, call `inspect_last_query({ call_id })` — **without re-executing the SQL**, preserving DB load and any side-effects. Results are kept in a 20-slot ring buffer and persisted to `~/.database-mcp/last-queries/` with a 1-hour TTL.

```json
// Example: normal (default) response
{
  "call_id": "k3m9a2xp",
  "columns": ["id", "title", "content"],
  "rows": [
    { "id": 1, "title": "Hello", "content": "<h1>Long HTML…(+1847B)" }
  ],
  "rowCount": 1,
  "executionTimeMs": 12,
  "cells_truncated": 1,
  "hint": "1 cell(s) truncated to 500 bytes. Use inspect_last_query({ call_id: \"k3m9a2xp\" }) for full values.",
  "tokens_saved_estimate": 462
}
```

### Native alternatives: real token cost

How this MCP compares against the native options Claude Code has when `database` is not available (Bash + `psql`, `sqlite3`, `mysql` CLI, etc.).

**TL;DR**: compared to raw `psql`, `execute_query` saves between **78% and 96%** of context tokens depending on the mode, with no loss of debugging information. Measured on a real call to `SELECT * FROM blog_posts LIMIT 5` on a PostgreSQL table with a `content` column of ~1 KB of HTML per row:

| How the agent calls it | Uses MCP? | Tokens consumed | Delta vs psql |
|---|:-:|---|---|
| `Bash` + `psql -c "..."` (raw tabular output) | ❌ native | ~1,800 | baseline |
| `Bash` + psql + manual `awk`/column filter | ❌ native | fragile, agent-assembled | hard to measure |
| `execute_query` verbosity=`full` | ✅ MCP | ~1,500 | −17% (less formatting overhead) |
| **`execute_query` verbosity=`normal`** *(default, cells capped at 500 B)* | ✅ MCP | **~400** | **−78%** |
| `execute_query` verbosity=`minimal` | ✅ MCP | ~80 | **−96%** |
| `execute_query` with `only_columns: ["id","title","slug"]` | ✅ MCP | ~130 | **−93%** |

> Why this table's numbers differ from the "Compression modes" section above: these come from a 5-row real-world query, while the previous table extrapolates to a 100-row result with heavier content. Trend and order of magnitude are the same.

Notes:

- Raw `psql` output gets worse as rows grow — JSONB and long TEXT columns have no native filter. The MCP cell-truncation preserves structure (row count + column list) while collapsing heavy cells with a `…(+NB)` marker.
- `inspect_last_query` recovers the complete result **without re-running the SQL**. With `psql` you would have to re-execute, paying DB CPU again and risking re-triggering side-effects on `RETURNING` clauses.
- The MCP also adds features that have no direct native equivalent: connection groups scoped to project directories, automatic rollback snapshots on mutations, query history, schema introspection via MCP Resources, and dump/restore.
- Schema context is added at the end of the response when relevant (default `true` for `normal`/`full`). Disable with `include_schema_context: false` if the agent already knows the schema.
- Every registered MCP adds a fixed overhead of ~300-600 tokens per session (its instructions block + tool names). Typical break-even: 1 real query per session.

### Dump and restore

Full database backup in SQL format — structure only or structure + data.

```
"Dump the database"
  -> Choose: structure only or full
  -> Choose: all tables or specific ones
  -> SQL file saved to .database-mcp/dumps/

"Restore from the last dump"
  -> Lists available dumps, asks for confirmation, executes
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
"Export all connections"                    -> JSON with masked passwords
"Export with secrets included"             -> JSON with real credentials
"Import these connections: { ... }"        -> creates missing connections
```

---

## Tool Reference

33 tools in 8 categories, plus 2 MCP Resources:

| Category | Tools | Count |
|----------|-------|:-----:|
| **Connections** | `conn_create` `conn_list` `conn_get` `conn_set` `conn_switch` `conn_rename` `conn_delete` `conn_duplicate` `conn_test` `conn_export` `conn_import` | 11 |
| **Groups** | `conn_group_create` `conn_group_list` `conn_group_delete` `conn_group_add_scope` `conn_group_remove_scope` `conn_set_default` `conn_set_group` | 7 |
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

**Global: `~/.database-mcp/`** — groups, connections, credentials, and settings. Lives in your home directory. Never inside a project. Never in git. Never shared with anyone unless you explicitly export them.

**Per-project: `{project}/.database-mcp/`** — query history, rollback snapshots, and database dumps. Lives inside the project directory and is automatically added to `.gitignore` on first write.

```
~/.database-mcp/                          # Global (configurable via DATABASE_MCP_DIR)
├── groups/                               # Connection groups with scopes and defaults
├── connections/                          # Connection configs (credentials, chmod 600)
├── project-conns.json                    # Session-only active connections (cleared on restart)
└── config.json                           # Server config (limits)

{your-project}/.database-mcp/            # Per-project (auto-gitignored)
├── history.json                          # Query history (max 5000)
├── rollbacks.json                        # Pre-mutation snapshots (max 1000)
└── dumps/
    └── {conn}-{timestamp}-{mode}.sql     # Database dumps
```

The result: you can share a project repo freely — collaborators get the history and rollback structure, but zero credentials. They create their own connections and groups locally.

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
├── index.ts              # Entry point (StdioServerTransport)
├── server.ts             # createServer() factory
├── tools/                # 33 tool handlers (one file per category)
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
