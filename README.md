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

### Wildcards

A role can declare `"resource:*"` instead of listing every action on that resource individually. A more specific `"resource:action"` key always overrides the wildcard for that one action — which is also how you express "allow everything except X":

```ts
const permissions = {
  admin: {
    "post:*": true,
  },
  moderator: {
    "post:*": true,
    "post:delete": false, // overrides the wildcard for this one action
  },
  user: {}, // every role still needs an entry — empty means no permissions
} satisfies Permissions;

can(admin, "post:create");     // true  — falls back to "post:*"
can(moderator, "post:delete"); // false — the specific key wins over the wildcard
can(moderator, "post:create"); // true  — falls back to "post:*"
```

Only resource-scoped wildcards (`"post:*"`) are supported — a bare `"*"` spanning every resource is not.

### Role hierarchy

A role's entry can declare `extends: [...]` — an array of other role names — to inherit their grants:

```ts
const permissions = {
  viewer: {
    "post:read": true,
  },
  editor: {
    extends: ["viewer"],
    "post:create": true,
    "post:update": true,
  },
  admin: {
    extends: ["editor"],
    "post:delete": true,
  },
} satisfies Permissions;

can(admin, "post:read");   // true — inherited from viewer via editor
can(admin, "post:create"); // true — inherited from editor
can(admin, "post:delete"); // true — admin's own grant
```

A role's own keys (including its own wildcard) always win over anything inherited, and when multiple parents are listed, later entries override earlier ones on the same key. Inheritance is transitive, and a cyclic `extends` graph is rejected with a clear error when `createCan()` is called.

## Develop

```bash
bun install
bun test
bun run build   # emits dist/index.js + dist/index.d.ts
```
