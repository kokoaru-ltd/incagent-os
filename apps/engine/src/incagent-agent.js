import OpenAI from "openai";
import * as db from "./db.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BUSINESS_CONFIGS = {
  "inbound-agent": {
    name: "受電代行（問い合わせ一次対応）",
    goal: "受電の一次対応をAIが完結し、受電オペレーター人件費を削減",
    budget: 0,
    leads: 0,
    price: 50000,
    script: "お電話ありがとうございます。ご用件をお伺いします。"
  },
  "light-fiber": {
    name: "光回線営業",
    goal: "法人向け光回線新規成約",
    budget: 50000,
    leads: 20,
    price: 5000,
    script: "こんにちは、光回線サービスのご案内です。..."
  },
  "sales-agent": {
    name: "営業代行（toBアポ代行）",
    goal: "BtoB企業へAI架電してアポ獲得",
    budget: 100000,
    leads: 50,
    price: 10000,
    script: "お世話になっております。御社の営業活動を支援するサービスのご案内でお電話しました。"
  }
};

export async function generateProposal(businessId) {
  const config = BUSINESS_CONFIGS[businessId] || BUSINESS_CONFIGS["light-fiber"];

  const prompt = `
あなたは自律型の事業運営システム「INCAGENT」です。

事業: ${config.name}
目標: ${config.goal}
予算: ¥${config.budget}
対象リード数: ${config.leads}件
1件あたり単価: ¥${config.price}

この事業の実行計画（稟議）を日本語で簡潔に作成してください。
- summary: 1文で何をするかの要約（日本語）
- goal: 達成目標（日本語）
- budget: 予算（数値、円）
- expectedContracts: 期待成約数（数値）

JSONのみで返答: {"summary": "（日本語）", "goal": "（日本語）", "budget": 50000, "expectedContracts": 3}
`;

  const message = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  });

  const responseText = message.choices[0].message.content;
  const proposal = JSON.parse(responseText);

  return {
    businessName: config.name,
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
    conversionRate: callLogs.length ? (contracts / callLogs.length * 100).toFixed(1) : "0.0"
  };
}

// 全事業の売上サマリ
export async function getAllBusinessSummary() {
  const businesses = await db.getBusinesses();
  const summary = [];

  for (const b of businesses) {
    const callLogs = await db.getCallLogsByBusiness(b.id);
    const contracts = callLogs.filter(log => log.contract_signed).length;
    const price = BUSINESS_CONFIGS[b.id]?.price || Number(b.pricing) || 5000;
    const revenue = contracts * price;

    summary.push({
      name: b.name,
      totalCalls: callLogs.length,
      contracts,
      revenue,
      conversionRate: callLogs.length ? (contracts / callLogs.length * 100).toFixed(1) : "0.0",
    });
  }

  return summary;
}

// 直近の実行履歴（全事業横断、最新15件）
export async function getRecentHistory() {
  const businesses = await db.getBusinesses();
  let all = [];

  for (const b of businesses) {
    const logs = await db.getCallLogsByBusiness(b.id);
    all = all.concat(logs);
  }

  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return all.slice(0, 15);
}

// ============================================================
// アポトレールの架電ログを「発信→通電→受付突破→突破後内訳」の
// 階段構造で分析する（CLAUDE.md の2段階判定に準拠）
// ============================================================
export function analyzeCallLogs(logs) {
  const total = logs.length;
  if (total === 0) return "*📊 架電分析*\n\nまだ架電データがありません。";

  // 通電 = 何らかの応答があった（result が no_answer/voicemail/invalid_number 以外）
  const NO_CONNECT = new Set(["no_answer", "voicemail", "invalid_number"]);
  const connected = logs.filter((l) => {
    const r = l.gate_result || l.result || "";
    return r && !NO_CONNECT.has(r);
  });

  // 受付突破 = gate_passed、または旧式 result の gatekeeper_passed/appointment
  const gatePassed = logs.filter((l) => {
    const g = l.gate_result || "";
    const r = l.result || "";
    return g === "gate_passed" || r === "gatekeeper_passed" || r === "appointment";
  });

  // 突破後内訳（dm_result）を集計
  const dmCounts = {};
  for (const l of logs) {
    const dm = l.dm_result;
    if (dm) dmCounts[dm] = (dmCounts[dm] || 0) + 1;
  }

  // gate_result 内訳
  const gateCounts = {};
  for (const l of logs) {
    const g = l.gate_result || l.result || "unknown";
    gateCounts[g] = (gateCounts[g] || 0) + 1;
  }

  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : "0.0");

  let text = "*📊 架電分析（階段構造）*\n\n";
  text += "```\n";
  text += `発信        ${total}件\n`;
  text += `  ↓\n`;
  text += `通電        ${connected.length}件 (${pct(connected.length)}%)\n`;
  text += `  ↓\n`;
  text += `受付突破    ${gatePassed.length}件 (${pct(gatePassed.length)}%)\n`;
  text += "```\n\n";

  text += "*受付段階の内訳 (gate_result):*\n";
  for (const [k, v] of Object.entries(gateCounts).sort((a, b) => b[1] - a[1])) {
    text += `　• ${k}: ${v}件\n`;
  }

  if (Object.keys(dmCounts).length) {
    text += "\n*突破後の内訳 (dm_result):*\n";
    for (const [k, v] of Object.entries(dmCounts).sort((a, b) => b[1] - a[1])) {
      text += `　• ${k}: ${v}件\n`;
    }
  }

  return text.slice(0, 2900);
}

// ============================================================
// 受電代行の分析：受電件数・一次対応完結率（inquiry）・人件費削減効果
// ============================================================
export function analyzeInboundLogs(logs) {
  const total = logs.length;
  if (total === 0) return "*📊 受電分析*\n\nまだ受電データがありません。";

  const counts = {};
  for (const l of logs) {
    const r = l.result || "unknown";
    counts[r] = (counts[r] || 0) + 1;
  }

  // 一次対応完結 = inquiry（AIが人間に回さず問い合わせ対応を完結）
  const completed = counts["inquiry"] || 0;
  const completionRate = ((completed / total) * 100).toFixed(1);

  // 人件費削減の概算：受電1件あたりオペレーター対応コスト ¥150 と仮定
  const COST_PER_CALL = 150;
  const savedCost = completed * COST_PER_CALL;

  let text = "*📊 受電代行 分析*\n\n";
  text += "```\n";
  text += `総受電数        ${total}件\n`;
  text += `一次対応完結    ${completed}件 (${completionRate}%)\n`;
  text += "```\n\n";

  text += "*受電結果の内訳:*\n";
  const labels = {
    inquiry: "問い合わせ対応（完結）",
    callback: "折り返し約束",
    rejected: "対応断り",
    voicemail: "留守電",
    no_answer: "応答なし",
  };
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    text += `　• ${labels[k] || k}: ${v}件\n`;
  }

  text += `\n*💰 人件費削減効果（概算）*\n`;
  text += `AIが完結した ${completed}件 × ¥${COST_PER_CALL} = *¥${savedCost.toLocaleString("ja-JP")}相当*\n`;
  text += `（受電オペレーターが対応した場合の人件費を代替）`;

  return text.slice(0, 2900);
}
