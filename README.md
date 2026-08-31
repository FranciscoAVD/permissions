# permissions

Type-safe, role-based permission checking generated from your own `User`, `Roles`, `Actions`, and `Resources` types. No schema to keep in sync by hand — the compiler enforces that a resource is passed whenever a role's check actually needs one.

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
  post: {
    admin: true, // shorthand: every action granted, no resource ever required
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

const ownPost: Post = { id: "p1", authorID: "1", body: "hi", createdAt: new Date() };
const othersPost: Post = { id: "p2", authorID: "999", body: "hi", createdAt: new Date() };

can(user, "post:create");               // true — no resource needed, every role just gets `true`
can(user, "post:update", ownPost);      // true — user.id ("1") matches ownPost.authorID
can(user, "post:update", othersPost);   // false — user.id doesn't match othersPost.authorID
```

If **any** role's check for a given resource/action needs the resource argument, `can` requires it for every call to that action, unless the caller's `user` carries a literal `role` — in which case the requirement narrows to what that specific role's implementation actually needs.

A role's entry can also be a plain `boolean` instead of the per-action object — `admin: true` grants every action for that resource with no resource argument ever required, and `admin: false` denies every action the same way. Every role still has to be listed explicitly; nothing is ever allowed or denied by omission.

## Develop

```bash
bun install
bun test
bun run build   # emits dist/index.js + dist/index.d.ts
```
