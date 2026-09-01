export type PermissionKey<
  Actions extends readonly string[],
  Resources extends Record<string, any>,
> = `${Extract<keyof Resources, string>}:${Actions[number]}`;

type CheckFor<P extends string, User, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}`
    ? K extends keyof Resources
      ? boolean | ((user: User, resource: Resources[K]) => boolean | Promise<boolean>)
      : never
    : never;

type ResourceOf<P extends string, Resources extends Record<string, any>> =
  P extends `${infer K}:${string}` ? (K extends keyof Resources ? Resources[K] : never) : never;

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
* deny.
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

  return function can<R extends Roles[number], Perm extends keyof P[R] & string>(
    user: User & { role: R },
    permission: Perm,
    ...args: ParamCount<P[R][Perm]> extends 2
      ? [resource: ResourceOf<Perm, Resources>]
      : [resource?: ResourceOf<Perm, Resources>]
  ): IsAsync<P[R][Perm]> extends true ? Promise<boolean> : boolean {
    const [resource] = args as [ResourceOf<Perm, Resources>?];
    const table = permissions[user.role] as Record<
      string,
      boolean | ((user: User, resource?: unknown) => boolean | Promise<boolean>)
    >;
    const check = table[permission];

    const result = typeof check === "function" ? check(user, resource) : check;

    return result as IsAsync<P[R][Perm]> extends true ? Promise<boolean> : boolean;
  };
}
