// a resource entry's model type — the actual object a check function receives.
type ModelOf<R> = R extends { model: infer M } ? M : never;

// a resource entry's extra, resource-specific actions (on top of the global `Actions`
// union) — e.g. `"publish" | "archive"` on a `post` entry that other resources don't get.
type ExtraActionsOf<R> = R extends { actions: infer A extends string } ? A : never;

export type PermissionKey<
  Actions extends readonly string[],
  Resources extends Record<string, { model: any; actions?: string }>,
> = {
  [K in Extract<keyof Resources, string>]:
    | `${K}:${Actions[number] | ExtraActionsOf<Resources[K]>}`
    | `${K}:*`;
}[Extract<keyof Resources, string>];

type CheckFor<P extends string, User, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}`
    ? K extends keyof Resources
      ? boolean | ((user: User, resource: ModelOf<Resources[K]>) => boolean | Promise<boolean>)
      : never
    : never;

type ResourceOf<P extends string, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}`
    ? K extends keyof Resources
      ? ModelOf<Resources[K]>
      : never
    : never;

// expands a single declared key into the concrete permission(s) it covers — a wildcard
// key expands to every action on its resource (global actions plus that resource's own
// extras), anything else passes through unchanged. `Key` must be a naked type parameter
// here (not inlined) for the conditional to distribute over the union callers feed it
// (e.g. `keyof RoleEntry & string`) — same rule this file already relies on for
// `CheckValue` in the v2.0.0 migration.
type Expand<Key extends string, Actions extends readonly string[], Resources extends Record<string, any>> =
  Key extends `${infer Res}:*`
    ? Res extends keyof Resources
      ? `${Res}:${Actions[number] | ExtraActionsOf<Resources[Res]>}`
      : `${Res}:${Actions[number]}`
    : Key;

// a role entry's own permission keys, excluding the reserved `extends` field — `extends`
// declares parent roles, it is never itself a "resource:action" permission.
type DeclaredKeys<RoleEntry> = Exclude<keyof RoleEntry & string, "extends">;

// artificial recursion cap for walking an `extends` graph at the type level. Real
// hierarchies are a handful of levels deep at most; this exists purely so a mistakenly
// cyclic `extends` graph can't trip TypeScript's own recursion-depth guard (which would
// surface as a "type instantiation is excessively deep" compile error instead of the
// clear runtime error `createCan()` throws for cycles). Bump if a legitimate hierarchy
// is ever deeper than this.
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// every ancestor role name reachable from `R` by following `extends` (own role not
// included). Depth-capped: a cycle just stops contributing further ancestors once the
// cap is hit rather than recursing forever.
type AncestorRoles<Perms, R extends keyof Perms, D extends number = 12> = D extends 0
  ? never
  : Perms[R] extends { extends: readonly (infer A extends keyof Perms)[] }
    ? A | DistributeAncestors<Perms, A, Depth[D]>
    : never;

type DistributeAncestors<Perms, A extends keyof Perms, D extends number> =
  A extends any ? AncestorRoles<Perms, A, D> : never;

// every concrete permission a role can be asked about: its own declared keys (wildcards
// expanded) unioned with every ancestor's, recursively. Order doesn't matter here — it's
// a plain set union, unlike `ResolveCheck` below where override precedence matters.
type EffectiveKeys<
  Perms,
  R extends keyof Perms,
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> = DistributeEffectiveKeys<Perms, R | AncestorRoles<Perms, R>, Actions, Resources>;

type DistributeEffectiveKeys<
  Perms,
  Rs extends keyof Perms,
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> = Rs extends any ? Expand<DeclaredKeys<Perms[Rs]>, Actions, Resources> : never;

// every concrete permission askable by a user holding more than one role at once: the
// union of each directly-held role's own `EffectiveKeys` (which already includes that
// role's `extends` ancestors). A separate, independent distribution from the one inside
// `EffectiveKeys` above — this fans out over "which roles does the user hold," not "which
// ancestors does one role have." `Rs` must be naked here for the same reason documented
// above `Expand`.
type EffectiveKeysForRoleSet<
  Perms,
  Rs extends keyof Perms,
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> = Rs extends any ? EffectiveKeys<Perms, Rs, Actions, Resources> : never;

// resolves a role's OWN check for a permission only — exact key, falling back to the
// role's own wildcard. Does not look at ancestors. `never` if the role itself declares
// neither (not even via its own wildcard).
type OwnResolve<RoleEntry, Perm extends string> =
  Perm extends keyof RoleEntry
    ? RoleEntry[Perm]
    : Perm extends `${infer Res}:${string}`
      ? `${Res}:*` extends keyof RoleEntry
        ? RoleEntry[`${Res}:*`]
        : never
      : never;

