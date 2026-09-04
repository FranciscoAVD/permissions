import { describe, test, expect } from "bun:test";
import { createCan, and, or, not, type PermissionsGenerator } from "../index";

const roles = ["admin", "moderator", "user"] as const;
const actions = ["create", "read", "update", "delete"] as const;

type User = {
  id: string;
  name: string;
  roles: (typeof roles)[number][];
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

const admin = { id: "1", name: "Admin", roles: ["admin"] } satisfies User;
const moderator = { id: "2", name: "Mod", roles: ["moderator"] } satisfies User;
const regularUser = { id: "3", name: "User", roles: ["user"] } satisfies User;

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
  type WCUser = { id: string; name: string; roles: (typeof wcRoles)[number][] };
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

  const superadmin = { id: "1", name: "Super", roles: ["superadmin"] } satisfies WCUser;
  const editor = { id: "2", name: "Editor", roles: ["editor"] } satisfies WCUser;
  const owner = { id: "3", name: "Owner", roles: ["owner"] } satisfies WCUser;
  const guest = { id: "4", name: "Guest", roles: ["guest"] } satisfies WCUser;

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
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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

    const manager = { id: "1", name: "Manager", roles: ["manager"] } satisfies HUser;

    expect(hCan(manager, "post:read")).toBe(true); // inherited transitively from viewer
    expect(hCan(manager, "post:create")).toBe(true); // inherited from contributor
    expect(hCan(manager, "post:update")).toBe(true); // manager's own

    // @ts-expect-error nobody in the chain declared "post:delete"
    hCan(manager, "post:delete");
  });

  test("a child can override one inherited action while the rest still falls through", () => {
    const hRoles = ["base", "restricted"] as const;
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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

    const restricted = { id: "1", name: "Restricted", roles: ["restricted"] } satisfies HUser;

    expect(hCan(restricted, "post:create")).toBe(true); // still inherited from base
    expect(hCan(restricted, "post:delete")).toBe(false); // restricted's own override wins
  });

  test("a wildcard inherits transitively through a chain with no re-declaration in between", () => {
    const hRoles = ["root", "mid", "leaf"] as const;
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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

    const leaf = { id: "1", name: "Leaf", roles: ["leaf"] } satisfies HUser;

    expect(hCan(leaf, "post:create")).toBe(true);
    expect(hCan(leaf, "post:read")).toBe(true);
    expect(hCan(leaf, "post:update")).toBe(true);
    expect(hCan(leaf, "post:delete")).toBe(true);
  });

  test("with multiple parents, a later entry in extends overrides an earlier one on the same key", () => {
    const hRoles = ["teamA", "teamB", "combined"] as const;
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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

    const combined = { id: "1", name: "Combined", roles: ["combined"] } satisfies HUser;

    expect(hCan(combined, "post:update")).toBe(false); // teamB (last-listed) wins over teamA
  });

  test("a role's own key beats every parent regardless of extends order", () => {
    const hRoles = ["teamA", "teamB", "combined"] as const;
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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

    const combined = { id: "1", name: "Combined", roles: ["combined"] } satisfies HUser;

    expect(hCan(combined, "post:update")).toBe(false); // own declared value always wins
  });

  test("a cyclic extends graph throws at createCan() construction time", () => {
    const hRoles = ["a", "b"] as const;
    type HUser = { id: string; name: string; roles: (typeof hRoles)[number][] };
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
  type PRUser = { id: string; name: string; roles: (typeof prRoles)[number][] };

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

  const admin = { id: "1", name: "Admin", roles: ["admin"] } satisfies PRUser;
  const editor = { id: "2", name: "Editor", roles: ["editor"] } satisfies PRUser;

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

describe("multiple roles per user", () => {
  const mrRoles = ["support", "billing", "banned", "matcher", "auditor"] as const;
  type MRUser = { id: string; name: string; roles: (typeof mrRoles)[number][] };
  type MRPermissions = PermissionsGenerator<MRUser, typeof mrRoles, typeof actions, Resources>;

  const mrPermissions = {
    support: { "post:read": true },
    billing: { "post:update": true },
    banned: { "post:read": false },
    matcher: { "post:read": false }, // always denies on its own
    auditor: {
      "post:read": async (user, post) => {
        await Promise.resolve();
        return user.id === post.authorID;
      },
    },
  } satisfies MRPermissions;

  const mrCan = createCan<MRUser, typeof mrRoles, typeof actions, Resources, typeof mrPermissions>(
    mrPermissions
  );

  test("a user holding two disjoint roles gets the union of both", () => {
    const supportBilling = { id: "1", name: "SB", roles: ["support", "billing"] } satisfies MRUser;
    expect(mrCan(supportBilling, "post:read")).toBe(true);
    expect(mrCan(supportBilling, "post:update")).toBe(true);
  });

  test("most-permissive-wins: any held role granting it is enough, regardless of array order", () => {
    const supportBanned = { id: "2", name: "SBn", roles: ["support", "banned"] } satisfies MRUser;
    const bannedSupport = { id: "2", name: "SBn", roles: ["banned", "support"] } satisfies MRUser;
    expect(mrCan(supportBanned, "post:read")).toBe(true); // support:true beats banned:false
    expect(mrCan(bannedSupport, "post:read")).toBe(true); // order doesn't matter
  });

  test("a permission no held role declares is still a compile error", () => {
    const supportOnly = { id: "3", name: "S", roles: ["support"] } satisfies MRUser;
    // @ts-expect-error "support" never declared "post:update", and holds no other role that does
    mrCan(supportOnly, "post:update");
  });

  test("awaits a still-pending role's async check when no other held role already settled it true", async () => {
    const matcherAuditor = { id: "4", name: "MA", roles: ["matcher", "auditor"] } satisfies MRUser;
    // matcher always denies synchronously; only auditor's async ownership check can grant this
    await expect(mrCan(matcherAuditor, "post:read", post(matcherAuditor.id))).resolves.toBe(true);
    await expect(mrCan(matcherAuditor, "post:read", post("someone-else"))).resolves.toBe(false);
  });
});

describe("composing checks", () => {
  type CCPost = Post & { locked: boolean };

  const lockedPost = (authorID: string): CCPost => ({ ...post(authorID), locked: true });
  const openPost = (authorID: string): CCPost => ({ ...post(authorID), locked: false });

  test("and: grants only when every check grants, and needs no resource when nothing composed reads one", () => {
    const bothTrue = and(true, true);
    const oneFalse = and(true, false);
    expect(bothTrue(admin)).toBe(true);
    expect(oneFalse(admin)).toBe(false);
  });

  test("or: grants when any check grants, and needs no resource when nothing composed reads one", () => {
    const anyTrue = or(false, true);
    const bothFalse = or(false, false);
    expect(anyTrue(admin)).toBe(true);
    expect(bothFalse(admin)).toBe(false);
  });

  test("a combinator's resource argument is required only when a composed check actually reads it", () => {
    const isOwner = (user: User, post: CCPost) => user.id === post.authorID;

    const needsResource = and(true, isOwner); // isOwner is arity 2 -> resource required
    const noResourceNeeded = and(true, true); // both arity-0/1 -> resource not accepted

    expect(needsResource(admin, openPost(admin.id))).toBe(true);
    expect(noResourceNeeded(admin)).toBe(true);
    // @ts-expect-error neither composed check reads a resource, so none is accepted here
    noResourceNeeded(admin, openPost("x")); // extra arg, harmlessly ignored at runtime
    expect(() => {
      // @ts-expect-error isOwner reads the resource, so it's required here
      needsResource(admin);
    }).toThrow();
  });

  test("not: inverts a check", () => {
    const isLocked = (user: User, post: CCPost) => post.locked;
    const isOpen = not(isLocked);
    expect(isOpen(admin, openPost("x"))).toBe(true);
    expect(isOpen(admin, lockedPost("x"))).toBe(false);
  });

  test("explicit deny via and(grant, not(veto)): a broad grant is vetoed for a locked resource", async () => {
    const ccRoles = ["moderator"] as const;
    type CCUser = { id: string; name: string; roles: (typeof ccRoles)[number][] };
    type CCResources = { post: { model: CCPost } };
    type CCPermissions = PermissionsGenerator<CCUser, typeof ccRoles, typeof actions, CCResources>;

    const isLocked = (user: CCUser, post: CCPost) => post.locked;

    const ccPermissions = {
      moderator: {
        "post:delete": and(true, not(isLocked)), // moderators can delete any post, unless locked
      },
    } satisfies CCPermissions;

    const ccCan = createCan<CCUser, typeof ccRoles, typeof actions, CCResources, typeof ccPermissions>(
      ccPermissions
    );

    const moderator = { id: "1", name: "Mod", roles: ["moderator"] } satisfies CCUser;

    // "post:delete" resolves to a combinator composed from a 2-arg check (isLocked), so its
    // declared return type is Promise<boolean> even though this particular check actually
    // resolves synchronously underneath (isLocked is sync) — matches the file's documented
    // async-arity tradeoff. `await` handles either shape; `.resolves` would not, since it
    // requires the value to genuinely be a Promise.
    expect(await ccCan(moderator, "post:delete", openPost("999"))).toBe(true);
    expect(await ccCan(moderator, "post:delete", lockedPost("999"))).toBe(false);
  });

  test("mixes sync and async checks correctly, awaiting only when needed", async () => {
    const asyncOwnership = async (user: User, post: CCPost) => {
      await Promise.resolve();
      return user.id === post.authorID;
    };

    const anded = and(true, asyncOwnership);
    const ored = or(false, asyncOwnership);

    await expect(anded(admin, openPost(admin.id))).resolves.toBe(true);
    await expect(anded(admin, openPost("someone-else"))).resolves.toBe(false);
    await expect(ored(admin, openPost(admin.id))).resolves.toBe(true);
    await expect(ored(admin, openPost("someone-else"))).resolves.toBe(false);
  });

  test("combinators nest: and(or(a, b), not(c))", () => {
    const isOwner = (user: User, post: CCPost) => user.id === post.authorID;
    const isAdmin = (user: User, post: CCPost) => user.id === admin.id;
    const isLocked = (user: User, post: CCPost) => post.locked;

    const check = and(or(isOwner, isAdmin), not(isLocked));

    expect(check(admin, openPost("someone-else"))).toBe(true); // isAdmin true, not locked
    expect(check(admin, lockedPost("someone-else"))).toBe(false); // locked vetoes it
    expect(check(regularUser, openPost(regularUser.id))).toBe(true); // isOwner true, not locked
    expect(check(regularUser, openPost("someone-else"))).toBe(false); // neither owner nor admin
  });
});

describe("audit logging", () => {
  test("logs every check by default, with the correct event fields", () => {
    const events: { user: User; permission: string; resource: unknown; result: boolean }[] = [];
    const loggedCan = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
      permissions,
      {
        logger: {
          onCheck: (event) => {
            events.push(event);
          },
        },
      }
    );
    const someoneElsePost = post("someone-else");

    expect(loggedCan(admin, "post:read")).toBe(true);
    expect(loggedCan(moderator, "post:update", someoneElsePost)).toBe(false);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ user: admin, permission: "post:read", resource: undefined, result: true });
    expect(events[1]).toEqual({
      user: moderator,
      permission: "post:update",
      resource: someoneElsePost,
      result: false,
    });
  });

  test('when: "deny" logs only denials, not grants', () => {
    const denyEvents: { result: boolean }[] = [];
    const denyCan = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
      permissions,
      {
        logger: {
          onCheck: (event) => {
            denyEvents.push(event);
          },
          when: "deny",
        },
      }
    );

    expect(denyCan(admin, "post:read")).toBe(true); // granted -- should not log
    expect(denyCan(moderator, "post:update", post("someone-else"))).toBe(false); // denied -- should log

    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0]?.result).toBe(false);
  });

  test("a throwing onCheck doesn't crash or affect a synchronous check's result", () => {
    const throwingCan = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
      permissions,
      {
        logger: {
          onCheck: () => {
            throw new Error("boom");
          },
        },
      }
    );

    expect(throwingCan(admin, "post:read")).toBe(true);
  });

  test("a rejecting async onCheck doesn't crash or affect a check's result, sync or async", async () => {
    const rejectingCan = createCan<User, typeof roles, typeof actions, Resources, typeof permissions>(
      permissions,
      {
        logger: {
          onCheck: async () => {
            throw new Error("boom-async");
          },
        },
      }
    );

    expect(rejectingCan(admin, "post:read")).toBe(true); // sync check path
    await expect(rejectingCan(regularUser, "post:update", post(regularUser.id))).resolves.toBe(true); // async check path
  });

  test("logs the resolved result of a combinator-derived check", async () => {
    const events: { result: boolean }[] = [];
    const ccRoles = ["moderator"] as const;
    type CCUser = { id: string; name: string; roles: (typeof ccRoles)[number][] };
    type CCPost = Post & { locked: boolean };
    type CCResources = { post: { model: CCPost } };
    type CCPermissions = PermissionsGenerator<CCUser, typeof ccRoles, typeof actions, CCResources>;

    const isLocked = (user: CCUser, post: CCPost) => post.locked;

    const ccPermissions = {
      moderator: {
        "post:delete": and(true, not(isLocked)),
      },
    } satisfies CCPermissions;

    const ccCan = createCan<CCUser, typeof ccRoles, typeof actions, CCResources, typeof ccPermissions>(
      ccPermissions,
      {
        logger: {
          onCheck: (event) => {
            events.push(event);
          },
        },
      }
    );

    const moderator = { id: "1", name: "Mod", roles: ["moderator"] } satisfies CCUser;
    const lockedPost: CCPost = { id: "p1", authorID: "999", body: "hi", createdAt: new Date(), locked: true };

    // "post:delete" here resolves through a combinator, so it's Promise<boolean>-typed even
    // though isLocked is sync -- await handles either shape.
    expect(await ccCan(moderator, "post:delete", lockedPost)).toBe(false); // locked vetoes the grant
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe(false);
  });
});
