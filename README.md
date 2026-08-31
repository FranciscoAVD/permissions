# permissions

Type-safe, role-based permission checking generated from your own `User`, `Roles`, `Actions`, and `Resources` types. No schema to keep in sync by hand — the compiler enforces that a resource is passed whenever a role's check actually needs one.

## Install

```bash
bun install permissions
```

## Usage

```ts
import { createCan, type PermissionsGenerator } from "permissions";

const roles = ["admin", "moderator", "user"] as const;
const actions = ["create", "read", "update", "delete"] as const;

type User = { id: string; name: string; role: (typeof roles)[number] };
type Post = { id: string; authorID: string; body: string; createdAt: Date };
type Resources = { post: Post };

type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const permissions = {
  post: {
    admin: { create: true, read: true, update: true, delete: true },
    moderator: {
      create: true,
      read: true,
      update: (user, post) => user.id === post.authorID,
      delete: true,
    },
    user: {
      create: true,
      read: true,
      update: (user, post) => user.id === post.authorID,
      delete: (user, post) => user.id === post.authorID,
    },
  },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions
);

// user must keep a literal `role` (satisfies User, not : User) so `can`
// knows which role's check applies
const user = { id: "1", name: "Ada", role: "user" } satisfies User;

can(user, "post:create");                 // no resource needed — admin/mod/user all just `true`
can(user, "post:update", somePost);        // resource required — `user` role's check reads it
```

If **any** role's check for a given resource/action needs the resource argument, `can` requires it for every call to that action, unless the caller's `user` carries a literal `role` — in which case the requirement narrows to what that specific role's implementation actually needs.

## Develop

```bash
bun install
bun test
bun run build   # emits dist/index.js + dist/index.d.ts
```
