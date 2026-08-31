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
  post: {
    admin: {
      create: true,
      read: true,
      update: true,
      delete: true,
    },
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
    expect(can(moderator, "post:create")).toBe(true);
    expect(can(regularUser, "post:create")).toBe(true);
  });

  test("read is allowed for every role", () => {
    expect(can(admin, "post:read")).toBe(true);
    expect(can(moderator, "post:read")).toBe(true);
    expect(can(regularUser, "post:read")).toBe(true);
  });

  test("admin can update without providing a resource", () => {
    expect(can(admin, "post:update")).toBe(true);
  });

  test("moderator can only update their own post", () => {
    expect(can(moderator, "post:update", post(moderator.id))).toBe(true);
    expect(can(moderator, "post:update", post("someone-else"))).toBe(false);
  });

  test("moderator has an unconditional delete regardless of authorship", () => {
    expect(can(moderator, "post:delete")).toBe(true);
  });

  test("user can only update their own post", () => {
    expect(can(regularUser, "post:update", post(regularUser.id))).toBe(true);
    expect(can(regularUser, "post:update", post("someone-else"))).toBe(false);
  });

  test("user can only delete their own post", () => {
    expect(can(regularUser, "post:delete", post(regularUser.id))).toBe(true);
    expect(can(regularUser, "post:delete", post("someone-else"))).toBe(false);
  });
});

describe("createCan async checks", () => {
  const asyncPermissions = {
    post: {
      admin: { create: true, read: true, update: true, delete: true },
      moderator: {
        create: true,
        read: true,
        update: async (user, post) => {
          await Promise.resolve();
          return user.id === post.authorID;
        },
        delete: true,
      },
      user: {
        create: true,
        read: true,
        update: async (user, post) => {
          await Promise.resolve();
          return user.id === post.authorID;
        },
        delete: (user, post) => user.id === post.authorID,
      },
    },
  } satisfies Permissions;

  const asyncCan = createCan<
    User,
    typeof roles,
    typeof actions,
    Resources,
    typeof asyncPermissions
  >(asyncPermissions);

  test("sync checks stay synchronous even in a table with async checks elsewhere", () => {
    expect(asyncCan(admin, "post:create")).toBe(true);
  });

  test("async check resolves to the declared ownership result", async () => {
    await expect(asyncCan(regularUser, "post:update", post(regularUser.id))).resolves.toBe(true);
    await expect(asyncCan(regularUser, "post:update", post("someone-else"))).resolves.toBe(false);
  });
});
