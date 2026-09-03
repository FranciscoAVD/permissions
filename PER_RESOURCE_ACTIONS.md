# Per-resource action sets — design options

Roadmap item from `TODO.md` (Medium priority): `Actions` today is one global tuple shared by
every resource, via `PermissionKey<Actions, Resources>`. Adding a resource-specific action (e.g.
`post:publish`) means either polluting the global tuple — which leaks a nonsensical
`comment:publish` into every other resource's key space — or has no clean way to express it. This
document is a decision record, not an implementation plan.

## Option A — separate `ResourceActions` map (recommended)

```ts
const actions = ["create", "read", "update", "delete"] as const; // global, shared by every resource
const postActions = ["publish", "archive"] as const;              // post-only extras

type Resources = { post: Post; comment: Comment };
type ResourceActions = { post: (typeof postActions)[number] }; // "publish" | "archive"

type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources, ResourceActions>;
```

**Pros**
- Fully additive: `ResourceActions` defaults to `{}`, so existing 4-arg `PermissionsGenerator`
  usage is untouched.
- `Resources` keeps its current, plain model-map meaning — no reinterpretation of an existing type.
- Verified via a scratch `tsc` compile that a type parameter's constraint can reference a later,
  defaulted type parameter. Appending `ResourceActions` *after* `P` on `createCan` means every
  existing `createCan<...>(...)` call site — including ones that spell out every generic
  explicitly, like this repo's tests — keeps compiling with zero changes.

**Cons**
- One more map to declare and keep in sync per resource, alongside `Resources` and `actions`.
- Grows `createCan`'s already-long explicit generic list by one more (optional, trailing) slot
  for anyone who uses the feature.

## Option B — colocate extras on the resource entry itself

```ts
type Resources = {
  post: { model: Post; actions: "publish" | "archive" };
  comment: { model: Comment };
};
```

**Pros**
- Extra actions sit right next to the type they extend — one place to look for "what actions
  exist on this resource."
- No new generic parameter anywhere.

**Cons**
- Breaking change to what a `Resources` entry means for *every* consumer, including ones who
  never use extra actions — every existing `type Resources = { post: Post }` declaration would
  need to become `{ post: { model: Post } }`.
- Internal resource-type derivation (`Resources[K]` → `Resources[K]["model"]`) ripples through
  `CheckFor`, `ResourceOf`, and everywhere else `Resources[K]` is used today.

## Recommendation

Option A — non-breaking, keeps `Resources`'s meaning stable, and matches how every feature so far
(wildcards, `extends`) shipped: additive and opt-in, old code untouched.

## Open question, not resolved here

Wildcard expansion (`"post:*"`) would need to expand to global-actions-∪-that-resource's-extras,
and the `Expand` / `EffectiveKeys` / `ResolveCheck` type machinery would need `ResourceActions`
threaded through the same way `extends` was threaded through for role hierarchy. That's a fact to
design during implementation, not solved in this document.
