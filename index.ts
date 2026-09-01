export type PermissionKey<
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> =
  | `${Extract<keyof Resources, string>}:${Actions[number]}`
  | `${Extract<keyof Resources, string>}:*`;

type CheckFor<P extends string, User, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}`
    ? K extends keyof Resources
      ? boolean | ((user: User, resource: Resources[K]) => boolean | Promise<boolean>)
      : never
    : never;

type ResourceOf<P extends string, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}` ? (K extends keyof Resources ? Resources[K] : never) : never;

// expands a single declared key into the concrete permission(s) it covers — a wildcard
// key expands to every action on its resource, anything else passes through unchanged.
// `Key` must be a naked type parameter here (not inlined) for the conditional to
// distribute over the union callers feed it (e.g. `keyof RoleEntry & string`) — same
// rule this file already relies on for `CheckValue` in the v2.0.0 migration.
type Expand<Key extends string, Actions extends readonly string[]> =
  Key extends `${infer Res}:*` ? `${Res}:${Actions[number]}` : Key;

// every concrete permission a role's declared keys make askable, wildcards expanded
type EffectiveKeys<RoleEntry, Actions extends readonly string[]> =
  Expand<keyof RoleEntry & string, Actions>;

// resolves the check for a concrete permission, preferring an exact key and falling
// back to that resource's wildcard. `Perm` must be naked here for the same reason.
type ResolveCheck<RoleEntry, Perm extends string> =
  Perm extends keyof RoleEntry
    ? RoleEntry[Perm]
    : Perm extends `${infer Res}:${string}`
      ? `${Res}:*` extends keyof RoleEntry
        ? RoleEntry[`${Res}:*`]
        : never
      : never;

export type PermissionsGenerator<
  User extends { role: Roles[number] },
  Roles extends readonly string[],
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> = {
  [UR in Roles[number]]: Partial<{
    [P in PermissionKey<Actions, Resources>]: CheckFor<P, User & { role: UR }, Resources>;
  }>;
};

/**
* Caller's `user` must keep a literal `role` (e.g. `satisfies User`, not `: User`) or
* `can` can't narrow which role's permissions apply. A role can only be asked about a
* permission it actually declared — anything else is a compile error, not an implicit
* deny. A role may declare a `"resource:*"` wildcard to cover every action on that
* resource in one entry; a more specific `"resource:action"` key always overrides the
* wildcard for that action.
*/
export function createCan<
  User extends { role: Roles[number] },
  Roles extends readonly string[],
  Actions extends readonly string[],
  Resources extends Record<string, any>,
  P extends PermissionsGenerator<User, Roles, Actions, Resources>,
>(permissions: P) {
  // number of declared params on a check value (booleans count as 0)
  type ParamCount<T> = T extends (...args: infer PA) => any ? PA["length"] : 0;

  // true if this specific check value's function returns a Promise
  type IsAsync<T> = T extends (...args: any[]) => infer Ret ? (Ret extends Promise<any> ? true : false) : false;

  return function can<R extends Roles[number], Perm extends EffectiveKeys<P[R], Actions>>(
    user: User & { role: R },
    permission: Perm,
    ...args: ParamCount<ResolveCheck<P[R], Perm>> extends 2
      ? [resource: ResourceOf<Perm, Resources>]
      : [resource?: ResourceOf<Perm, Resources>]
  ): IsAsync<ResolveCheck<P[R], Perm>> extends true ? Promise<boolean> : boolean {
    const [resource] = args as [ResourceOf<Perm, Resources>?];
    const table = permissions[user.role] as Record<
      string,
      boolean | ((user: User, resource?: unknown) => boolean | Promise<boolean>)
    >;
    const [resourceKey] = permission.split(":");
    const check = permission in table ? table[permission] : table[`${resourceKey}:*`];

    const result = typeof check === "function" ? check(user, resource) : check;

    return result as IsAsync<ResolveCheck<P[R], Perm>> extends true ? Promise<boolean> : boolean;
  };
}
