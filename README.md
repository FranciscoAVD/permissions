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

type User = { id: string; name: string; roles: (typeof roles)[number][] };
type Post = { id: string; authorID: string; body: string; createdAt: Date };
type Resources = { post: { model: Post } };

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

// user must keep a literal `roles` array (satisfies User, not : User) so `can`
// knows which roles' permissions apply
const user = { id: "1", name: "Ada", roles: ["user"] } satisfies User;

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

### Per-resource actions

`Resources` entries are always `{ model: ... }`, and can optionally add an `actions` union for
actions that only make sense on that one resource — they're additive to the global `Actions` union
and don't show up on any other resource's keys:

```ts
type Comment = { id: string; postID: string; authorID: string; body: string };
type Resources = {
  post: { model: Post; actions: "publish" | "archive" };
  comment: { model: Comment };
};

type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const permissions = {
  admin: {
    "post:*": true, // wildcard covers "publish" and "archive" too, not just the global actions
  },
  moderator: {
    "post:read": true,
    "post:publish": (user, post) => user.id === post.authorID,
  },
  user: {},
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions
);

const adminUser = { id: "1", name: "Ada", roles: ["admin"] } satisfies User;
const modUser = { id: "2", name: "Bo", roles: ["moderator"] } satisfies User;
const modsPost: Post = { id: "p1", authorID: "2", body: "hi", createdAt: new Date() };

can(adminUser, "post:publish");            // true — covered by "post:*"
can(modUser, "post:publish", modsPost);    // true — modUser.id ("2") matches modsPost.authorID
can(modUser, "comment:publish");           // compile error — "publish" isn't a comment action
```

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

Inheritance is transitive (`admin` gets `viewer`'s grant through `editor` without redeclaring it), and a cyclic `extends` graph is rejected with a clear error when `createCan()` is called.

A role can list more than one parent. When two parents disagree on the same key, whichever is listed last in `extends` wins — and a role's own keys (including its own wildcard) always win over anything inherited, no matter where that parent sits in `extends`:

```ts
const permissions = {
  teamA: {
    "post:update": true,
  },
  teamB: {
    "post:update": false,
  },
  combined: {
    extends: ["teamA", "teamB"], // teamB is listed last, so it wins
  },
} satisfies Permissions;

can(combined, "post:update"); // false — teamB (last-listed) overrides teamA
```

### Multiple roles per user

`User.roles` is always an array — a user can hold more than one role at once. This is distinct
from role hierarchy above: `extends` is a fixed graph declared per role in the permissions table,
while `roles` is the set of roles a specific user happens to hold, chosen at runtime. A permission
is grantable if **any** held role (or that role's own `extends` ancestors) grants it —
most-permissive-wins, a logical OR, not an override:

```ts
const permissions = {
  support: {
    "post:read": true,
  },
  billing: {
    "post:update": true,
  },
  banned: {
    "post:read": false,
  },
} satisfies Permissions;

const supportBilling = { id: "1", name: "Cam", roles: ["support", "billing"] } satisfies User;
const supportBanned = { id: "2", name: "Dee", roles: ["support", "banned"] } satisfies User;

can(supportBilling, "post:read");   // true — from "support"
can(supportBilling, "post:update"); // true — from "billing"
can(supportBanned, "post:read");    // true — "support" grants it, "banned" denying it doesn't matter
```

Unlike `extends`'s last-listed-wins precedence, the order of `roles` never matters here — whichever
held role is most permissive wins, regardless of array order.

### Composing checks

`and`, `or`, and `not` combine existing check values (exported as `CheckValue<User, Resource>` —
`boolean | (user, resource) => boolean | Promise<boolean>`) into a new one, so a single permission
can be built from more than one condition — including an explicit deny that overrides a broader
grant:

```ts
import { createCan, and, or, not, type PermissionsGenerator } from "@vicstack/permissions";

type Post = { id: string; authorID: string; body: string; createdAt: Date; locked: boolean };
type Resources = { post: { model: Post } };
type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const isOwner = (user: User, post: Post) => user.id === post.authorID;
const isPublished = (user: User, post: Post) => !post.locked;
const isLocked = (user: User, post: Post) => post.locked;

const permissions = {
  moderator: {
    // moderators can delete any post — unless it's locked, which vetoes the grant
    "post:delete": and(true, not(isLocked)),
    "post:read": or(isOwner, isPublished),
  },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions
);

const moderator = { id: "1", name: "Mo", roles: ["moderator"] } satisfies User;
const lockedPost: Post = { id: "p1", authorID: "999", body: "hi", createdAt: new Date(), locked: true };

can(moderator, "post:delete", lockedPost); // false — locked vetoes the grant, even for a moderator
```

`and`/`or`/`not` compose (`and(or(a, b), not(c))` is a valid check value), and can be used anywhere
a check value is expected — including as one held role's contribution to multi-role
most-permissive-wins above. `can()`'s resource argument is required exactly when at least one
composed check actually reads it — `and(true, true)` needs no resource, but `and(true,
not(isLocked))` does, since `isLocked` reads it. When used through `can()`, a combinator's result
type is `Promise<boolean>` (safe to `await` even when everything actually resolves synchronously)
whenever any composed check *could* be async — TypeScript can't rule that out from a check
function's declared return type alone, so a Promise-capable check makes the whole combinator
Promise-typed.

### Auditing checks

`createCan` takes an optional second argument to log every check `can()` makes — or just the
denials:

```ts
const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions,
  {
    logger: {
      onCheck: (event) => {
        console.log(event.user.id, event.permission, event.result);
      },
      when: "deny", // default "always" — logs every check, not just denials
    },
  }
);
```

`onCheck` receives a `CheckEvent<User>` — `{ user, permission, resource, result }` — and the whole
options object is typed `CreateCanOptions<User>`, both exported if you want to name them (e.g. to
type a standalone logger function). `event.user.roles` shows which roles the user held, useful for
reasoning about why a check was denied. Logging is always fire-and-forget: it never blocks or
delays `can()`'s own result, and a throwing or rejecting `onCheck` is swallowed rather than
crashing the check or leaking an unhandled rejection. It reports the aggregate result only, not
which specific held role's check decided it.

## Develop

```bash
bun install
bun run typecheck  # type-checks index.ts AND tests/ -- bun test and bun run build don't
bun test
bun run build       # emits dist/index.js + dist/index.d.ts
```

`bun run build` only type-checks `index.ts` (`tsconfig.build.json` scopes to just that file for a
clean `dist/` output), and `bun test` doesn't type-check at all — it transpiles and runs. A type
error confined to `tests/permissions.test.ts` can pass both and still be broken, so `bun run
typecheck` is the one command that actually covers the whole project; `prepublishOnly` runs it
first for exactly that reason.
