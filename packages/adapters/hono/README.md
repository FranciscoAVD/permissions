# @vicstack/adapters-hono

Hono middleware adapter for [`@vicstack/permissions`](https://www.npmjs.com/package/@vicstack/permissions).

## Install

```bash
bun add @vicstack/adapters-hono hono
```

## Usage

Two exports: `guard`, a middleware factory that guards a whole route behind a permission and
responds with a 403 on denial, and `authorize`, a handler-level helper returning a plain boolean
for checks too dynamic to guard declaratively at the route level. Both take the `can` function
returned by `createCan()` and resolve the current user via `c.get("user")` by default (override
with `options.getUser`), an optional resource via `options.getResource` for resource-scoped
permissions (e.g. loaded from a route param), and let you override the default 403 JSON body via
`options.onDenied`.

```ts
import { Hono } from "hono";
import { createCan, type PermissionsGenerator } from "@vicstack/permissions";
import { guard, authorize } from "@vicstack/adapters-hono";

const roles = ["admin", "moderator", "user"] as const;
const actions = ["create", "read", "update", "delete"] as const;

type User = { id: string; name: string; roles: (typeof roles)[number][] };
type Post = { id: string; authorID: string; body: string; createdAt: Date };
type Resources = { post: { model: Post } };
type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const permissions = {
  admin: { "post:*": true },
  moderator: { "post:read": true, "post:update": (u, p) => u.id === p.authorID },
  user: { "post:read": true, "post:update": (u, p) => u.id === p.authorID },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions,
);

const app = new Hono();

// an earlier auth middleware is expected to have done c.set("user", ...)
app.get("/posts", guard(can, "post:read"), (c) => c.json(listPosts()));

app.patch(
  "/posts/:id",
  guard(can, "post:update", {
    getResource: async (c) => await findPost(c.req.param("id")),
    // onDenied: (c) => { throw new HTTPException(403, { message: "not your post" }); },
  }),
  (c) => c.json(updatePost(c.req.param("id"))),
);

// too dynamic to express as a route guard: check inside the handler and combine with other logic
app.get("/posts/:id/edit-form", async (c) => {
  const post = await findPost(c.req.param("id"));
  const canEdit = await authorize(c, can, "post:update", { getResource: () => post });
  return c.json({ post, canEdit });
});
```

A `getResource` that throws or rejects is not treated as a denial — the error propagates to
Hono's own error handling, since a resource-lookup failure is a distinct failure mode from
"permission denied." `guard` always `await`s the underlying `can()` call, so it works the same way
whether the specific permission's check is sync or async.

## Develop

This package lives in the [`@vicstack/permissions`](https://github.com/FranciscoAVD/permissions)
monorepo, at `packages/adapters/hono`. See the repo root README for monorepo-wide setup.
