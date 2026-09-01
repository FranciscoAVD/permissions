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
- [ ] **Multiple roles per user / role hierarchy.** Currently one literal `role` per user, and every
      role repeats its full grant list (`admin` still lists `"post:create"`, `"post:read"`, etc.
      individually even though it's "obviously" a superset). Needs either `roles: Role[]` on
      `User`, or a way to say "role A inherits role B's grants plus these."
- [x] **Wildcard / default fallback (resource-scoped).** v2.1.0 added a `"resource:*"` key
      meaning "every action on this resource," resolved with most-specific-wins precedence
      against `"resource:action"` keys — so "allow everything except X" now falls directly
      out of "grant the wildcard, then override the exception." A bare `"*"` (every resource,
      every action) is deliberately out of scope: a function-valued bare `"*"` would need
      `resource` typed as a union across every resource type, which isn't very usable — left
      for a future item if ever wanted.

## Medium priority

- [ ] **Per-resource action sets.** `Actions` is one global union shared by every resource, so a
      resource-specific action (e.g. `post:publish`) still shows up as a nonsensical
      `"comment:publish"` key in every other resource's permission set. The v2.0.0 redesign
      removed the *boilerplate* cost (no role is forced to write a dummy entry for it anymore),
      but the type-noise/autocomplete-pollution cost remains. Would need `Resources` to map each
      key to its own action union.
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
