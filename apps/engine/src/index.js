import "dotenv/config.js";

const port = process.env.PORT || 3000;

(async () => {
  try {
    let app;

    if (process.env.OPENAI_API_KEY) {
      console.log("⚡️ Starting with OpenAI API...");
      const slackBotModule = await import("./slack-bot.js");
      app = slackBotModule.default;
    } else {
      console.log("⚠️  OPENAI_API_KEY not set. Running in MOCK mode (Slack only)");
      const slackBotMockModule = await import("./slack-bot-mock.js");
      app = slackBotMockModule.default;
    }

    await app.start(port);
    console.log(`⚡️ INCAGENT Engine started on port ${port}`);
  } catch (error) {
    console.error("Failed to start app:", error);
    process.exit(1);
  }
})();
