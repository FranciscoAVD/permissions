import { describe, test, expect } from "bun:test";
import { createCan, type PermissionsGenerator } from "../index";

const roles = ["admin", "moderator", "user"] as const;
const actions = ["create", "read", "update", "delete"] as const;

type User = {
  id: string;
  name: string;
  role: (typeof roles)[number];
};

type Post = {
  id: string;
  authorID: string;
  body: string;
  createdAt: Date;
};

type Resources = {
  post: Post;
};

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
    "post:update": async (user, post) => {
      await Promise.resolve();
      return user.id === post.authorID;
    },
  },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions
);

const admin = { id: "1", name: "Admin", role: "admin" } satisfies User;
const moderator = { id: "2", name: "Mod", role: "moderator" } satisfies User;
const regularUser = { id: "3", name: "User", role: "user" } satisfies User;

const post = (authorID: string): Post => ({
  id: "p1",
  authorID,
  body: "hello",
  createdAt: new Date(),
});

describe("createCan", () => {
  test("boolean permissions return the declared value, no resource needed", () => {
    expect(can(admin, "post:create")).toBe(true);
    expect(can(admin, "post:read")).toBe(true);
    expect(can(admin, "post:update")).toBe(true);
    expect(can(admin, "post:delete")).toBe(true);
    expect(can(moderator, "post:create")).toBe(true);
    expect(can(regularUser, "post:read")).toBe(true);
  });

  test("moderator can only update their own post", () => {
    expect(can(moderator, "post:update", post(moderator.id))).toBe(true);
    expect(can(moderator, "post:update", post("someone-else"))).toBe(false);
  });

  test("user's async update check resolves to the declared ownership result", async () => {
    await expect(can(regularUser, "post:update", post(regularUser.id))).resolves.toBe(true);
    await expect(can(regularUser, "post:update", post("someone-else"))).resolves.toBe(false);
  });

  test("a role can only be asked about permissions it declared", () => {
    // @ts-expect-error moderator never declared "post:delete"
    can(moderator, "post:delete");
    // @ts-expect-error user never declared "post:create" or "post:delete"
    can(regularUser, "post:delete");
    expect(true).toBe(true);
  });
});

describe("wildcard permissions", () => {
  const wcRoles = ["superadmin", "editor", "owner", "guest"] as const;
  type WCUser = { id: string; name: string; role: (typeof wcRoles)[number] };
  type WCPermissions = PermissionsGenerator<WCUser, typeof wcRoles, typeof actions, Resources>;

  const wcPermissions = {
    superadmin: { "post:*": true },
    editor: { "post:*": true, "post:delete": false },
    owner: { "post:*": (user, post) => user.id === post.authorID },
    guest: { "post:read": true },
  } satisfies WCPermissions;

  const wcCan = createCan<WCUser, typeof wcRoles, typeof actions, Resources, typeof wcPermissions>(
    wcPermissions
  );

  const superadmin = { id: "1", name: "Super", role: "superadmin" } satisfies WCUser;
  const editor = { id: "2", name: "Editor", role: "editor" } satisfies WCUser;
  const owner = { id: "3", name: "Owner", role: "owner" } satisfies WCUser;
  const guest = { id: "4", name: "Guest", role: "guest" } satisfies WCUser;

  test("a role declaring only a wildcard can be asked about every action on that resource, no resource needed", () => {
    expect(wcCan(superadmin, "post:create")).toBe(true);
    expect(wcCan(superadmin, "post:read")).toBe(true);
    expect(wcCan(superadmin, "post:update")).toBe(true);
    expect(wcCan(superadmin, "post:delete")).toBe(true);
  });

  test("a specific key overrides the wildcard for that action; wildcard still covers the rest", () => {
    expect(wcCan(editor, "post:delete")).toBe(false);
    expect(wcCan(editor, "post:create")).toBe(true);
    expect(wcCan(editor, "post:read")).toBe(true);
    expect(wcCan(editor, "post:update")).toBe(true);
  });

  test("a function-valued wildcard requires the resource and resolves per-resource", () => {
    expect(wcCan(owner, "post:update", post(owner.id))).toBe(true);
    expect(wcCan(owner, "post:update", post("someone-else"))).toBe(false);
    expect(wcCan(owner, "post:delete", post(owner.id))).toBe(true);
    expect(wcCan(owner, "post:delete", post("someone-else"))).toBe(false);
  });

  test("a function-valued wildcard is a compile error without a resource, and throws if bypassed at runtime", () => {
    expect(() => {
      // @ts-expect-error function-valued "post:*" requires a resource argument
      wcCan(owner, "post:create");
    }).toThrow();
  });

  test("roles without a wildcard are unaffected — only declared keys are askable", () => {
    expect(wcCan(guest, "post:read")).toBe(true);
    // @ts-expect-error guest never declared "post:create" and has no "post:*"
    wcCan(guest, "post:create");
  });
});
