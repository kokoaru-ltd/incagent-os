// INCAGENT 事業OS — Slack Bot (Supabase Edge Function / Deno)
// 常時稼働・サーバーレス。Slack を HTTP Request URL 方式で受ける。
// 秘密情報は incagent-os の config テーブルから service_role で読む（手動secret設定不要）。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------- config 読込（service_role で config テーブル） ----------
let _config: Record<string, string> | null = null;
async function loadConfig(): Promise<Record<string, string>> {
  if (_config) return _config;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/config?select=key,value`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  const rows = await res.json();
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  _config = cfg;
  return cfg;
}

// ---------- 事業一覧（incagent-os businesses テーブル） ----------
async function getBusinesses() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?select=*&order=created_at.asc`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  return await res.json();
}

// ---------- Slack 署名検証 ----------
async function verifySlack(signingSecret: string, sig: string, ts: string, body: string) {
  if (!sig || !ts) return false;
  // リプレイ防止（5分）
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const base = `v0:${ts}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}` === sig;
}

// ---------- アポトレール本番ログイン → トークン ----------
async function apotrailToken(cfg: Record<string, string>): Promise<string> {
  const res = await fetch(
    `${cfg.APOTRAIL_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: cfg.APOTRAIL_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: cfg.APOTRAIL_EMAIL, password: cfg.APOTRAIL_PASSWORD }),
    },
  );
  if (!res.ok) throw new Error(`apotrail login ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function apotrailCallLogs(cfg: Record<string, string>, limit: number, direction?: string) {
  const token = await apotrailToken(cfg);
  const dir = direction ? `&direction=${direction}` : "";
  const res = await fetch(`${cfg.APOTRAIL_BASE_URL}/api/call-logs?limit=${limit}${dir}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`call-logs ${res.status}`);
  const data = await res.json();
  return data.logs || [];
}

// 汎用GET（トークン付き）
async function apotrailGet(cfg: Record<string, string>, path: string) {
  const token = await apotrailToken(cfg);
  const res = await fetch(`${cfg.APOTRAIL_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return await res.json();
}

// 今月のサマリ（受電件数・完結率・人件費削減累計）
function monthlySummary(logs: any[]): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = logs.filter((l) => (l.started_at || "").startsWith(ym));
  const total = month.length;
  const completed = month.filter((l) => l.result === "inquiry").length;
  const rate = total ? ((completed / total) * 100).toFixed(1) : "0.0";
  const saved = completed * 150;
  let t = `*📈 今月のサマリ（${ym}）*\n\n`;
  t += "```\n";
  t += `受電件数        ${total}件\n`;
  t += `一次対応完結    ${completed}件 (${rate}%)\n`;
  t += `人件費削減      ¥${saved.toLocaleString("ja-JP")}相当\n`;
  t += "```\n";
  t += total === 0 ? "\n今月はまだ受電がありません。" : "";
  return t;
}

// 受電設定の表示
function formatSettings(s: any): string {
  const bh = s.business_hours_enabled
    ? `${s.business_hours_start || "?"}〜${s.business_hours_end || "?"}`
    : "終日対応";
  let t = "*⚙️ 受電設定（アポトレール）*\n\n";
  t += `*会社名:* ${s.store_name || "(未設定)"}\n`;
  t += `*受電番号:* ${s.twilioNumber || "(未割当)"}\n`;
  t += `*転送先:* ${s.transfer_number || "(なし)"}\n`;
  t += `*営業時間:* ${bh}\n`;
  t += `*音声:* ${s.voice || "-"} / モデル: ${s.model || "-"}\n`;
  if (s.prompt) t += `\n*対応内容(プロンプト):*\n${String(s.prompt).slice(0, 600)}`;
  return t.slice(0, 2900);
}

// 架電状況（キャンペーン一覧＋架電履歴）
function formatOutbound(campaigns: any[], logs: any[]): string {
  let t = "*📞 架電状況（準備中事業用・参考）*\n\n*キャンペーン:*\n";
  if (!campaigns.length) t += "　なし\n";
  else for (const c of campaigns.slice(0, 8)) t += `　• ${c.name || c.id}（${c.status || "?"}）\n`;
  t += "\n*直近の架電:*\n";
  if (!logs.length) t += "　なし";
  else for (const l of logs.slice(0, 8)) {
    const w = l.started_at ? new Date(l.started_at).toLocaleString("ja-JP") : "";
    t += `　• ${w} → ${l.gate_result || l.result || "記録"}\n`;
  }
  return t.slice(0, 2900);
}

// ---------- 受電履歴 詳細版（CRM的に1件ずつ） ----------
function inboundHistoryBlocks(logs: any[]): any[] {
  const labels: Record<string, string> = {
    inquiry: "問い合わせ対応✅", callback: "折り返し約束", rejected: "断り", voicemail: "留守電", no_answer: "応答なし",
  };
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: "*📥 受電履歴（直近10件・詳細）*" } },
    { type: "divider" },
  ];
  if (!logs.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "受電履歴がありません。" } });
    return blocks;
  }
  for (const l of logs.slice(0, 10)) {
    const w = l.started_at ? new Date(l.started_at).toLocaleString("ja-JP") : "";
    const dur = l.duration_seconds ? `${Math.floor(l.duration_seconds / 60)}分${l.duration_seconds % 60}秒` : "-";
    const company = l.company_name || l.contact_name || "不明";
    const phone = l.phone_number || "";
    const result = labels[l.result] || l.result || "記録";
    const summary = l.summary ? String(l.summary).slice(0, 250) : "(要約なし)";
    const rec = l.recording_url ? `\n🎧 <${l.recording_url}|録音を聞く>` : "";
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🕐 ${w}*\n🏢 ${company}　☎️ ${phone}\n結果: *${result}*　⏱️ ${dur}\n📝 ${summary}${rec}` },
    });
    blocks.push({ type: "divider" });
  }
  return blocks.slice(0, 48);
}

// ---------- 受電分析（完結率・人件費削減） ----------
function analyzeInbound(logs: any[]): string {
  const total = logs.length;
  if (!total) return "*📊 受電分析*\n\nまだ受電データがありません。";
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.result || "unknown"] = (counts[l.result || "unknown"] || 0) + 1;
  const completed = counts["inquiry"] || 0;
  const rate = ((completed / total) * 100).toFixed(1);
  const COST = 150;
  const saved = completed * COST;
  const labels: Record<string, string> = {
    inquiry: "問い合わせ対応（完結）", callback: "折り返し約束",
    rejected: "対応断り", voicemail: "留守電", no_answer: "応答なし",
  };
  let t = "*📊 受電代行 分析*\n\n```\n";
  t += `総受電数        ${total}件\n一次対応完結    ${completed}件 (${rate}%)\n` + "```\n\n*内訳:*\n";
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) t += `　• ${labels[k] || k}: ${v}件\n`;
  t += `\n*💰 人件費削減効果（概算）*\nAI完結 ${completed}件 × ¥${COST} = *¥${saved.toLocaleString("ja-JP")}相当*`;
  return t.slice(0, 2900);
}

