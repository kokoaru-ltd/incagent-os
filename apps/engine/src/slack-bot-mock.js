import pkg from "@slack/bolt";
const { App } = pkg;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// /business-select light-fiber -> 稟議生成（モック版）
app.command("/business-select", async ({ ack, body, say, client }) => {
  await ack();

  const businessId = body.text.trim() || "light-fiber";
  console.log(`[MOCK] Selected business: ${businessId}`);

  const proposal = {
    summary: "法人向け光回線新規成約キャンペーンを開始します",
    goal: "法人向け光回線の新規成約獲得",
    budget: 50000,
    expectedContracts: 3
  };

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
          text: `*予算*\n¥${proposal.budget.toLocaleString("ja-JP")}`
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

  try {
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
  console.log(`[MOCK] Approved: ${businessId}`);

  // モック実行
  const callsData = [
    { name: "田中社長", company: "ABC商事", outcome: "成約" },
    { name: "佐藤部長", company: "XYZ工業", outcome: "保留" },
    { name: "鈴木課長", company: "123商社", outcome: "成約" },
    { name: "山田営業", company: "DEF通信", outcome: "却下" },
    { name: "中村取締役", company: "GHI商品", outcome: "成約" }
  ];

  let contracts = 0;
  let revenue = 0;

  for (const call of callsData) {
    if (call.outcome === "成約") {
      contracts++;
      revenue += 5000;
    }
  }

  const reportBlocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ 実行完了: 光回線営業*\n\n📊 実行結果:\n架電数: ${callsData.length}件\n成約数: ${contracts}件\n売上: ¥${revenue.toLocaleString("ja-JP")}\n成約率: ${(contracts / callsData.length * 100).toFixed(1)}%`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎯 次のアクション:\n• 成約者へのアフターセールス連絡\n• 未決定顧客へのフォローアップ\n• 次週ターゲット20件の新規生成`
      }
    }
  ];

  try {
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
