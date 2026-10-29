import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { invitationMessages } from "../alfred/messages";
import { getMe } from "../services/auth";
import {
  assertOwner,
  createInvite,
  deleteMember,
  disableMember,
  enableMember,
  listPeople,
  withdrawInvite,
} from "../services/people";
import { enforceRateLimit } from "../services/rateLimit";
import { logger } from "../utils/logger";
import { parseJson } from "../utils/validate";

const InviteBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    /** What to call them; an empty box means no name. */
    name: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .strict();

const nowIso = (c: { var: { auth: { now?: () => number } } }) => new Date((c.var.auth.now ?? Date.now)()).toISOString();

/** Everything here is for the owner only. */
export const peopleRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    await assertOwner(c.var.auth.db, c.var.userId);
    await next();
  })
  .get("/", async (c) => c.json(await listPeople(c.var.auth.db)))
  .post("/invites", async (c) => {
    const { email, name } = await parseJson(c, InviteBody);
    const { db, hmacKey, notifiers, now } = c.var.auth;
    // Each invitation sends an email, so the number a day is limited to protect the sender's quota.
    await enforceRateLimit(db, hmacKey, { bucket: "invite", subject: c.var.userId, limit: 20, windowSeconds: 86_400 }, Math.floor((now ?? Date.now)() / 1000));

    const invite = await createInvite(db, c.var.userId, email, nowIso(c), name);
    const owner = await getMe(db, c.var.userId);
    const message = invitationMessages({ inviterName: owner.displayName, name: invite.name, siteUrl: new URL(c.req.url).origin, now: new Date((now ?? Date.now)()) });
    let emailed = true;
    try {
      await notifiers.sendEmail(email, message.subject, message.text, message.html);
    } catch (error) {
      emailed = false;
      logger.error("invitation_delivery_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    return c.json({ invite, emailed }, 201);
  })
  .delete("/invites/:id", async (c) => {
    await withdrawInvite(c.var.auth.db, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/disable", async (c) => {
    await disableMember(c.var.auth.db, c.var.userId, c.req.param("id"), nowIso(c));
    return c.json(await listPeople(c.var.auth.db));
  })
  .post("/:id/enable", async (c) => {
    await enableMember(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.json(await listPeople(c.var.auth.db));
  })
  .delete("/:id", async (c) => {
    await deleteMember(c.var.auth.db, c.var.userId, c.req.param("id"));
    return c.body(null, 204);
  });
