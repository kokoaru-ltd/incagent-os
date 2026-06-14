import "dotenv/config.js";
import app from "./slack-bot.js";

const port = process.env.PORT || 3000;

(async () => {
  try {
    await app.start(port);
    console.log(`⚡️ INCAGENT Engine started on port ${port}`);
  } catch (error) {
    console.error("Failed to start app:", error);
    process.exit(1);
  }
})();
