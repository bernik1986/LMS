const args = process.argv.slice(2);
const option = (name) => args.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const recipientEmail = option("to") || args.find((item) => !item.startsWith("--")) || "";
const delayMs = Number(option("delay") ?? 30000);

if (!recipientEmail) {
  console.error("Usage: npm run email:test:all -- --to=name@example.com [--delay=30000]");
  process.exit(1);
}
if (!Number.isFinite(delayMs) || delayMs < 0) {
  console.error("--delay must be a non-negative number of milliseconds.");
  process.exit(1);
}

process.env.LMS_CLI_MODE = "true";
process.env.SMTP_TLS_REJECT_UNAUTHORIZED = "true";

const { sendNotificationPreviewSuite } = await import("./lms-server.mjs");

function writeProgress(event) {
  if (event.status === "sending") {
    console.log(`[${event.index}/${event.total}] Sending ${event.type}${event.attachmentCount ? ` with ${event.attachmentCount} attachment(s)` : ""}...`);
  } else if (event.status === "sent") {
    console.log(`[${event.index}/${event.total}] Sent ${event.type}.`);
  } else if (event.status === "waiting") {
    console.log(`Waiting ${Math.round(event.delayMs / 1000)} seconds before the next message...`);
  } else if (event.status === "failed") {
    console.error(`[${event.index}/${event.total}] Failed ${event.type}: ${event.error}`);
  }
}

try {
  const results = await sendNotificationPreviewSuite({ recipientEmail, delayMs, onProgress: writeProgress });
  console.log(`Notification preview suite completed: ${results.length}/${results.length} messages accepted by SMTP.`);
} catch (error) {
  console.error(error.message);
  console.error(`Accepted before failure: ${error.results?.length ?? 0}. The suite stopped to avoid repeated SMTP attempts.`);
  process.exitCode = 1;
}