// ---------- Slack へ応答（response_url） ----------
async function postResponse(url: string, text: string, blocks?: any[]) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "in_channel", ...(blocks ? { blocks } : { text }) }),
  });
}

// ---------- メニュー blocks ----------
async function menuBlocks() {
  const businesses = await getBusinesses();
  businesses.sort((a: any, b: any) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
  const bizButtons = businesses.map((b: any) => ({
    type: "button",
    text: { type: "plain_text", text: b.status === "preparing" ? `${b.name}（準備中）` : b.name },
    action_id: `select_${b.id}`,
    ...(b.status === "active" ? { style: "primary" } : {}),
  }));
  return [
    { type: "section", text: { type: "mrkdwn", text: "*🏢 INCAGENT 事業OS メニュー*" } },
    { type: "section", text: { type: "mrkdwn", text: "*① 事業を選んで回す*" } },
    { type: "actions", elements: bizButtons },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*② 受電状況（本命パン）*" } },
    {
      type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "📥 受電履歴" }, action_id: "apo_inbound_history", style: "primary" },
        { type: "button", text: { type: "plain_text", text: "📊 受電分析" }, action_id: "apo_inbound_analysis", style: "primary" },
        { type: "button", text: { type: "plain_text", text: "📈 今月のサマリ" }, action_id: "apo_summary", style: "primary" },
      ],
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: "*③ 設定・架電*" } },
    {
      type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "⚙️ 受電設定" }, action_id: "apo_settings" },
        { type: "button", text: { type: "plain_text", text: "📞 架電状況" }, action_id: "apo_outbound" },
      ],
    },
  ];
}

