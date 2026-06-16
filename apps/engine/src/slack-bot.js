import pkg from "@slack/bolt";
const { App } = pkg;
import * as db from "./db.js";
import * as agent from "./incagent-agent.js";
import * as apotrail from "./apotrail-client.js";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// ============================================================
// [1] 事業選択 — /incagent または /business-select で事業一覧を表示
// ============================================================
async function showBusinessMenu(respond) {
  const businesses = await db.getBusinesses();
  // active を先に、preparing を後に並べる
  businesses.sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));

  const businessButtons = businesses.map((b) => {
    const isPreparing = b.status === "preparing";
    return {
      type: "button",
      text: {
        type: "plain_text",
        text: isPreparing ? `${b.name}（準備中）` : b.name,
      },
      value: `select_${b.id}`,
      action_id: `select_${b.id}`,
      ...(isPreparing ? {} : { style: "primary" }),
    };
  });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*🏢 INCAGENT 事業OS メニュー*\n\n事業を選んで回すか、架電状況を確認できます。",
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*① 事業を選んで回す*" },
    },
    {
      type: "actions",
      elements: businessButtons,
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*② 受電状況（本命パン・アポトレール連携）*" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📥 受電履歴" },
          value: "apo_inbound_history",
          action_id: "apo_inbound_history",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📊 受電分析（完結率・人件費削減）" },
          value: "apo_inbound_analysis",
          action_id: "apo_inbound_analysis",
          style: "primary",
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*③ 架電（準備中の事業用・参考）*" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📞 キャンペーン一覧" },
          value: "apo_campaigns",
          action_id: "apo_campaigns",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📋 架電履歴" },
          value: "apo_history",
          action_id: "apo_history",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📊 架電分析" },
          value: "apo_analysis",
          action_id: "apo_analysis",
        },
      ],
    },
  ];

  await respond({ blocks, response_type: "in_channel" });
}

app.command("/business-select", async ({ ack, respond }) => {
  console.log("[1] 事業選択メニュー表示");
  await ack();
  try {
    await showBusinessMenu(respond);
  } catch (error) {
    console.error("Error showing business menu:", error);
    await respond(`エラー: ${error.message}`);
  }
});

app.command("/incagent", async ({ ack, respond }) => {
  console.log("[1] 事業選択メニュー表示");
  await ack();
  try {
    await showBusinessMenu(respond);
  } catch (error) {
    console.error("Error showing business menu:", error);
    await respond(`エラー: ${error.message}`);
  }
});

// ============================================================
// [2]→[3] 事業を選んだ → 計画生成 → 稟議
// ============================================================
app.action(/^select_/, async ({ ack, body, respond }) => {
  await ack();
  const businessId = body.actions[0].action_id.replace("select_", "");
  console.log(`[2] 事業選択: ${businessId} → 計画生成`);

  try {
    // 準備中の事業はブロック（光回線=対個人勧誘の法務確認後に開放）
    const businesses = await db.getBusinesses();
    const biz = businesses.find((b) => b.id === businessId);
    if (biz && biz.status === "preparing") {
      await respond({
        blocks: [{
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*🚧 ${biz.name} は準備中です*\n\nこの事業は対個人の電話勧誘にあたるため、法務確認後に開放します。\n今は *営業代行（toBアポ代行）* で縦1本を回してください。`,
          },
        }],
        response_type: "in_channel",
        replace_original: false,
      });
      return;
    }

    const proposal = await agent.generateProposal(businessId);
    console.log(`[3] 稟議生成完了`);

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📋 稟議: ${proposal.businessName}*\n\n${proposal.summary}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*目標*\n${proposal.goal}` },
          { type: "mrkdwn", text: `*予算*\n¥${proposal.budget.toLocaleString("ja-JP")}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "承認" },
            value: `approve_${businessId}`,
            action_id: `approve_${businessId}`,
            style: "primary",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "却下" },
            value: `reject_${businessId}`,
            action_id: `reject_${businessId}`,
            style: "danger",
          },
        ],
      },
    ];

    await respond({ blocks, response_type: "in_channel", replace_original: true });
  } catch (error) {
    console.error("Error generating proposal:", error);
    await respond(`稟議生成エラー: ${error.message}`);
  }
});

// ============================================================
// [4] 承認 → 実行 → 報告
// ============================================================
app.action(/^approve_/, async ({ ack, body, respond }) => {
  await ack();
  const businessId = body.actions[0].action_id.replace("approve_", "");
  console.log(`[4] 承認 → 実行開始: ${businessId}`);

  try {
    // 承認 = この事業で動く許可。次は実際の架電（アポトレール連携）へ誘導。
    const text = `*✅ 承認しました*\n\nこの事業で動く許可が出ました。次のステップ:\n\n` +
      `1️⃣ アポトレールに架電リスト(CSV)をアップロード\n` +
      `2️⃣ \`/business-select\` → *▶️ 架電開始* でキャンペーンを選んで架電\n` +
      `3️⃣ *📋 架電履歴* / *📊 架電分析* で結果を確認\n\n` +
      `※架電は実際に電話がかかり、クレジットを消費します。`;

    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      response_type: "in_channel",
      replace_original: true,
    });
  } catch (error) {
    console.error("Error in approve action:", error);
    await respond(`エラー: ${error.message}`);
  }
});

// ============================================================
// 📞 キャンペーン一覧（アポトレール連携）
// ============================================================
app.action("apo_campaigns", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] キャンペーン一覧取得");
  try {
    const campaigns = await apotrail.getCampaigns();
    let text = "*📞 キャンペーン一覧（アポトレール）*\n\n";
    if (!campaigns.length) {
      text += "キャンペーンがありません。アポトレール側でリストをアップロードしてください。";
    } else {
      for (const c of campaigns.slice(0, 15)) {
        text += `• *${c.name || c.id}*　状態: ${c.status || "不明"}\n`;
      }
    }
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_campaigns:", error);
    await respond(`キャンペーン取得エラー: ${error.message}`);
  }
});

// ============================================================
// ▶️ 架電開始（キャンペーンを選んで auto-start）
// ============================================================
app.action("apo_callstart", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] 架電開始 — キャンペーン選択");
  try {
    const campaigns = await apotrail.getCampaigns();
    const startable = campaigns.filter((c) => c.status !== "running").slice(0, 10);

    if (!startable.length) {
      await respond(`開始できるキャンペーンがありません。先にアポトレールでリストをアップロードしてください。`);
      return;
    }

    const buttons = startable.map((c) => ({
      type: "button",
      text: { type: "plain_text", text: `▶️ ${(c.name || c.id).slice(0, 20)}` },
      value: `start_${c.id}`,
      action_id: `start_${c.id}`,
      style: "primary",
    }));

    await respond({
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "*▶️ どのキャンペーンを架電開始しますか？*\n（実際に電話がかかります）" } },
        { type: "actions", elements: buttons },
      ],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_callstart:", error);
    await respond(`架電開始エラー: ${error.message}`);
  }
});

