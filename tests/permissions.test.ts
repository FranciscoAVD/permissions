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
  post: { model: Post };
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

describe("role hierarchy", () => {
  test("inheritance is transitive across a chain, and an ungranted permission is still a compile error", () => {
    const hRoles = ["viewer", "contributor", "manager"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      viewer: {
        "post:read": true,
      },
      contributor: {
        extends: ["viewer"],
        "post:create": true,
      },
      manager: {
        extends: ["contributor"],
        "post:update": true,
      },
    } satisfies HPermissions;

    const hCan = createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(
      hPermissions
    );

    const manager = { id: "1", name: "Manager", role: "manager" } satisfies HUser;

    expect(hCan(manager, "post:read")).toBe(true); // inherited transitively from viewer
    expect(hCan(manager, "post:create")).toBe(true); // inherited from contributor
    expect(hCan(manager, "post:update")).toBe(true); // manager's own

    // @ts-expect-error nobody in the chain declared "post:delete"
    hCan(manager, "post:delete");
  });

  test("a child can override one inherited action while the rest still falls through", () => {
    const hRoles = ["base", "restricted"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      base: {
        "post:create": true,
        "post:delete": true,
      },
      restricted: {
        extends: ["base"],
        "post:delete": false, // overrides just this one inherited action
      },
    } satisfies HPermissions;

    const hCan = createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(
      hPermissions
    );

    const restricted = { id: "1", name: "Restricted", role: "restricted" } satisfies HUser;

    expect(hCan(restricted, "post:create")).toBe(true); // still inherited from base
    expect(hCan(restricted, "post:delete")).toBe(false); // restricted's own override wins
  });

  test("a wildcard inherits transitively through a chain with no re-declaration in between", () => {
    const hRoles = ["root", "mid", "leaf"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      root: {
        "post:*": true,
      },
      mid: {
        extends: ["root"],
      },
      leaf: {
        extends: ["mid"],
      },
    } satisfies HPermissions;

    const hCan = createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(
      hPermissions
    );

    const leaf = { id: "1", name: "Leaf", role: "leaf" } satisfies HUser;

    expect(hCan(leaf, "post:create")).toBe(true);
    expect(hCan(leaf, "post:read")).toBe(true);
    expect(hCan(leaf, "post:update")).toBe(true);
    expect(hCan(leaf, "post:delete")).toBe(true);
  });

  test("with multiple parents, a later entry in extends overrides an earlier one on the same key", () => {
    const hRoles = ["teamA", "teamB", "combined"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      teamA: {
        "post:update": true,
      },
      teamB: {
        "post:update": false,
      },
      combined: {
        extends: ["teamA", "teamB"], // teamB is listed last, so it wins
      },
    } satisfies HPermissions;

    const hCan = createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(
      hPermissions
    );

    const combined = { id: "1", name: "Combined", role: "combined" } satisfies HUser;

    expect(hCan(combined, "post:update")).toBe(false); // teamB (last-listed) wins over teamA
  });

  test("a role's own key beats every parent regardless of extends order", () => {
    const hRoles = ["teamA", "teamB", "combined"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      teamA: {
        "post:update": true,
      },
      teamB: {
        "post:update": true,
      },
      combined: {
        extends: ["teamB", "teamA"], // teamA listed last, but combined's own key still wins
        "post:update": false,
      },
    } satisfies HPermissions;

    const hCan = createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(
      hPermissions
    );

    const combined = { id: "1", name: "Combined", role: "combined" } satisfies HUser;

    expect(hCan(combined, "post:update")).toBe(false); // own declared value always wins
  });

  test("a cyclic extends graph throws at createCan() construction time", () => {
    const hRoles = ["a", "b"] as const;
    type HUser = { id: string; name: string; role: (typeof hRoles)[number] };
    type HPermissions = PermissionsGenerator<HUser, typeof hRoles, typeof actions, Resources>;

    const hPermissions = {
      a: {
        extends: ["b"],
        "post:read": true,
      },
      b: {
        extends: ["a"],
        "post:create": true,
      },
    } satisfies HPermissions;

    expect(() => {
      createCan<HUser, typeof hRoles, typeof actions, Resources, typeof hPermissions>(hPermissions);
    }).toThrow();
  });
});

describe("per-resource action sets", () => {
  const prRoles = ["admin", "editor"] as const;
  type PRUser = { id: string; name: string; role: (typeof prRoles)[number] };

  type Comment = {
    id: string;
    postID: string;
    authorID: string;
    body: string;
  };

  type PRResources = {
    post: { model: Post; actions: "publish" | "archive" };
    comment: { model: Comment };
  };

  type PRPermissions = PermissionsGenerator<PRUser, typeof prRoles, typeof actions, PRResources>;

  const prPermissions = {
    admin: {
      "post:*": true, // wildcard covers "publish"/"archive" too, not just the global actions
    },
    editor: {
      "post:read": true,
      "post:publish": (user, post) => user.id === post.authorID,
      "comment:read": true,
    },
  } satisfies PRPermissions;

  const prCan = createCan<PRUser, typeof prRoles, typeof actions, PRResources, typeof prPermissions>(
    prPermissions
  );

  const admin = { id: "1", name: "Admin", role: "admin" } satisfies PRUser;
  const editor = { id: "2", name: "Editor", role: "editor" } satisfies PRUser;

  test("a resource-specific action can be granted and checked like any other", () => {
    expect(prCan(editor, "post:publish", post(editor.id))).toBe(true);
    expect(prCan(editor, "post:publish", post("someone-else"))).toBe(false);
  });

  test("a wildcard on the resource covers its extra actions too", () => {
    expect(prCan(admin, "post:publish")).toBe(true);
    expect(prCan(admin, "post:archive")).toBe(true);
  });

  test("a resource-specific action doesn't leak into other resources' key space", () => {
    expect(prCan(editor, "comment:read")).toBe(true);
    // @ts-expect-error "publish" is a post-only action, not a valid comment action
    prCan(editor, "comment:publish");
  });
});