// ---------- 各アクション処理（response_url に投げる） ----------
async function handleAction(actionId: string, cfg: Record<string, string>, responseUrl: string) {
  try {
    if (actionId === "apo_inbound_history") {
      const logs = await apotrailCallLogs(cfg, 10, "inbound");
      await postResponse(responseUrl, "", inboundHistoryBlocks(logs));
    } else if (actionId === "apo_inbound_analysis") {
      const logs = await apotrailCallLogs(cfg, 200, "inbound");
      await postResponse(responseUrl, analyzeInbound(logs));
    } else if (actionId === "apo_summary") {
      const logs = await apotrailCallLogs(cfg, 500, "inbound");
      await postResponse(responseUrl, monthlySummary(logs));
    } else if (actionId === "apo_settings") {
      const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
      await postResponse(responseUrl, formatSettings(s));
    } else if (actionId === "apo_outbound") {
      const campaigns = await apotrailGet(cfg, "/api/campaigns");
      const camps = Array.isArray(campaigns) ? campaigns : (campaigns.campaigns || []);
      const logs = await apotrailCallLogs(cfg, 10, "outbound");
      await postResponse(responseUrl, formatOutbound(camps, logs));
    } else if (actionId.startsWith("select_")) {
      const id = actionId.replace("select_", "");
      const businesses = await getBusinesses();
      const biz = businesses.find((b: any) => b.id === id);
      if (biz?.status === "preparing") {
        await postResponse(responseUrl, `🚧 *${biz.name} は準備中です*\n対個人勧誘の法務確認後に開放します。今は *受電代行* で縦1本を回してください。`);
      } else {
        await postResponse(responseUrl, `✅ *${biz?.name || id}* を選択。受電状況は「📥 受電履歴 / 📊 受電分析」で確認できます。`);
      }
    } else {
      await postResponse(responseUrl, `未対応のアクション: ${actionId}`);
    }
  } catch (e) {
    await postResponse(responseUrl, `エラー: ${(e as Error).message}`);
  }
}

// ---------- エントリ ----------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("INCAGENT Slack endpoint", { status: 200 });

  const cfg = await loadConfig();
  const body = await req.text();
  const sig = req.headers.get("x-slack-signature") || "";
  const ts = req.headers.get("x-slack-request-timestamp") || "";

  if (!(await verifySlack(cfg.SLACK_SIGNING_SECRET, sig, ts, body))) {
    return new Response("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(body);

  // slash command（/business-select）
  if (params.get("command")) {
    const blocks = await menuBlocks();
    return new Response(JSON.stringify({ response_type: "in_channel", blocks }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // interactivity（ボタン押下）
  const payloadStr = params.get("payload");
  if (payloadStr) {
    const payload = JSON.parse(payloadStr);
    const action = payload.actions?.[0];
    const responseUrl = payload.response_url;
    if (action && responseUrl) {
      // 3秒制限回避：即ack、処理は裏で response_url に投げる
      (globalThis as any).EdgeRuntime?.waitUntil(handleAction(action.action_id, cfg, responseUrl));
      if (!(globalThis as any).EdgeRuntime) {
        await handleAction(action.action_id, cfg, responseUrl);
      }
    }
    return new Response("", { status: 200 });
  }

  return new Response("ok", { status: 200 });
});
