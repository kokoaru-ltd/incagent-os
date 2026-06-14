import { App } from "@slack/bolt";
import * as db from "./db.js";
import * as agent from "./incagent-agent.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// /business-select 光回線営業 -> 稟議生成
app.command("/business-select", async ({ ack, body, say, client }) => {
  await ack();

  const businessId = body.text.trim() || "light-fiber";
  console.log(`Selected business: ${businessId}`);

  try {
    const proposal = await agent.generateProposal(businessId);

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*事業OS実行提案*\n\n${proposal.summary}`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*目標*\n${proposal.goal}`
          },
          {
            type: "mrkdwn",
            text: `*予算*\n¥${proposal.budget}`
          }
        ]
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "承認" },
            value: `approve_${businessId}`,
            action_id: `approve_${businessId}`
          },
          {
            type: "button",
            text: { type: "plain_text", text: "却下" },
            value: `reject_${businessId}`,
            action_id: `reject_${businessId}`,
            style: "danger"
          }
        ]
      }
    ];

    await say({ blocks });
  } catch (error) {
    console.error("Error in /business-select:", error);
    await say(`エラーが発生しました: ${error.message}`);
  }
});

// 承認ボタン
app.action(/^approve_/, async ({ ack, body, say, client }) => {
  await ack();

  const businessId = body.actions[0].action_id.replace("approve_", "");
  console.log(`Approved: ${businessId}`);

  try {
    // 実行開始
    const result = await agent.executeBusinessLoop(businessId);

    const reportBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*実行完了: ${businessId}*\n\n${result.report}`
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*成約数*\n${result.contracts}`
          },
          {
            type: "mrkdwn",
            text: `*売上*\n¥${result.revenue}`
          }
        ]
      }
    ];

    await say({ blocks: reportBlocks });
  } catch (error) {
    console.error("Error in approve action:", error);
    await say(`実行エラー: ${error.message}`);
  }
});

// 却下ボタン
app.action(/^reject_/, async ({ ack, body, say }) => {
  await ack();
  await say("提案を却下しました");
});

export default app;
