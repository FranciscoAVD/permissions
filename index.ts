/**
*  @param User - user interface
*  @param Roles - supported roles
*  @param Actions - supported actions
*  @param Resources - protected resources in the form of Record<string, ResourceType>
*  @param ResourceExcludedActions - actions that don't require a resource check in the form of Record<action extends Actions, Resources[K]> 
*/
export type PermissionsGenerator<
  User extends { role: Roles[number] },
  Roles extends (readonly string[]),
  Actions extends (readonly string[]),
  Resources extends Record<string, any>,
> = {
    [R in keyof Resources]: {
      [UR in Roles[number]]: boolean | ({
        [A in Actions[number]]: ((user: User & { role: UR }, resource: Resources[R]) => boolean | Promise<boolean>) | boolean;
      });
    }
  }

/**
* Caller's `user` must keep a literal `role` (e.g. `satisfies User`, not `: User`) or
* `can` can't narrow which role's implementation applies, and conservatively requires
* a resource whenever any role needs one for that action.
*/
export function createCan<
  User extends { role: Roles[number] },
  Roles extends readonly string[],
  Actions extends readonly string[],
  Resources extends Record<string, any>,
  P extends PermissionsGenerator<User, Roles, Actions, Resources>
>(permissions: P) {
  // number of declared params on a check value (booleans count as 0)
  type ParamCount<T> = T extends (...args: infer PA) => any ? PA["length"] : 0;

  // true if this specific check value's function returns a Promise
  type IsAsync<T> = T extends (...args: any[]) => infer Ret ? (Ret extends Promise<any> ? true : false) : false;

  // resolves the actual check value for a role, unwrapping the role-level boolean
  // shortcut. Entry must be a naked type parameter here (not `P[K][R]` inlined) for
  // the conditional to narrow inside its own branches.
  type CheckValue<Entry, A extends PropertyKey> =
    Entry extends boolean ? Entry : A extends keyof Entry ? Entry[A] : never;

  return function can<
    K extends keyof Resources,
    A extends Actions[number],
    R extends Roles[number]
  >(
    user: User & { role: R },
    action: `${K & string}:${A}`,
    ...args: ParamCount<CheckValue<P[K][R], A>> extends 2 ? [resource: Resources[K]] : [resource?: Resources[K]]
  ): IsAsync<CheckValue<P[K][R], A>> extends true ? Promise<boolean> : boolean {
    const [resource] = args as [Resources[K]?];
    const unformatted = action.split(":");
    const r = unformatted[0] as K;
    const a = unformatted[1] as A;
    const test = permissions[r][user.role];

    if (typeof test === "boolean") {
      return test as unknown as IsAsync<CheckValue<P[K][R], A>> extends true ? Promise<boolean> : boolean;
    }

    // `test` is proven non-boolean by the guard above, but that's a runtime fact TS
    // can't fold back into `P[K][R]` (a deferred generic indexed-access, not a
    // concrete union) — so index through a plain, explicitly-indexable shape instead.
    const checks = test as Record<A, boolean | ((user: User, resource?: Resources[K]) => boolean | Promise<boolean>)>;

    const result = typeof checks[a] === "function"
      ? (checks[a] as (user: User, resource?: Resources[K]) => boolean | Promise<boolean>)(user, resource)
      : checks[a];

    return result as IsAsync<CheckValue<P[K][R], A>> extends true ? Promise<boolean> : boolean;
  };
}
