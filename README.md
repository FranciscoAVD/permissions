# permissions

A Bun workspaces monorepo for `@vicstack/permissions`, a type-safe, role-based permission checking
library, and its framework adapters. Each package publishes independently to npm.

## Packages

| Package | Path | Description |
| --- | --- | --- |
| [`@vicstack/permissions`](packages/core/README.md) | `packages/core` | The core RBAC library — `createCan`, `and`/`or`/`not`, audit logging. No runtime dependencies. |
| [`@vicstack/adapters-hono`](packages/adapters/hono/README.md) | `packages/adapters/hono` | Hono middleware adapter (`guard`, `authorize`). |

Future framework adapters live as siblings under `packages/adapters/*`.

## Develop

```bash
bun install
bun run typecheck   # both packages
bun test             # both packages
bun run build         # builds packages/core first, then packages/adapters/hono
```

`packages/adapters/hono` resolves `@vicstack/permissions`'s types from its built `dist/`, so
`packages/core` must be built before the adapter's typecheck/build/test will see fresh types — the
root `build`/`typecheck`/`test` scripts already run in that order.
