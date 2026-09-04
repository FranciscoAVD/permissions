# Roadmap

Ordered by priority — highest-impact/most-foundational first. Each item includes why it matters and roughly how disruptive it is to the current design.

**v2.0.0 redesign note:** the permission table shape changed from a nested
`{resource: {role: {action: check}}}` matrix to a flat `{role: {"resource:action": check}}`
map (`PermissionsGenerator`/`createCan` in `index.ts`). Gained: a role can only be asked
about a permission it actually declared — `can(user, "post:delete")` is a compile error, not
an implicit deny, if that role never listed `"post:delete"`. Roles also no longer have to
enumerate permissions they lack (no forced `false` entries). Lost, then partially
replaced in v2.1.0: the v1.2.0 whole-role `boolean` shortcut (`admin: true` for "every
action, every resource") has no direct equivalent — a `"resource:*"` key added in
v2.1.0 covers "every action on this resource," with a more specific
`"resource:action"` key overriding the wildcard, but a bare `"*"` spanning every
resource is still deliberately unimplemented.

## High priority

- [x] **Async check functions.** `can()` was synchronous only. Most real checks need a DB lookup
      (e.g. "is this user on the post's team"), so check functions can now return
      `Promise<boolean>`. `can()`'s return type is derived per call from the actual check
      function's return type, so sync checks stay plain `boolean` — only permissions backed
      by an async check require `await`.
- [x] **Role hierarchy.** A role's entry can now declare `extends: Role[]` to inherit another
      role's (or chain of roles') grants — `admin` no longer has to repeat every permission
      `editor` already lists if it simply declares `extends: ["editor"]`. A role's own keys
      always override anything inherited, and later entries in `extends` override earlier ones
      on the same key when a role has multiple parents. Cyclic `extends` graphs are rejected at
      `createCan()` construction time, not silently allowed. Deliberately still out of scope:
      multiple roles *per user* (see below) — this only lets one role inherit from another at
      the type/permissions-table level.
- [x] **Multiple roles per user.** `User.role: Roles[number]` is now `User.roles: Roles[number][]`
      — always an array, even for one role (breaking change, mirroring how `extends` was already
      "always an array"). A user can hold more than one role at once (distinct from role
      hierarchy above, which is a fixed graph declared per-role in the table, not a set chosen
      per-user at runtime). Conflict policy: most-permissive-wins — a permission is grantable if
      *any* held role (or that role's own `extends` ancestors) grants it, a plain logical OR
      across every held role's resolved check, with no dependence on array order (unlike
      `extends`'s last-listed-wins).
- [x] **Wildcard / default fallback (resource-scoped).** v2.1.0 added a `"resource:*"` key
      meaning "every action on this resource," resolved with most-specific-wins precedence
      against `"resource:action"` keys — so "allow everything except X" now falls directly
      out of "grant the wildcard, then override the exception." A bare `"*"` (every resource,
      every action) is deliberately out of scope: a function-valued bare `"*"` would need
      `resource` typed as a union across every resource type, which isn't very usable — left
      for a future item if ever wanted.

## Medium priority

- [x] **Per-resource action sets.** `Actions` was one global union shared by every resource, so a
      resource-specific action (e.g. `post:publish`) showed up as a nonsensical
      `"comment:publish"` key in every other resource's permission set. Each `Resources` entry is
      now `{ model: ...; actions?: ... }` — extra actions declared there are additive to the
      global `Actions` union for that resource only, including through `"resource:*"` wildcard
      expansion. This is a breaking change to what a `Resources` entry means: every existing
      `{ post: Post }` declaration becomes `{ post: { model: Post } }`. See
      `PER_RESOURCE_ACTIONS.md` for the design record — shipped as "Option B" (colocated on the
      resource entry) rather than the doc's recommended "Option A" (a separate map), traded for
      keeping a resource's actions next to its model instead of a non-breaking, additive change.
- [ ] **Query/list-level filtering.** `can()` only answers "can this user touch this specific
      instance," not "what's the filter for which posts this user can see" — needed for any list
      endpoint. Likely means check functions can optionally return a query predicate, not just a
      boolean.
- [x] **Policy composition (AND/OR, explicit deny).** Shipped as exported `and`/`or`/`not`
      combinators over the existing check-value shape (`boolean | (user, resource) => boolean |
      Promise<boolean>`) — not a new table construct, and not a change to multi-role resolution.
      "Explicit deny" is expressed by composition, `and(grant, not(veto))`, rather than a
      dedicated primitive. Combinators nest (`and(or(a, b), not(c))` is valid) and share a runtime
      reduction (`combineChecks` in `index.ts`) with `createCan`'s own multi-role
      most-permissive-wins resolution — `evaluateAny` was refactored into that shared helper
      rather than kept as a near-duplicate.

## Lower priority

- [ ] **Explainability / audit trail.** No way to ask "why was this denied" or log which rule fired.
      Valuable for debugging and compliance, not blocking for basic use.
- [ ] **Framework integration helpers.** Bare function today — no Express/Hono middleware,
      decorators, or GraphQL directive helpers. Straightforward to add once the core API is stable,
      not worth building against a moving target.

## Out of scope

- **Runtime-loaded/dynamic policies.** The whole value proposition is compiler-enforced
  correctness — permissions loaded from a database or admin UI at runtime would lose that
  entirely. Would be a different tool, not an incremental feature.
