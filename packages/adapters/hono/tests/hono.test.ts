import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { createCan, type PermissionsGenerator } from "@vicstack/permissions";
import { guard, authorize } from "../index";

const roles = ["admin", "user"] as const;
const actions = ["create", "read", "update"] as const;

type User = { id: string; name: string; roles: (typeof roles)[number][] };
type Post = { id: string; authorID: string };
type Resources = { post: { model: Post } };
type Permissions = PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const permissions = {
  admin: {
    "post:create": true,
    "post:read": true,
    "post:update": true,
  },
  user: {
    "post:read": true,
    "post:update": (u: User, post: Post) => u.id === post.authorID,
  },
} satisfies Permissions;

const can = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
  permissions,
);

const asyncPermissions = {
  admin: { "post:create": true },
  user: {
    "post:create": async (u: User) => {
      await Promise.resolve();
      return u.name === "eligible";
    },
  },
} satisfies PermissionsGenerator<User, typeof roles, typeof actions, Resources>;

const asyncCan = createCan<
  User,
  typeof roles,
  typeof actions,
  Resources,
  typeof asyncPermissions
>(asyncPermissions);

const owner = { id: "1", name: "Ada", roles: ["user"] } satisfies User;
const stranger = { id: "2", name: "Bo", roles: ["user"] } satisfies User;
const post: Post = { id: "p1", authorID: "1" };

function appWithUser(user: User | undefined) {
  const app = new Hono<{ Variables: { user: User } }>();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  return app;
}

describe("guard", () => {
  test("lets a granted resource-free request through", async () => {
    const app = appWithUser(owner);
    app.get("/posts", guard(can, "post:read"), (c) => c.json({ ok: true }));

    const res = await app.request("/posts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("returns default 403 JSON on denial", async () => {
    const app = appWithUser(stranger);
    app.get("/posts/create", guard(can, "post:create"), (c) => c.json({ ok: true }));

    const res = await app.request("/posts/create");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  test("returns default 403 and never runs the handler when no user is resolvable", async () => {
    const app = appWithUser(undefined);
    let ran = false;
    app.get("/posts", guard(can, "post:read"), (c) => {
      ran = true;
      return c.json({ ok: true });
    });

    const res = await app.request("/posts");
    expect(res.status).toBe(403);
    expect(ran).toBe(false);
  });

  test("resolves a resource-scoped permission via getResource", async () => {
    const posts: Record<string, Post> = { p1: post };
    const app = appWithUser(owner);
    app.patch(
      "/posts/:id",
      guard(can, "post:update", { getResource: (c) => posts[c.req.param("id")!]! }),
      (c) => c.json({ ok: true }),
    );

    const ownRes = await app.request("/posts/p1", { method: "PATCH" });
    expect(ownRes.status).toBe(200);

    const strangerApp = appWithUser(stranger);
    strangerApp.patch(
      "/posts/:id",
      guard(can, "post:update", { getResource: (c) => posts[c.req.param("id")!]! }),
      (c) => c.json({ ok: true }),
    );
    const strangerRes = await strangerApp.request("/posts/p1", { method: "PATCH" });
    expect(strangerRes.status).toBe(403);
  });

  test("honors a getUser override reading a non-default context key", async () => {
    const app = new Hono<{ Variables: { currentUser: User } }>();
    app.use("*", async (c, next) => {
      c.set("currentUser", owner);
      await next();
    });
    app.get(
      "/posts",
      guard(can, "post:read", { getUser: (c) => c.get("currentUser") as User }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/posts");
    expect(res.status).toBe(200);
  });

  test("honors an onDenied override instead of the default 403 shape", async () => {
    const app = appWithUser(stranger);
    app.get(
      "/posts/create",
      guard(can, "post:create", { onDenied: (c) => c.json({ custom: true }, 418) }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/posts/create");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ custom: true });
  });

  test("awaits an async check, both granted and denied", async () => {
    const eligible = { id: "3", name: "eligible", roles: ["user"] } satisfies User;
    const ineligible = { id: "4", name: "nope", roles: ["user"] } satisfies User;

    const grantedApp = appWithUser(eligible);
    grantedApp.get("/posts/create", guard(asyncCan, "post:create"), (c) => c.json({ ok: true }));
    expect((await grantedApp.request("/posts/create")).status).toBe(200);

    const deniedApp = appWithUser(ineligible);
    deniedApp.get("/posts/create", guard(asyncCan, "post:create"), (c) => c.json({ ok: true }));
    expect((await deniedApp.request("/posts/create")).status).toBe(403);
  });

  test("propagates a getResource error instead of treating it as a denial", async () => {
    const app = appWithUser(owner);
    app.onError((err, c) => c.json({ threw: err.message }, 500));
    app.patch(
      "/posts/:id",
      guard(can, "post:update", {
        getResource: () => {
          throw new Error("lookup failed");
        },
      }),
      (c) => c.json({ ok: true }),
    );

    const res = await app.request("/posts/p1", { method: "PATCH" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ threw: "lookup failed" });
  });
});

describe("authorize", () => {
  test("returns true/false for granted and denied checks", async () => {
    const app = new Hono();
    app.get("/check", async (c) => {
      const grantedForOwner = await authorize(c, can, "post:update", {
        getUser: () => owner,
        getResource: () => post,
      });
      const deniedForStranger = await authorize(c, can, "post:update", {
        getUser: () => stranger,
        getResource: () => post,
      });
      return c.json({ grantedForOwner, deniedForStranger });
    });

    const res = await app.request("/check");
    expect(await res.json()).toEqual({ grantedForOwner: true, deniedForStranger: false });
  });

  test("returns false, not a throw, when no user is resolvable", async () => {
    const app = new Hono();
    app.get("/check", async (c) => {
      const granted = await authorize(c, can, "post:read");
      return c.json({ granted });
    });

    const res = await app.request("/check");
    expect(await res.json()).toEqual({ granted: false });
  });
});
