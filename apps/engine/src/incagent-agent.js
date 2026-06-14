import OpenAI from "openai";
import * as db from "./db.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BUSINESS_CONFIGS = {
  "light-fiber": {
    name: "光回線営業",
    goal: "法人向け光回線新規成約",
    budget: 50000,
    leads: 20,
    price: 5000,
    script: "こんにちは、光回線サービスのご案内です。..."
  },
  "sales-agent": {
    name: "営業代行",
    goal: "営業支援サービス導入",
    budget: 100000,
    leads: 10,
    price: 10000,
    script: "こんにちは、営業代行サービスのご案内です。..."
  }
};

export async function generateProposal(businessId) {
  const config = BUSINESS_CONFIGS[businessId] || BUSINESS_CONFIGS["light-fiber"];

  const prompt = `
You are INCAGENT, an autonomous company operating system.

Business: ${config.name}
Goal: ${config.goal}
Budget: ¥${config.budget}
Target leads: ${config.leads}
Price per contract: ¥${config.price}

Generate a concise business proposal with:
1. Summary (1 sentence)
2. Expected outcome
3. Success metrics

Respond with JSON only: {"summary": "...", "goal": "...", "budget": 50000, "expectedContracts": 3}
`;

  const message = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.choices[0].message.content;
  const proposal = JSON.parse(responseText);

  return {
    summary: proposal.summary || `${config.name}キャンペーンを開始します`,
    goal: proposal.goal || config.goal,
    budget: proposal.budget || config.budget,
    expectedContracts: proposal.expectedContracts || 3
  };
}

export async function executeBusinessLoop(businessId) {
  const config = BUSINESS_CONFIGS[businessId] || BUSINESS_CONFIGS["light-fiber"];

  console.log(`[${businessId}] Starting execution loop...`);

  // ここは最小限：Supabase にログを記録してレポート生成
  // 本来は架電実行だが、最初の形では「実行ログ」を生成するだけ

  const leads = await db.getLeads(businessId, config.leads);
  console.log(`[${businessId}] Found ${leads.length} leads to call`);

  let contracts = 0;
  let revenue = 0;

  // シミュレーション：架電ログを記録
  for (const lead of leads.slice(0, 5)) {
    // 最初は5件だけ
    const outcome = Math.random() > 0.7 ? "converted" : "pending";

    await db.createCallLog(
      businessId,
      lead.id,
      outcome,
      `${config.script}（自動実行）`
    );

    if (outcome === "converted") {
      contracts++;
      revenue += config.price;
      await db.createContract(businessId, lead.id, config.price);
    }
  }

  const report = `
✅ ${config.name} キャンペーン実行完了

📊 結果:
- 架電数: ${leads.length}件
- 成約数: ${contracts}件
- 売上: ¥${revenue.toLocaleString("ja-JP")}

次のアクション:
${contracts > 0 ? "- 成約者へのアフターセールス連絡" : "- さらに20件のリード生成"}
- ROI分析と予算調整
`;

  return {
    report,
    contracts,
    revenue
  };
}

export async function generateReport(businessId) {
  const callLogs = await db.getCallLogsByBusiness(businessId);

  const contracts = callLogs.filter(log => log.contract_signed).length;
  const revenue = contracts * (BUSINESS_CONFIGS[businessId]?.price || 5000);

  return {
    totalCalls: callLogs.length,
    contracts,
    revenue,
    conversionRate: (contracts / callLogs.length * 100).toFixed(1)
  };
}
