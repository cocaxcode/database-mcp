<p align="center">
  <h1 align="center">@cocaxcode/database-mcp</h1>
  <p align="center">
    <strong>Talk to your databases in natural language.</strong><br/>
    23 tools &middot; 3 databases &middot; Rollback &middot; Schema auto-discovery &middot; Zero config
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/v/@cocaxcode/database-mcp.svg?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@cocaxcode/database-mcp"><img src="https://img.shields.io/npm/dm/@cocaxcode/database-mcp.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/tools-23-blueviolet?style=flat-square" alt="23 tools" />
  <img src="https://img.shields.io/badge/tests-88-brightgreen?style=flat-square" alt="88 tests" />
</p>

<p align="center">
  <a href="#what-is-this">What is this?</a> &middot;
  <a href="#why-this-one">Why This One</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#just-talk-to-it">Just Talk to It</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#tool-reference">Tool Reference</a> &middot;
  <a href="#what-it-does-not-do">What It Does NOT Do</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## What is this?

An [MCP server](https://modelcontextprotocol.io) that gives your AI assistant the ability to **connect, query, explore, modify, and rollback** any database — PostgreSQL, MySQL, or SQLite — all from natural language.

You describe what you need. The AI writes the SQL, reads the schema, and executes it safely.

No cloud accounts. No subscriptions. No ORMs. Everything runs locally. Connections are stored as plain JSON files. Query history and rollback snapshots live in your project directory.

Works with **Claude Code**, **Claude Desktop**, **Cursor**, **Windsurf**, **Codex CLI**, **Gemini CLI**, and any MCP-compatible client.

---

## Why This One?

There are other database MCP servers out there. Here's why this one is different:

### vs. other MCP database tools

| Capability | @cocaxcode/database-mcp | Others |
|---|:---:|:---:|
| Multi-database (PostgreSQL, MySQL, SQLite) | All three, same UX | Usually one DB only |
| Named connections with CRUD | Create, rename, duplicate, delete | Hardcoded DSN or env var |
| Connection switching (like git branches) | `conn_switch` — instant context change | Restart server |
| Project-scoped connections | Different active DB per project | Global only |
| Schema introspection with FK + indexes | 3 detail levels (names/summary/full) | Basic table list or none |
| MCP Resources for schema auto-discovery | `db://schema` + `db://tables/{name}/schema` | Not available |
| Natural language → multi-table JOINs | AI reads FKs from Resources, builds JOINs | Manual SQL only |
| Pre-mutation rollback snapshots | Auto-captures state before every mutation | Not available |
| Reverse SQL generation | INSERT/UPDATE restored from snapshot | Not available |
| Destructive op confirmation | `confirm: true` required for deletes/rollbacks | Executes immediately |
| Query history with filters | Per-project, filterable by type/connection | Not available |
| LIMIT injection on reads | Auto LIMIT 100, respects existing LIMIT | Returns everything |
| EXPLAIN query support | Multi-dialect (EXPLAIN ANALYZE / EXPLAIN FORMAT=JSON) | Not available |
| Read-only mode | Connection-level enforcement | Not available |
| Password masking | Credentials hidden in `conn_get` output | Shown in plain text |
| External dependencies | **Zero** — just Node.js + your DB driver | Full ORMs, heavy deps |

### The key difference

Most database MCPs either (a) only support one database type with a hardcoded connection string, or (b) expose raw SQL execution with no safety net.

**This tool manages your database connections like environments**, switches between them instantly, auto-discovers schema so the AI can build intelligent queries, captures pre-mutation snapshots for rollback, and requires confirmation before destructive operations. You say *"show me all users who ordered something last week"* and the AI reads the schema, finds the FK between `users` and `orders`, builds the JOIN, and executes it — with a safety LIMIT.

---

## Installation

### Claude Code

```bash
claude mcp add database -- npx -y @cocaxcode/database-mcp@latest
```

### Claude Desktop

Add to your config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

### Cursor / Windsurf

Add to `.cursor/mcp.json` (or `.windsurf/mcp.json`) in your project root:

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

### Codex CLI (OpenAI)

```bash
codex mcp add database -- npx -y @cocaxcode/database-mcp@latest
```

Or add manually to `~/.codex/config.toml`:

```toml
[mcp_servers.database]
command = "npx"
args = ["-y", "@cocaxcode/database-mcp@latest"]
```

### Gemini CLI (Google)

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

### VS Code

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

### With a DSN (connect on startup)

Pass `--dsn` to auto-create a "default" connection on startup:

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

Supported DSN formats:

```
postgresql://user:pass@host:5432/dbname
mysql://user:pass@host:3306/dbname
sqlite:///path/to/file.db
sqlite://:memory:
```

### Driver installation

Install only the driver(s) you need. They are optional peer dependencies — the server loads them dynamically at runtime:

```bash
# PostgreSQL (uses postgres.js — not pg)
npm install -g postgres

# MySQL
npm install -g mysql2

# SQLite (uses sql.js — runs in-process, no native bindings)
npm install -g sql.js
```

If you use `npx`, drivers must be installed globally. If you install the server globally (`npm install -g @cocaxcode/database-mcp`), the drivers can be local or global.

### Quick start

Once installed, create a connection:

```
"Create a PostgreSQL connection called prod with host localhost, port 5432, database myapp, user admin, password secret123"
```

Or with SQLite (no server needed):

```
"Create a SQLite connection called local pointing to ./data/app.db"
```

To verify it's working: *"Test the prod connection"* — it will connect, run a simple query, and report success or failure.

---

## Just Talk to It

You don't need to memorize tool names, parameters, or SQL syntax — just tell the AI what you want.

**Here's what a real conversation looks like:**

| You say | What happens |
|---------|-------------|
| *"Create a connection to my local PostgreSQL"* | Creates connection with your parameters |
| *"Show me all tables"* | `search_schema` with detail_level=names |
| *"What columns does the users table have?"* | `search_schema` for users with detail_level=full (columns, FKs, indexes) |
| *"Show me the last 10 orders with the user name"* | AI reads schema, finds FK, builds `SELECT ... JOIN`, auto LIMIT 10 |
| *"How many users signed up this month?"* | `SELECT COUNT(*) FROM users WHERE created_at >= '2026-03-01'` |
| *"Insert a test user called Alice"* | `INSERT INTO users ...` — captures snapshot for rollback |
| *"Oops, undo that"* | `rollback_apply` — restores pre-insert state |
| *"Delete all inactive users"* | AI asks for confirmation first, then executes with rollback snapshot |
| *"Switch to the production database"* | `conn_switch` — instant context change, all queries go to prod now |
| *"Show me the execution plan for this query"* | `EXPLAIN ANALYZE` with dialect-specific syntax |
| *"What did I run today?"* | `history_list` — filtered query history |
| *"Duplicate the prod connection as staging"* | Creates identical connection with a new name |

**The AI already knows your schema** through MCP Resources. It reads `db://schema` to discover all tables and `db://tables/{name}/schema` to get columns, foreign keys, and indexes. When you say *"show me all orders with their products"*, it doesn't guess — it reads the FKs and builds the correct JOIN.

---

## Works with Any Database

Manage multiple databases simultaneously through named connections. Switch between them like git branches.

### Managing multiple connections

```
"Create a PostgreSQL connection called prod-api with DSN postgresql://admin:pass@db.example.com:5432/api"
"Create a MySQL connection called legacy with host 10.0.0.5, database old_app, user root"
"Create a SQLite connection called analytics pointing to ./data/metrics.db"
"Create a read-only connection called prod-readonly with the same settings as prod-api"
```

Switch context instantly:

```
"Switch to prod-api"
"Show me the users table"              → queries PostgreSQL

"Switch to legacy"
"How many records in the customers table?"  → queries MySQL

"Switch to analytics"
"Last 100 page views"                  → queries SQLite
```

### Project-scoped connections

Different projects can have different active connections. When you switch in one project, it doesn't affect the other:

```
"Switch to prod-api for this project"    → only this project uses prod-api
"Switch to staging globally"             → default for projects without specific assignment
"Show me which projects have connections" → lists all project-connection assignments
"Clear the project connection"           → falls back to global active
```

Resolution order: project-specific connection → global active connection.

---

## Features

### Schema Introspection

Ask about your database structure at three levels of detail:

```
"List all tables"                          → names only (fast)
"Show me the users table with columns"     → names + column types + nullable
"Full schema for orders including FKs"     → columns + foreign keys + indexes
```

Filter by pattern:

```
"Show me all tables that start with user"  → pattern: 'user%'
"List only views"                          → object_type: 'view'
```

### MCP Resources (AI auto-discovery)

The server exposes database schema as **MCP Resources**, which AI agents read automatically to understand your data model:

- `db://schema` — Complete schema of the active database
- `db://tables/{tableName}/schema` — Detailed schema for one table (columns, types, FKs, indexes)

**Why this matters:** When you say *"show me all users who placed an order last week"*, the AI reads the Resources, discovers the FK between `users.id` and `orders.user_id`, and builds the correct JOIN — no manual SQL required.

### Query Execution

**Read queries** get automatic safety measures:

```
"Show me all users"
→ SELECT * FROM users LIMIT 100    ← auto LIMIT injection
```

The LIMIT defaults to 100 but respects any explicit LIMIT you provide. You can also specify a custom limit:

```
"Show me the first 500 orders"
→ SELECT * FROM orders LIMIT 500
```

**Mutations** capture pre-state for rollback:

```
"Delete all orders from 2024"
→ AI asks: "This will delete N rows. Call again with confirm=true to proceed."
→ You confirm
→ Snapshot captured, DELETE executed, rollback ID returned
```

### Rollback System

Every mutation (INSERT, UPDATE, DELETE) automatically captures a **pre-mutation snapshot** of the affected rows. You can restore them at any time.

```
"Show me available rollbacks"
→ Lists snapshots with ID, SQL, timestamp, affected rows

"Rollback the last delete"
→ Preview: "This will INSERT 47 rows back into orders. Call with confirm=true."
→ You confirm
→ Rows restored via reverse SQL
```

**How rollback works internally:**

| Original Operation | Rollback Strategy |
|---|---|
| `DELETE FROM users WHERE id = 5` | `INSERT INTO users (id, name, ...) VALUES (5, 'Alice', ...)` |
| `UPDATE users SET name = 'Bob' WHERE id = 5` | `UPDATE users SET name = 'Alice' WHERE id = 5` (restores pre-update values) |
| `INSERT INTO users ...` | `DELETE FROM users WHERE id = {new_id}` |
| DDL (CREATE, ALTER, DROP) | Snapshot stored but rollback blocked — DDL changes are logged, not reversible |

Snapshots are stored per-project (max 500, auto-truncated).

### Query History

Every query is logged per-project with timestamp, SQL, connection name, execution time, and result type.

```
"What queries did I run today?"
"Show me only the mutations"
"Show me history for the prod connection"
"Clear all history"
```

History is stored in `{project}/.database-mcp/history.json` (max 5000 entries, auto-truncated).

### Export & Import Connections

Share your database connections between machines or team members:

```
"Export all my connections"                     → JSON with masked passwords
"Export connections with secrets included"       → JSON with real credentials
"Export just the prod-api connection"            → single connection
```

Import on another machine:

```
"Import these connections: { ... }"             → creates missing connections
"Import with overwrite"                         → replaces existing ones too
```

Passwords are masked by default in exports. Use `include_secrets=true` to include real credentials. After importing masked connections, update the passwords with `conn_set`.

### Connection Safety

| Feature | How it works |
|---|---|
| **Read-only mode** | `mode: 'read-only'` blocks all mutations at the connection level |
| **Confirmation required** | `conn_delete` and `rollback_apply` require explicit `confirm: true` |
| **Password masking** | `conn_get` shows `***` instead of real passwords |
| **Auto LIMIT** | Read queries get LIMIT 100 by default |
| **Auto gitignore** | `.database-mcp/` added to `.gitignore` on first write |

---

## Tool Reference

23 tools organized in 6 categories:

| Category | Tools | Count |
|----------|-------|-------|
| **Connections** | `conn_create` `conn_list` `conn_get` `conn_set` `conn_switch` `conn_rename` `conn_delete` `conn_duplicate` `conn_test` `conn_project_list` `conn_project_clear` `conn_export` `conn_import` | 13 |
| **Schema** | `search_schema` | 1 |
| **Queries** | `execute_query` `execute_mutation` `explain_query` | 3 |
| **Rollback** | `rollback_list` `rollback_apply` | 2 |
| **History** | `history_list` `history_clear` | 2 |
| **Config** | `config_get` `config_set` | 2 |

Plus 2 MCP Resources: `db://schema` and `db://tables/{tableName}/schema`.

You don't need to call these tools directly. Just describe what you want and the AI picks the right one.

---

## Storage

All connection data lives in `~/.database-mcp/` (user home directory) as plain JSON — no database, no cloud sync. Per-project data (history, rollbacks) lives in the project directory.

```
~/.database-mcp/                          # Global (configurable via DATABASE_MCP_DIR)
├── connections/
│   └── {name}.json                       # Connection configs (host, port, user, etc.)
├── active-conn                           # Global active connection name
└── project-conn/
    └── {project-hash}                    # Per-project active connection

{your-project}/.database-mcp/            # Per-project (auto-added to .gitignore)
├── history.json                          # Query history (5000 max, configurable)
└── rollbacks.json                        # Pre-mutation snapshots (1000 max, configurable)
```

### Configuration

Limits are configurable from the conversation — no need to edit config files:

```
"Show me the current config"
"Set max rollbacks to 2000"
"Set max history to 10000"
```

Settings are saved permanently in `~/.database-mcp/config.json`.

You can also override via environment variables (takes priority over saved config):

| Variable | Description | Default |
|---|---|---|
| `DATABASE_MCP_DIR` | Global storage directory | `~/.database-mcp/` |
| `DATABASE_MCP_MAX_ROLLBACKS` | Max rollback snapshots per project | `1000` |
| `DATABASE_MCP_MAX_HISTORY` | Max history entries per project | `5000` |

```json
{
  "mcpServers": {
    "database": {
      "command": "npx",
      "args": ["-y", "@cocaxcode/database-mcp@latest"],
      "env": {
        "DATABASE_MCP_MAX_ROLLBACKS": "2000",
        "DATABASE_MCP_MAX_HISTORY": "10000"
      }
    }
  }
}
```

Priority: **env var > saved config > default**.

> **Warning:** If you override `DATABASE_MCP_DIR` to a path inside a git repository, add `.database-mcp/` to your `.gitignore` to avoid accidentally pushing credentials to your remote.

---

## What It Does NOT Do

Being clear about scope:

- **No ORM / migrations** — This is a query and exploration tool, not Prisma or Knex. It doesn't generate migration files or manage schema versions.
- **No connection pooling** — One connection per named config. This is designed for AI-assisted exploration, not high-throughput application use.
- **No NoSQL** — PostgreSQL, MySQL, and SQLite only. No MongoDB, Redis, DynamoDB, etc.
- **No cloud databases with custom auth** — Standard DSN/credentials only. No IAM auth, no SSL client certificates (yet).
- **No transaction management** — Each mutation is a standalone operation. Rollback is via reverse SQL from snapshots, not SQL `ROLLBACK`.
- **No GUI / dashboard** — It's a headless MCP server. The AI client (Claude, Cursor, etc.) is the interface.
- **No data export** — It returns query results to the AI. If you need CSV/Excel export, that's a different tool.

---

## Architecture

Built for reliability and testability:

- **Zero runtime dependencies** — only `@modelcontextprotocol/sdk` and `zod`
- **88 integration tests** with SQLite `:memory:` (no real DB needed in CI)
- **Factory pattern** — `createServer(storageDir?, projectDir?)` for isolated test instances
- **Strict TypeScript** — zero `any`, full type coverage
- **< 60KB** bundled output via tsup
- **Dynamic driver loading** — `import('postgres')` / `import('mysql2/promise')` / `import('sql.js')` at runtime

```
src/
├── tools/           # 19 MCP tool handlers (one file per category)
├── resources/       # MCP Resources (schema auto-discovery)
├── services/        # Business logic with DB interaction
│   ├── connection-manager   # Lazy connect, driver caching
│   ├── schema-introspector  # Multi-dialect introspection
│   ├── query-executor       # Read/mutation/explain with safety
│   ├── rollback-manager     # Snapshot capture + reverse SQL
│   └── history-logger       # Per-project query log
├── drivers/         # Database adapters (postgres, mysql, sqlite)
├── lib/             # Pure logic (types, storage, sanitize)
├── utils/           # SQL classifier, parser, formatter
└── __tests__/       # 10 test suites, 88 tests
```

---

## Contributing

```bash
git clone https://github.com/cocaxcode/database-mcp.git
cd database-mcp
npm install
npm test            # 88 tests across 10 suites
npm run build       # ESM bundle via tsup
npm run typecheck   # Strict TypeScript
```

**Test with MCP Inspector:**

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

**Stack:** TypeScript &middot; MCP SDK 1.27 &middot; Zod &middot; Vitest &middot; tsup

### How to contribute

- **Bug reports**: [Open an issue](https://github.com/cocaxcode/database-mcp/issues) with steps to reproduce, expected vs actual behavior, and your Node.js version.
- **Feature requests**: Open an issue describing the use case. Include examples of how you'd use it in natural language.
- **Pull requests**: Fork, create a branch, make your changes, ensure `npm test` and `npm run typecheck` pass, then open a PR.

---

## License

[MIT](./LICENSE) — built by [cocaxcode](https://github.com/cocaxcode)
