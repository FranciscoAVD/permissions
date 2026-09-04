import type { Context, MiddlewareHandler } from "hono";

// loose shape of a `can` function returned by `createCan()` — deliberately not reconstructing
// index.ts's unexported conditional machinery (`ParamCount`, `IsAsync`, `ResolveCheckForRoleSet`,
// etc.), which would risk drifting out of sync with the real logic there. Inferring `Can` from
// the concrete function a caller passes in still lets `Parameters<Can>[1]` narrow `permission` to
// that table's actual valid keys (verified empirically — see PR/commit notes), and
// `Parameters<Can>[0]` gives the real `User` type; only the resource argument's precise
// conditional arity is not preserved through this wrapper.
type AnyCan<User = any> = (
  user: User,
  permission: any,
  ...args: any[]
) => boolean | Promise<boolean>;

export type PermissionsMiddlewareOptions<User, Resource = undefined> = {
  /** Defaults to `c.get("user")`. */
  getUser?: (c: Context) => User | null | undefined | Promise<User | null | undefined>;
  /** Resolves the resource a resource-scoped permission check reads, e.g. from a route param. */
  getResource?: (c: Context) => Resource | Promise<Resource>;
  /** Defaults to a 403 with `{ error: "Forbidden" }`. */
  onDenied?: (c: Context) => Response | Promise<Response>;
};

export type AuthorizeOptions<User, Resource = undefined> = Pick<
  PermissionsMiddlewareOptions<User, Resource>,
  "getUser" | "getResource"
>;

function defaultOnDenied(c: Context): Response {
  return c.json({ error: "Forbidden" }, 403);
}

async function resolveUser<User>(
  c: Context,
  getUser?: PermissionsMiddlewareOptions<User, unknown>["getUser"],
): Promise<User | null | undefined> {
  return getUser ? await getUser(c) : (c.get("user") as User | undefined);
}

/**
 * Hono middleware factory: guards a route behind a permission, responding with `onDenied` (a
 * plain 403 by default) when the user is missing or the check denies. `getResource` is called
 * before `can()` when the permission reads a resource; a rejecting/throwing `getResource` is not
 * treated as a denial and propagates as-is.
 */
export function guard<Can extends AnyCan, Resource = undefined>(
  can: Can,
  permission: Parameters<Can>[1],
  options?: PermissionsMiddlewareOptions<Parameters<Can>[0], Resource>,
): MiddlewareHandler {
  return async (c, next) => {
    const user = await resolveUser<Parameters<Can>[0]>(c, options?.getUser);
    if (user == null) {
      return (options?.onDenied ?? defaultOnDenied)(c);
    }

    const resource = options?.getResource ? await options.getResource(c) : undefined;
    const granted = await Promise.resolve((can as AnyCan)(user, permission, resource));
    if (!granted) {
      return (options?.onDenied ?? defaultOnDenied)(c);
    }

    await next();
  };
}

/**
 * Handler-level counterpart to `guard` for checks too dynamic to express as a route guard —
 * resolves `user`/`resource` the same way, but returns a plain boolean instead of a `Response`.
 * A missing user resolves to `false` rather than throwing.
 */
export async function authorize<Can extends AnyCan, Resource = undefined>(
  c: Context,
  can: Can,
  permission: Parameters<Can>[1],
  options?: AuthorizeOptions<Parameters<Can>[0], Resource>,
): Promise<boolean> {
  const user = await resolveUser<Parameters<Can>[0]>(c, options?.getUser);
  if (user == null) return false;

  const resource = options?.getResource ? await options.getResource(c) : undefined;
  return Promise.resolve((can as AnyCan)(user, permission, resource));
}