// resolves the check for a concrete permission, honoring inheritance: a role's own
// resolution (exact key, else its own wildcard) always wins outright; only when the role
// declares neither does it fall back to its parents, recursively up the chain.
//
// `extends` is a mutable array type (`Roles[number][]`), not a tuple, so TypeScript
// can't preserve left-to-right parent order at the type level. That only matters when
// two-or-more ancestors declare *conflicting* values for the exact same permission with
// no override in between — in that narrow case this resolves to the union of every
// conflicting candidate rather than pretending to pick the one runtime will actually
// use. That's intentionally loose but sound: runtime's actual resolution (which does
// honor `extends` order — see `createCan`) is always assignable to this union. The only
// consequence is that `ParamCount` below may treat the resource argument as optional
// rather than required when conflicting candidates disagree on arity — an accepted
// tradeoff, not a bug to chase away with an `as const` requirement on `extends`.
type ResolveCheck<Perms, R extends keyof Perms, Perm extends string, D extends number = 12> =
  OwnResolve<Perms[R], Perm> extends never
    ? D extends 0
      ? never
      : Perms[R] extends { extends: readonly (infer A extends keyof Perms)[] }
        ? DistributeResolve<Perms, A, Perm, Depth[D]>
        : never
    : OwnResolve<Perms[R], Perm>;

type DistributeResolve<Perms, A extends keyof Perms, Perm extends string, D extends number> =
  A extends any ? ResolveCheck<Perms, A, Perm, D> : never;

// every resolved check across a set of directly-held roles for one concrete permission —
// most-permissive-wins is implemented at runtime (see `evaluateAny` in `createCan`) as a
// logical OR over exactly these candidates. Only roles that actually resolve `Perm` (via
// `ResolveCheck`, itself already honoring that role's own `extends` chain) contribute a
// candidate; a role that doesn't declare it contributes `never`, which vanishes from the
// union.
type ResolveCheckForRoleSet<Perms, Rs extends keyof Perms, Perm extends string> =
  Rs extends any ? ResolveCheck<Perms, Rs, Perm> : never;

// the shape of a single permission's check value: a plain boolean, or a function that
// reads the resource. Exported so callers can type their own reusable check functions,
// and so `and`/`or`/`not` below can compose them.
export type CheckValue<User, Resource> =
  | boolean
  | ((user: User, resource: Resource) => boolean | Promise<boolean>);

// shared reduction behind `and`/`or` (and behind `createCan`'s own multi-role
// most-permissive-wins resolution) — "any" short-circuits on a synchronous `true` (OR),
// "all" short-circuits on a synchronous `false` (AND); either way, only awaits when a
// still-pending (Promise-returning) check is actually needed to decide the outcome.
function combineChecks<User, Resource>(
  checks: CheckValue<User, Resource>[],
  user: User,
  resource: Resource,
  mode: "any" | "all",
): boolean | Promise<boolean> {
  const shortCircuit = mode === "any";
  const pending: Promise<boolean>[] = [];
  for (const check of checks) {
    const result = typeof check === "function" ? check(user, resource) : check;
    if (result === shortCircuit) return shortCircuit;
    if (result instanceof Promise) pending.push(result as Promise<boolean>);
  }
  if (pending.length === 0) return !shortCircuit;
  return Promise.all(pending).then((settled) =>
    settled.some((s) => s === shortCircuit) ? shortCircuit : !shortCircuit
  );
}

/**
 * Combines checks with AND: grants only if every check grants. Usable anywhere a check
 * value is expected, including nested inside another `and`/`or`/`not`. Using a combinator
 * always makes `can()`'s resource argument required and its return type `Promise<boolean>`
 * — even if none of the composed checks actually read the resource or are async — since
 * the composed checks' own arity/async-ness isn't visible at `and`'s call site.
 */
export function and<User, Resource>(
  ...checks: CheckValue<User, Resource>[]
): (user: User, resource: Resource) => boolean | Promise<boolean> {
  return (user, resource) => combineChecks(checks, user, resource, "all");
}

/**
 * Combines checks with OR: grants if any check grants. Same resource/async-arity tradeoff
 * as `and` above.
 */
export function or<User, Resource>(
  ...checks: CheckValue<User, Resource>[]
): (user: User, resource: Resource) => boolean | Promise<boolean> {
  return (user, resource) => combineChecks(checks, user, resource, "any");
}

/**
 * Negates a check — grants exactly when the wrapped check would deny. Compose with `and`
 * to express "explicit deny": `and(grant, not(veto))`.
 */
export function not<User, Resource>(
  check: CheckValue<User, Resource>
): (user: User, resource: Resource) => boolean | Promise<boolean> {
  return (user, resource) => {
    const result = typeof check === "function" ? check(user, resource) : check;
    return result instanceof Promise ? result.then((r) => !r) : !result;
  };
}

export type PermissionsGenerator<
  User extends { roles: readonly Roles[number][] },
  Roles extends readonly string[],
  Actions extends readonly string[],
  Resources extends Record<string, { model: any; actions?: string }>,
> = {
  [UR in Roles[number]]: Partial<{
    [P in PermissionKey<Actions, Resources>]: CheckFor<P, User, Resources>;
  }> & {
    /** Parent roles this role inherits grants from — always an array. Later entries
     * override earlier ones on conflicting keys. This role's own keys (including its
     * own wildcard) always override anything inherited, regardless of `extends` order.
     * Cyclic `extends` graphs are rejected at `createCan()` construction time. */
    extends?: Roles[number][];
  };
};

