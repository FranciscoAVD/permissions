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
      [UR in Roles[number]]: ({
        [A in Actions[number]]: ((user: User & { role: UR }, resource: Resources[R]) => boolean) | boolean;
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

  return function can<
    K extends keyof Resources,
    A extends Actions[number],
    R extends Roles[number]
  >(
    user: User & { role: R },
    action: `${K & string}:${A}`,
    ...args: ParamCount<P[K][R][A]> extends 2 ? [resource: Resources[K]] : [resource?: Resources[K]]
  ): boolean {
    const [resource] = args as [Resources[K]?];
    const unformatted = action.split(":");
    const r = unformatted[0] as K;
    const a = unformatted[1] as A;
    const test = permissions[r][user.role];

    return typeof test[a] === "function"
      ? (test[a] as (user: User, resource?: Resources[K]) => boolean)(user, resource)
      : test[a];
  };
}
