# permissions

Type-safe, role-based permission checking generated from your own `User`, `Roles`, `Actions`, and `Resources` types. Each role declares exactly the `"resource:action"` permissions it has — nothing more — so asking whether a role can do something it never declared is a compile error, not a runtime `false`.

## Install

```bash
bun install @vicstack/permissions
```

## Usage

```ts
import { createCan, type PermissionsGenerator } from "@vicstack/permissions";

const roles = ["admin", "moderator", "user"] as const;
const actions = ["create", "read", "update", "delete"] as const;

type User = { id: string; name: string; role: (typeof roles)[number] };
type Post = { id: string; authorID: string; body: string; createdAt: Date };
type Resources = { post: Post };

type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const permissions = {
  admin: {
    "post:create": true,
    "post:read": true,
    "post:update": true,
    "post:delete": true,
  },
  moderator: {
    "post:create": true,
    "post:read": true,
    "post:update": (user, post) => user.id === post.authorID,
  },
  user: {
    "post:read": true,
    "post:update": (user, post) => user.id === post.authorID,
  },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions
);

// user must keep a literal `role` (satisfies User, not : User) so `can`
// knows which role's permissions apply
const user = { id: "1", name: "Ada", role: "user" } satisfies User;

const ownPost: Post = { id: "p1", authorID: "1", body: "hi", createdAt: new Date() };
const othersPost: Post = { id: "p2", authorID: "999", body: "hi", createdAt: new Date() };

can(user, "post:read");                 // true — no resource needed
can(user, "post:update", ownPost);      // true — user.id ("1") matches ownPost.authorID
can(user, "post:update", othersPost);   // false — user.id doesn't match othersPost.authorID
can(user, "post:delete");               // compile error — `user` never declared "post:delete"
```

A permission's check can be a plain `boolean` or a `(user, resource) => boolean | Promise<boolean>` function — `can`'s resource argument is required exactly when that role's specific check actually reads it, and its return type is `Promise<boolean>` exactly when that check is async. Roles are never forced to enumerate permissions they don't have (there's no need to write a `false` entry for every action a role lacks), but each role's set of callable permissions is fixed at the type level — nothing is implicitly allowed by a typo, and nothing is implicitly denied by a `can()` call that shouldn't type-check in the first place.

## Develop

```bash
bun install
bun test
bun run build   # emits dist/index.js + dist/index.d.ts
```