// 架電開始の実行（キャンペーンボタン押下）
app.action(/^start_/, async ({ ack, body, respond }) => {
  await ack();
  const campaignId = body.actions[0].action_id.replace("start_", "");
  console.log(`[アポトレール] 架電開始: ${campaignId}`);
  try {
    await apotrail.autoStartCampaign(campaignId);
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `*✅ 架電を開始しました*\nキャンペーン: ${campaignId}\n\nアポトレールが自動架電中です。「📋 架電履歴」で結果を確認できます。` } }],
      response_type: "in_channel",
      replace_original: true,
    });
  } catch (error) {
    console.error("Error start campaign:", error);
    await respond(`架電開始エラー: ${error.message}`);
  }
});

// ============================================================
// 📥 受電履歴（本命パン・direction=inbound）
// ============================================================
app.action("apo_inbound_history", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] 受電履歴取得");
  try {
    const logs = await apotrail.getInboundLogs(20);
    let text = "*📥 受電履歴（アポトレール・直近20件）*\n\n";
    if (!logs.length) {
      text += "まだ受電履歴がありません。";
    } else {
      const labels = { inquiry: "問い合わせ対応✅", callback: "折り返し約束", rejected: "断り", voicemail: "留守電", no_answer: "応答なし" };
      for (const l of logs) {
        const when = l.started_at ? new Date(l.started_at).toLocaleString("ja-JP") : "";
        const r = labels[l.result] || l.result || "記録";
        text += `• ${when}　→ ${r}\n`;
      }
    }
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } }],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_inbound_history:", error);
    await respond(`受電履歴エラー: ${error.message}`);
  }
});

// ============================================================
// 📊 受電分析（完結率・人件費削減効果）
// ============================================================
app.action("apo_inbound_analysis", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] 受電分析");
  try {
    const logs = await apotrail.getInboundLogs(200);
    const analysis = agent.analyzeInboundLogs(logs);
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: analysis } }],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_inbound_analysis:", error);
    await respond(`受電分析エラー: ${error.message}`);
  }
});

// ============================================================
// 📋 架電履歴（アポトレール連携）
// ============================================================
app.action("apo_history", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] 架電履歴取得");
  try {
    const logs = await apotrail.getCallLogs(20);
    let text = "*📋 架電履歴（アポトレール・直近20件）*\n\n";
    if (!logs.length) {
      text += "まだ架電履歴がありません。";
    } else {
      for (const l of logs) {
        const when = l.started_at ? new Date(l.started_at).toLocaleString("ja-JP") : "";
        const result = l.gate_result || l.result || "記録";
        const phone = l.phone || l.to_number || "";
        text += `• ${when}　${phone}　→ ${result}\n`;
      }
    }
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } }],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_history:", error);
    await respond(`履歴取得エラー: ${error.message}`);
  }
});

// ============================================================
// 📊 架電分析（受付突破→突破後内訳の階段構造）
// ============================================================
app.action("apo_analysis", async ({ ack, respond }) => {
  await ack();
  console.log("[アポトレール] 架電分析");
  try {
    const logs = await apotrail.getCallLogs(200);
    const analysis = agent.analyzeCallLogs(logs);
    await respond({
      blocks: [{ type: "section", text: { type: "mrkdwn", text: analysis } }],
      response_type: "in_channel",
    });
  } catch (error) {
    console.error("Error apo_analysis:", error);
    await respond(`分析エラー: ${error.message}`);
  }
});

// 却下
app.action(/^reject_/, async ({ ack, respond }) => {
  await ack();
  console.log("却下");
  await respond({ text: "提案を却下しました", replace_original: true });
});

export default app;
