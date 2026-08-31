# Roadmap

Ordered by priority — highest-impact/most-foundational first. Each item includes why it matters and roughly how disruptive it is to the current design.

## High priority

- [x] **Async check functions.** `can()` was synchronous only. Most real checks need a DB lookup
      (e.g. "is this user on the post's team"), so check functions can now return
      `Promise<boolean>`. `can()`'s return type is derived per call from the actual check
      function's return type (same trick as `RequiresResource`), so sync checks stay plain
      `boolean` — only actions backed by an async check require `await`.
- [ ] **Multiple roles per user / role hierarchy.** Currently one literal `role` per user, and every
      role repeats its full grant list (`admin` spells out `create/read/update/delete: true` even
      though it's "obviously" a superset). Needs either `roles: Role[]` on `User`, or a way to say
      "role A inherits role B's grants plus these."
- [x] **Wildcard / default fallback (whole-role shortcut only).** Every cell in the table had to be
      filled in explicitly, including roles that grant (or deny) every action identically. A
      role's entry can now be a plain `boolean` instead of the full per-action object, short-
      circuiting every action for that role/resource with no resource argument ever required.
      This only covers the "same value for every action" case — there's still no way to say
      "allow everything except X" (a partial wildcard with explicit per-action exceptions);
      that remains unsolved and would need a separate mechanism (e.g. a `"*"` action key).

## Medium priority

- [ ] **Per-resource action sets.** `Actions` is one global union shared by every resource, so a
      resource-specific action (e.g. `post:publish`) pollutes every other resource's table with a
      meaningless boolean. Would need `Resources` to map each key to its own action union.
- [ ] **Query/list-level filtering.** `can()` only answers "can this user touch this specific
      instance," not "what's the filter for which posts this user can see" — needed for any list
      endpoint. Likely means check functions can optionally return a query predicate, not just a
      boolean.
- [ ] **Policy composition (AND/OR, explicit deny).** No way to combine multiple checks or have an
      explicit deny override an allow from elsewhere. Needed once permissions come from more than
      one source (e.g. role grant + resource-owner override).

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