/**
* Caller's `user` must keep a literal `roles` array (e.g. `satisfies User`, not `: User`)
* or `can` can't narrow which roles' permissions apply. A role can only be asked about a
* permission it actually declared, or that an ancestor listed in its `extends` declared
* — anything else is a compile error, not an implicit deny. A role may declare a
* `"resource:*"` wildcard to cover every action on that resource in one entry; a more
* specific `"resource:action"` key always overrides the wildcard for that action. A role
* may also declare `extends: [...]` to inherit another role's (or chain of roles')
* grants — its own keys always win over anything inherited, and when multiple parents
* are listed, later entries override earlier ones on the same key. A `Resources` entry
* may declare an `actions` union (alongside its required `model`) for actions specific to
* that one resource — additive to the global `Actions` union, invisible to every other
* resource's keys, and included in that resource's own `"resource:*"` wildcard expansion.
* `User.roles` is always an array — a user can hold more than one role at once, and a
* permission is grantable if ANY held role (or its `extends` ancestors) grants it:
* most-permissive-wins, a logical OR across every held role's resolved check, not an
* override.
*/
export function createCan<
  User extends { roles: readonly Roles[number][] },
  Roles extends readonly string[],
  Actions extends readonly string[],
  Resources extends Record<string, any>,
  P extends PermissionsGenerator<User, Roles, Actions, Resources>,
>(permissions: P) {
  type Check = boolean | ((user: User, resource?: unknown) => boolean | Promise<boolean>);
  type Table = Record<string, Check>;

  // flattens each role's effective permission table once, ancestors-first (so a role's
  // own keys, merged in last, always win), following `extends` left-to-right so a later
  // parent overwrites an earlier one on a conflicting key.
  const resolved = new Map<string, Table>();
  const visiting = new Set<string>();

  function resolveRole(role: string): Table {
    const cached = resolved.get(role);
    if (cached) return cached;

    if (visiting.has(role)) {
      throw new Error(
        `permissions: cyclic role inheritance detected (${[...visiting, role].join(" -> ")})`
      );
    }
    visiting.add(role);

    const table = permissions as unknown as Record<string, Table & { extends?: readonly string[] }>;
    const entry = table[role];
    if (!entry) {
      throw new Error(`permissions: role "${role}" is referenced by "extends" but has no entry`);
    }

    const { extends: parents, ...own } = entry;

    const merged: Table = {};
    for (const parent of parents ?? []) {
      Object.assign(merged, resolveRole(parent)); // later parents overwrite earlier ones
    }

    // an own wildcard must override every inherited key for that resource outright, not
    // just lose to an inherited specific key via the usual "exact key beats wildcard"
    // lookup below (which only applies within one already-flattened table).
    for (const ownKey of Object.keys(own)) {
      if (!ownKey.endsWith(":*")) continue;
      const resource = ownKey.slice(0, -":*".length);
      for (const mergedKey of Object.keys(merged)) {
        if (mergedKey === ownKey || mergedKey.startsWith(`${resource}:`)) {
          delete merged[mergedKey];
        }
      }
    }

    Object.assign(merged, own); // own keys always win, last

    visiting.delete(role);
    resolved.set(role, merged);
    return merged;
  }

  // resolve every role up front so a cyclic `extends` graph throws here, at construction
  // time, rather than lazily on the first affected `can()` call.
  for (const role of Object.keys(permissions)) {
    resolveRole(role);
  }

  // number of declared params on a check value (booleans count as 0)
  type ParamCount<T> = T extends (...args: infer PA) => any ? PA["length"] : 0;

  // true if this specific check value's function returns a Promise
  type IsAsync<T> = T extends (...args: any[]) => infer Ret ? (Ret extends Promise<any> ? true : false) : false;

  return function can<
    R extends readonly Roles[number][],
    Perm extends EffectiveKeysForRoleSet<P, R[number], Actions, Resources>,
  >(
    user: User & { roles: R },
    permission: Perm,
    ...args: ParamCount<ResolveCheckForRoleSet<P, R[number], Perm>> extends 2
      ? [resource: ResourceOf<Perm, Resources>]
      : [resource?: ResourceOf<Perm, Resources>]
  ): true extends IsAsync<ResolveCheckForRoleSet<P, R[number], Perm>> ? Promise<boolean> : boolean {
    const [resource] = args as [ResourceOf<Perm, Resources>?];
    const [resourceKey] = (permission as string).split(":");

    const checks: Check[] = [];
    for (const role of user.roles) {
      const table = resolved.get(role)!;
      const check = permission in table ? table[permission] : table[`${resourceKey}:*`];
      if (check !== undefined) checks.push(check);
    }

    return combineChecks(checks, user, resource, "any") as true extends IsAsync<
      ResolveCheckForRoleSet<P, R[number], Perm>
    >
      ? Promise<boolean>
      : boolean;
  };
}
