import { createPrismaClient, maskedConnectionString, resolveConnectionString } from "./prisma-db.mjs";
import { existsSync, readFileSync } from "node:fs";

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
}

loadDotEnv();

const args = new Set(process.argv.slice(2));
const keepEmailArg = process.argv.find((arg) => arg.startsWith("--keep-email="));
const keepEmail = (keepEmailArg?.split("=").slice(1).join("=") || "admin@example.com").trim().toLowerCase();
const apply = args.has("--apply");
const confirmed = args.has("--i-understand-production-data-will-be-deleted");
const connectionString = resolveConnectionString();
const prisma = createPrismaClient(connectionString);

function logCount(label, value) {
  console.log(`${label}: ${value}`);
}

async function collectPlan(tx) {
  const keepUser = await tx.user.findUnique({ where: { email: keepEmail } });
  if (!keepUser) throw new Error(`User to keep was not found: ${keepEmail}`);
  if (keepUser.role !== "admin") throw new Error(`User to keep is not an administrator: ${keepEmail}`);

  const usersToDelete = await tx.user.findMany({
    where: { id: { not: keepUser.id } },
    select: { id: true, email: true, role: true }
  });
  const userIds = usersToDelete.map((user) => user.id);
  const emails = usersToDelete.map((user) => user.email);
  const certificateIds = userIds.length
    ? (await tx.certificate.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((item) => item.id)
    : [];

  return {
    keepUser,
    usersToDelete,
    userIds,
    emails,
    certificateIds,
    counts: {
      users: usersToDelete.length,
      applications: emails.length ? await tx.courseApplication.count({ where: { email: { in: emails } } }) : 0,
      assignments: userIds.length ? await tx.courseAssignment.count({ where: { userId: { in: userIds } } }) : 0,
      attempts: userIds.length ? await tx.testAttempt.count({ where: { userId: { in: userIds } } }) : 0,
      certificates: userIds.length ? await tx.certificate.count({ where: { userId: { in: userIds } } }) : 0,
      certificateEvents: userIds.length
        ? await tx.certificateEvent.count({
            where: {
              OR: [
                { userId: { in: userIds } },
                { actorUserId: { in: userIds } },
                ...(certificateIds.length ? [{ certificateId: { in: certificateIds } }] : [])
              ]
            }
          })
        : 0,
      notifications: userIds.length || emails.length
        ? await tx.notification.count({
            where: {
              OR: [
                ...(userIds.length ? [{ recipientUserId: { in: userIds } }] : []),
                ...(emails.length ? [{ recipientEmail: { in: emails } }] : [])
              ]
            }
          })
        : 0,
      sessions: userIds.length ? await tx.session.count({ where: { userId: { in: userIds } } }) : 0,
      passwordResetTokens: userIds.length ? await tx.passwordResetToken.count({ where: { userId: { in: userIds } } }) : 0,
      auditEvents: userIds.length || emails.length
        ? await tx.auditEvent.count({
            where: {
              OR: [
                ...(userIds.length ? [{ adminUserId: { in: userIds } }] : []),
                ...(emails.length ? [{ adminEmail: { in: emails } }] : [])
              ]
            }
          })
        : 0
    }
  };
}

async function main() {
  console.log(`DATABASE_URL: ${maskedConnectionString(connectionString)}`);
  console.log(`Keeping administrator: ${keepEmail}`);

  const plan = await prisma.$transaction((tx) => collectPlan(tx));
  for (const [label, value] of Object.entries(plan.counts)) logCount(label, value);

  if (!apply) {
    console.log("Dry run only. Add --apply --i-understand-production-data-will-be-deleted to purge these records.");
    return;
  }
  if (!confirmed) {
    throw new Error("Refusing to delete data without --i-understand-production-data-will-be-deleted.");
  }
  if (!plan.userIds.length) {
    console.log("No non-admin users found. Nothing to purge.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (plan.certificateIds.length || plan.userIds.length) {
      await tx.certificateEvent.deleteMany({
        where: {
          OR: [
            { userId: { in: plan.userIds } },
            { actorUserId: { in: plan.userIds } },
            ...(plan.certificateIds.length ? [{ certificateId: { in: plan.certificateIds } }] : [])
          ]
        }
      });
    }
    if (plan.userIds.length || plan.emails.length) {
      await tx.notification.deleteMany({
        where: {
          OR: [
            { recipientUserId: { in: plan.userIds } },
            { recipientEmail: { in: plan.emails } }
          ]
        }
      });
      await tx.auditEvent.deleteMany({
        where: {
          OR: [
            { adminUserId: { in: plan.userIds } },
            { adminEmail: { in: plan.emails } }
          ]
        }
      });
      await tx.courseApplication.deleteMany({ where: { email: { in: plan.emails } } });
    }
    await tx.user.deleteMany({ where: { id: { in: plan.userIds } } });
  });

  const remaining = await prisma.user.findMany({ select: { email: true, role: true }, orderBy: { email: "asc" } });
  console.log("Purge complete. Remaining users:");
  for (const user of remaining) console.log(`- ${user.email} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
