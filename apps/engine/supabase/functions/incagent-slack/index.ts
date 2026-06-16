// INCAGENT 事業OS — Slack Bot (Supabase Edge Function / Deno)
// 常時稼働・サーバーレス。Slack を HTTP Request URL 方式で受ける。
// 秘密情報は incagent-os の config テーブルから service_role で読む（手動secret設定不要）。
// 機能: slash command / interactivity(ボタン) / App Home(リッチメニュー) / CSV出力

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------- config 読込 ----------
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

async function getBusinesses() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/businesses?select=*&order=created_at.asc`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  return await res.json();
}

async function getReceptionLeads(limit = 5) {
  const params = new URLSearchParams({
    select: "id,company,job_title,job_url,source,source_url,phone,location,score,status,reason,created_at",
    status: "eq.pending",
    order: "score.desc,created_at.desc",
    limit: String(limit),
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reception_leads?${params.toString()}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) return [];
  return await res.json();
}

async function getReceptionLead(id: string) {
  const params = new URLSearchParams({
    select: "id,company,job_title,job_url,source,source_url,phone,location,score,status,reason,created_at",
    id: `eq.${id}`,
    limit: "1",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reception_leads?${params.toString()}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0] || null;
}

async function verifySlack(signingSecret: string, sig: string, ts: string, body: string) {
  if (!sig || !ts) return false;
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

async function apotrailToken(cfg: Record<string, string>): Promise<string> {
  const res = await fetch(`${cfg.APOTRAIL_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.APOTRAIL_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: cfg.APOTRAIL_EMAIL, password: cfg.APOTRAIL_PASSWORD }),
  });
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

async function apotrailGet(cfg: Record<string, string>, path: string) {
  const token = await apotrailToken(cfg);
  const res = await fetch(`${cfg.APOTRAIL_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return await res.json();
}

// ---------- CSV出力（Storage公開バケットに置いてURL返す） ----------
function toCsv(logs: any[]): string {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["日時", "会社名", "電話番号", "相手名", "通話時間(秒)", "結果", "要約", "録音URL", "消費クレジット"];
  const rows = logs.map((l) => [
    l.started_at || "", l.company_name || "", l.phone_number || "", l.contact_name || "",
    l.duration_seconds ?? "", l.result || "", (l.summary || "").replace(/\n/g, " "),
    l.recording_url || "", l.credits_consumed ?? "",
  ].map(esc).join(","));
  return "﻿" + [header.map(esc).join(","), ...rows].join("\r\n");
}

async function uploadCsv(csv: string, filename: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/exports/${filename}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE,
      "Content-Type": "text/csv; charset=utf-8", "x-upsert": "true",
    },
    body: csv,
  });
  if (!res.ok) throw new Error(`storage upload ${res.status}: ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/exports/${filename}`;
}

// ---------- 各種フォーマット ----------
function monthlySummary(logs: any[]): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = logs.filter((l) => (l.started_at || "").startsWith(ym));
  const total = month.length;
  const completed = month.filter((l) => l.result === "inquiry").length;
  const rate = total ? ((completed / total) * 100).toFixed(1) : "0.0";
  const saved = completed * 150;
  let t = `*📈 今月のサマリ（${ym}）*\n\n` + "```\n";
  t += `受電件数        ${total}件\n一次対応完結    ${completed}件 (${rate}%)\n人件費削減      ¥${saved.toLocaleString("ja-JP")}相当\n` + "```\n";
  t += total === 0 ? "\n今月はまだ受電がありません。" : "";
  return t;
}

function formatSettings(s: any): string {
  const bh = s.business_hours_enabled ? `${s.business_hours_start || "?"}〜${s.business_hours_end || "?"}` : "終日対応";
  let t = "*⚙️ 受電設定（アポトレール）*\n\n";
  t += `*会社名:* ${s.store_name || "(未設定)"}\n*受電番号:* ${s.twilioNumber || "(未割当)"}\n`;
  t += `*転送先:* ${s.transfer_number || "(なし)"}\n*営業時間:* ${bh}\n`;
  t += `*音声:* ${s.voice || "-"} / モデル: ${s.model || "-"}\n`;
  t += `*受電テンプレ:* ${inferTemplateName(s.prompt)}\n`;
  t += "\n受電時に実際に使われる中身は、アポトレールの `incoming_settings.prompt` です。";
  if (s.prompt) t += `\n\n*現在の受電プロンプト:*\n${String(s.prompt).slice(0, 800)}`;
  else t += "\n\n*現在の受電プロンプト:* 未設定。まず「標準受付テンプレ」を初期値にしてください。";
  return t.slice(0, 2900);
}

function inferTemplateName(prompt?: string): string {
  const p = String(prompt || "");
  if (!p) return "未設定";
  if (p.includes("予約") || p.includes("日時")) return "予約受付テンプレ";
  if (p.includes("士業") || p.includes("相談") || p.includes("不動産")) return "高単価相談テンプレ";
  if (p.includes("折り返し") || p.includes("要件")) return "標準受付テンプレ";
  return "カスタムテンプレ";
}

function templateDefaults(): string {
  return [
    "*🧩 利用できる受電テンプレ*",
    "",
    "*登録済みテンプレ: 3個*",
    "*本番使用中テンプレ: 1個*（`incoming_settings.prompt`）",
    "",
    "*1. 標準受付テンプレ（初期値）*",
    "会社名、名前、電話番号、用件、折り返し希望を聞き取り、答えられない内容は転送または折り返しに回す。",
    "",
    "*2. 予約受付テンプレ*",
    "予約希望日、人数、メニュー、初回/再訪、連絡先を聞き取り、空き確認が必要な場合は折り返しにする。",
    "",
    "*3. 高単価相談テンプレ（不動産・士業・医療など）*",
    "相談内容、緊急度、希望日時、連絡先を丁寧に聞き取り、専門判断や金額回答は人間へ渡す。",
    "",
    "この3つは型です。本番で実際に使うテンプレは `incoming_settings.prompt` に保存されている1つです。",
  ].join("\n");
}

function currentTemplateText(s: any): string {
  return [
    "*🧩 本番で使っている受電テンプレ*",
    "",
    `*本番テンプレ:* ${inferTemplateName(s.prompt)}`,
    "*保存場所:* `incoming_settings.prompt`",
    "*本番テンプレ数:* 1個",
    "*利用できる型:* 3個（標準受付 / 予約受付 / 高単価相談）",
    "",
    `*受電番号:* ${s.twilioNumber || "(未割当)"}`,
    `*会社名:* ${s.store_name || "(未設定)"}`,
    "",
    "AI受電はテンプレ名ではなく、下のprompt本文で動きます。",
    "",
    s.prompt ? `*prompt:*\n${String(s.prompt).slice(0, 1200)}` : "*prompt:* 未設定",
  ].join("\n").slice(0, 2900);
}

function templateHowToText(): string {
  return [
    "*🧩 テンプレを書かせる方法*",
    "",
    "Slackでこう投げてください。",
    "",
    "`テンプレ作って 業種=歯科 目的=予約受付 必ず聞く=名前,電話番号,希望日時,症状 転送条件=痛みが強い,クレーム,料金相談 禁止=診断,料金確約`",
    "",
    "*指定すると精度が上がる項目*",
    "• 業種",
    "• 目的（予約受付 / 問い合わせ一次対応 / 折り返し受付）",
    "• 最初の名乗り",
    "• 必ず聞く項目",
    "• AIが答えてよい範囲",
    "• 禁止する回答",
    "• 人間へ転送/折り返しする条件",
    "",
    "返すのは下書きです。本番反映は誤爆防止のため自動ではしません。",
  ].join("\n");
}

function templateInventoryText(s: any): string {
  return [
    "*🧩 受電テンプレ一覧*",
    "",
    "*本番使用中: 1個*",
    `• ${inferTemplateName(s.prompt)} → \`incoming_settings.prompt\``,
    "",
    "*利用できる型: 3個*",
    "1. 標準受付テンプレ",
    "2. 予約受付テンプレ",
    "3. 高単価相談テンプレ",
    "",
    "*次にできること*",
    "`受電テンプレ` → 本番promptを見る",
    "`テンプレ一覧` → この一覧を見る",
    "`テンプレ作って ...` → 指定内容で下書きを作る",
    "`テンプレ書き方` → 指定方法を見る",
  ].join("\n");
}

async function draftReceptionTemplate(spec: string): Promise<string> {
  const cleanSpec = spec.replace(/<@[A-Z0-9]+>/g, "").replace(/テンプレ(を)?(作って|書いて|生成して|作成して)/g, "").trim();
  const fallback = [
    "*🧩 受電テンプレ下書き*",
    "",
    "あなたは受付担当です。落ち着いた丁寧な口調で対応してください。",
    "",
    "*最初の名乗り*",
    "お電話ありがとうございます。AI受付です。ご用件をお伺いします。",
    "",
    "*必ず聞く項目*",
    "1. お名前",
    "2. 会社名または団体名",
    "3. 折り返し可能な電話番号",
    "4. ご用件",
    "5. 希望日時や緊急度",
    "",
    "*答えてよい範囲*",
    "営業時間、受付可能な内容、折り返し予定、一般的な案内。",
    "",
    "*答えてはいけない範囲*",
    "料金の確約、専門判断、法務・医療判断、契約条件の確定、クレームへの断定回答。",
    "",
    "*人間へ回す条件*",
    "緊急、クレーム、料金相談、専門判断が必要、予約確定が必要、相手が人間対応を希望。",
    "",
    `*指定内容メモ*\n${cleanSpec || "(指定なし)"}`,
  ].join("\n");

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return fallback.slice(0, 2900);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "あなたは日本の小規模事業者向けAI受電テンプレを書く実務担当。誇大表現を避け、AIが答えてよい範囲/禁止範囲/人間へ回す条件を明確にしたSlack向けMarkdownだけを返す。",
          },
          {
            role: "user",
            content: `次の指定でAI受電テンプレを作成。必ず「最初の名乗り」「必ず聞く項目」「答えてよい範囲」「答えてはいけない範囲」「人間へ回す条件」「本番prompt」を含める。\n\n${cleanSpec || "標準受付テンプレ"}`,
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    return String(text || fallback).slice(0, 2900);
  } catch {
    return fallback.slice(0, 2900);
  }
}

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

function isReceptionBusiness(id: string, biz?: any): boolean {
  const haystack = `${id} ${biz?.name || ""} ${biz?.description || ""}`.toLowerCase();
  return haystack.includes("inbound") || haystack.includes("受電") || haystack.includes("受付");
}

function receptionSearchLinks(): string {
  const q = encodeURIComponent("電話受付 受電 オペレーター 受付スタッフ");
  const qBiz = encodeURIComponent("電話受付 受電 オペレーター 自社 クリニック 不動産 士業");
  return [
    "*🔎 受電代行の案件/営業先を探す入口*",
    "",
    "*最優先: 求人=ニーズ顕在*",
    `• <https://jp.indeed.com/jobs?q=${q}|Indeed: 電話受付/受電オペレーター>`,
    `• <https://www.google.com/search?q=${qBiz}|Google: 自社受電募集の事業会社>`,
    "",
    "*受託案件サイト*",
    `• <https://crowdworks.jp/public/jobs/search?search%5Bkeywords%5D=${encodeURIComponent("電話受付 受電 受付代行")}|クラウドワークス: 電話受付/受電>`,
    `• <https://www.lancers.jp/work/search?keyword=${encodeURIComponent("電話受付 受電 受付代行")}|ランサーズ: 電話受付/受電>`,
    `• <https://coconala.com/search?keyword=${encodeURIComponent("電話受付 受電 受付代行")}|ココナラ: 受付代行>`,
    "",
    "当面はIndeed/求人から直接営業が一番筋がいいです。求人を出している時点で、人件費を払う意思と受電課題が見えています。",
  ].join("\n");
}

function receptionOutreachDraft(lead?: any): string {
  const company = lead?.company || "御社";
  const jobTitle = lead?.job_title ? `「${lead.job_title}」` : "電話受付/受電対応";
  return [
    "*✉️ 受電代行 営業文面下書き*",
    "",
    `件名: ${company}の${jobTitle}をAI受電で一部代替できるか、デモを作らせてください`,
    "",
    `${company} ご担当者様`,
    "",
    "求人を拝見しました。電話受付/問い合わせ一次対応の採用を進められているようでしたのでご連絡しました。",
    "",
    "弊社では、050番号を置くだけでAIが一次受電し、要件整理・折り返し受付・必要時の担当者転送まで行う仕組みを提供しています。",
    "人を1名採用する前に、御社の実際の受付内容でAI受電デモを作り、録音で確認いただけます。",
    "",
    "もし合わなければそこで終了で構いません。採用コストや受付人件費の一部を置き換えられるかだけ、5分で確認いただけます。",
    "",
    "デモ作成に必要なのは、受付でよく聞かれる内容と、折り返し先の条件だけです。",
    "",
    "ご興味あれば、御社向けの受電デモを1本作ってお送りします。",
    "",
    "合同会社ココアル 近藤",
  ].join("\n");
}

function receptionLeadBlocks(leads: any[]): any[] {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "📥 受電代行: 求人リード" } },
    { type: "section", text: { type: "mrkdwn", text: leads.length ? `DB内の候補 ${leads.length}件を表示します。` : "DB内に求人リードがまだありません。まず検索入口から拾ってDB投入します。" } },
    { type: "divider" },
  ];

  if (!leads.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: receptionSearchLinks() } });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: receptionOutreachDraft() } });
    blocks.push(backActions());
    return blocks;
  }

  for (const lead of leads) {
    const title = [lead.company, lead.job_title].filter(Boolean).join(" / ");
    const url = lead.job_url || lead.source_url || "";
    const line = [
      `*${title || "名称未設定"}*`,
      `score: ${lead.score ?? 0} / source: ${lead.source || "-"}`,
      lead.location ? `地域: ${lead.location}` : "",
      lead.phone ? `電話: ${lead.phone}` : "",
      lead.reason ? `理由: ${String(lead.reason).slice(0, 180)}` : "",
      url ? `<${url}|求人を見る>` : "",
    ].filter(Boolean).join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: line } });
    blocks.push({ type: "actions", elements: [
      btn("✉️ 文面", `reception_outreach_${lead.id}`, "primary"),
      btn("🔎 探す入口", "reception_sources"),
    ] });
    blocks.push({ type: "divider" });
  }

  blocks.push(backActions());
  return blocks.slice(0, 48);
}

async function receptionBusinessBlocks(): Promise<any[]> {
  const leads = await getReceptionLeads(5);
  const blocks = receptionLeadBlocks(leads);
  blocks.splice(1, 0, { type: "section", text: { type: "mrkdwn", text: [
      "*選択された事業: 受電代行*",
      "次にやることは、受電要員を募集している企業を見つけて、AI受電デモを提案することです。",
      "求人がある=人件費を払う意思がある=営業先です。",
    ].join("\n") } });
  return blocks;
}

function inboundHistoryBlocks(logs: any[]): any[] {
  const labels: Record<string, string> = { inquiry: "問い合わせ対応✅", callback: "折り返し約束", rejected: "断り", voicemail: "留守電", no_answer: "応答なし" };
  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: "*📥 受電履歴（直近10件・詳細）*" } },
    { type: "divider" },
  ];
  if (!logs.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "受電履歴がありません。" } });
    blocks.push(backActions());
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
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*🕐 ${w}*\n🏢 ${company}　☎️ ${phone}\n結果: *${result}*　⏱️ ${dur}\n📝 ${summary}${rec}` } });
    blocks.push({ type: "divider" });
  }
  blocks.push(backActions());
  return blocks.slice(0, 48);
}

function analyzeInbound(logs: any[]): string {
  const total = logs.length;
  if (!total) return "*📊 受電分析*\n\nまだ受電データがありません。";
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.result || "unknown"] = (counts[l.result || "unknown"] || 0) + 1;
  const completed = counts["inquiry"] || 0;
  const rate = ((completed / total) * 100).toFixed(1);
  const saved = completed * 150;
  const labels: Record<string, string> = { inquiry: "問い合わせ対応（完結）", callback: "折り返し約束", rejected: "対応断り", voicemail: "留守電", no_answer: "応答なし" };
  let t = "*📊 受電代行 分析*\n\n```\n";
  t += `総受電数        ${total}件\n一次対応完結    ${completed}件 (${rate}%)\n` + "```\n\n*内訳:*\n";
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) t += `　• ${labels[k] || k}: ${v}件\n`;
  t += `\n*💰 人件費削減効果（概算）*\nAI完結 ${completed}件 × ¥150 = *¥${saved.toLocaleString("ja-JP")}相当*`;
  return t.slice(0, 2900);
}

async function postResponse(url: string, text: string, blocks?: any[], replace?: boolean) {
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(replace ? { replace_original: true } : { response_type: "in_channel" }), ...(blocks ? { blocks } : { text }) }),
  });
}

// App Home のボタンは response_url が無いので DM(chat.postMessage)で返す
async function postDM(cfg: Record<string, string>, userId: string, text: string, blocks?: any[]) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: userId, ...(blocks ? { blocks, text: "結果" } : { text }) }),
  });
}

async function postChannel(cfg: Record<string, string>, channel: string, text: string, blocks?: any[], threadTs?: string) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      channel,
      text: text || "INCAGENT",
      ...(blocks ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });
}

// ボタン生成ヘルパー
function btn(text: string, action_id: string, style?: string) {
  return { type: "button", text: { type: "plain_text", text }, action_id, ...(style ? { style } : {}) };
}

function backActions() {
  return { type: "actions", elements: [btn("⬅️ メニューに戻る", "menu_top")] };
}

function resultBlocks(text: string): any[] {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    backActions(),
  ];
}

function homeHelpBlocks(): any[] {
  return [
    { type: "divider" },
    { type: "header", text: { type: "plain_text", text: "最初に見るヘルプ" } },
    { type: "section", text: { type: "mrkdwn", text: [
      "*使い方は2通り*",
      "1. 下のボタンを押す",
      "2. チャンネルかDMで普通に話しかける",
      "",
      "*会話例*",
      "`受電履歴見せて`",
      "`受電分析`",
      "`今月のサマリ`",
      "`受電設定`",
      "`受電テンプレ`",
      "`テンプレ一覧`",
      "`テンプレ書き方`",
      "`テンプレ作って 業種=歯科 目的=予約受付 ...`",
      "`架電状況`",
      "`CSV出力`",
    ].join("\n") } },
    { type: "section", text: { type: "mrkdwn", text: [
      "*チャンネルで使う場合*",
      "1. チャンネルに `@incagentengine` を招待: `/invite @incagentengine`",
      "2. `@incagentengine 受電履歴見せて` のように話す",
      "",
      "*DMで使う場合*",
      "`incagentengine` に直接 `受電履歴` と送る",
    ].join("\n") } },
    { type: "section", text: { type: "mrkdwn", text: [
      "*受電設定で見るもの*",
      "• 050受電番号",
      "• 転送先",
      "• 営業時間",
      "• 音声/モデル",
      "• 使用中の受電テンプレ",
      "",
      "本番で実際に使われる応答内容は `incoming_settings.prompt` です。",
    ].join("\n") } },
    { type: "section", text: { type: "mrkdwn", text: [
      "*受電テンプレの書き方*",
      "`テンプレ作って 業種=... 目的=... 必ず聞く=... 禁止=... 転送条件=...` と投げると下書きを作ります。",
      "",
      "*テンプレの見方*",
      "`テンプレ一覧` で本番使用中1個と利用できる型3個を確認できます。",
    ].join("\n") } },
  ];
}

// ---------- トップメニュー（6つの入口・LINEリッチメニュー風グリッド） ----------
async function menuBlocks() {
  return [
    { type: "header", text: { type: "plain_text", text: "🏢 INCAGENT 事業OS" } },
    { type: "section", text: { type: "mrkdwn", text: "ボタンでも会話でも操作できます。まずは `受電履歴見せて` / `受電テンプレ` / `ヘルプ` と話しかけてください。" } },
    { type: "actions", elements: [
      btn("🏢 事業選択", "menu_business", "primary"),
      btn("📥 受電状況", "menu_inbound", "primary"),
      btn("📤 データ出力", "menu_export", "primary"),
    ] },
    { type: "actions", elements: [
      btn("⚙️ 受電設定", "menu_settings"),
      btn("📞 架電", "menu_outbound"),
      btn("❓ ヘルプ", "menu_help"),
    ] },
    ...homeHelpBlocks(),
  ];
}

// ---------- サブメニュー（入口ごとに細分化・drill-down） ----------
async function subMenuBlocks(cat: string) {
  const back = { type: "actions", elements: [btn("⬅️ メニューに戻る", "menu_top")] };
  if (cat === "inbound") {
    return [
      { type: "header", text: { type: "plain_text", text: "📥 受電状況" } },
      { type: "actions", elements: [
        btn("📥 受電履歴", "apo_inbound_history", "primary"),
        btn("📊 受電分析", "apo_inbound_analysis", "primary"),
        btn("📈 今月のサマリ", "apo_summary", "primary"),
      ] },
      back,
    ];
  }
  if (cat === "export") {
    return [
      { type: "header", text: { type: "plain_text", text: "📤 データ出力" } },
      { type: "section", text: { type: "mrkdwn", text: "CSV/Excel で出力できます。（Notion / Obsidian 連携は準備中）" } },
      { type: "actions", elements: [btn("📄 受電履歴をCSV出力", "apo_export_csv", "primary")] },
      back,
    ];
  }
  if (cat === "business") {
    const businesses = await getBusinesses();
    businesses.sort((a: any, b: any) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
    const bizButtons = businesses.map((b: any) =>
      btn(b.status === "preparing" ? `${b.name}（準備中）` : b.name, `select_${b.id}`, b.status === "active" ? "primary" : undefined));
    return [
      { type: "header", text: { type: "plain_text", text: "🏢 事業選択" } },
      { type: "actions", elements: bizButtons },
      back,
    ];
  }
  if (cat === "settings") {
    return [
      { type: "header", text: { type: "plain_text", text: "⚙️ 受電設定" } },
      { type: "section", text: { type: "mrkdwn", text: "受電番号、転送先、営業時間、受電テンプレを確認します。受電の応答内容は `incoming_settings.prompt` が本番ソースです。" } },
      { type: "actions", elements: [
        btn("⚙️ 受電設定を確認", "apo_settings", "primary"),
        btn("✅ 使用中テンプレ", "apo_template_current"),
        btn("📚 テンプレ一覧", "apo_template_list"),
        btn("✍️ 書き方", "apo_template_howto"),
      ] },
      back,
    ];
  }
  if (cat === "outbound") {
    return [
      { type: "header", text: { type: "plain_text", text: "📞 架電（準備中事業用・参考）" } },
      { type: "actions", elements: [btn("📞 架電状況", "apo_outbound", "primary")] },
      back,
    ];
  }
  // help
  return [
    { type: "header", text: { type: "plain_text", text: "❓ ヘルプ・使い方" } },
    { type: "section", text: { type: "mrkdwn", text: [
      "*INCAGENT 事業OS の使い方*",
      "",
      "*よく使う会話コマンド*",
      "`受電履歴見せて` / `受電分析` / `今月のサマリ` / `受電設定` / `受電テンプレ` / `テンプレ一覧` / `テンプレ書き方` / `テンプレ作って ...` / `架電状況` / `CSV出力`",
      "",
      "*📥 受電状況*",
      "受電履歴、受電分析、今月サマリを見ます。完結率と人件費削減額を見る場所です。",
      "",
      "*📤 データ出力*",
      "受電履歴をCSVで出します。Excelで開けるBOM付きUTF-8です。",
      "",
      "*⚙️ 受電設定*",
      "会社名、050受電番号、転送先、営業時間、音声、使用中テンプレを確認します。受電テンプレの本体は `incoming_settings.prompt` です。",
      "",
      "*🧩 テンプレ作成ルール*",
      "`テンプレ作って 業種=... 目的=... 必ず聞く=... 禁止=... 転送条件=...` と指定します。下書きを返します。本番反映は自動ではしません。",
      "",
      "*📞 架電*",
      "準備中事業の参考表示です。表示後も下の「メニューに戻る」で戻れます。",
      "",
      "`/business-select` でいつでもトップメニューを開けます。",
    ].join("\n") } },
    back,
  ];
}

// ---------- App Home に常設メニューを表示（リッチメニュー） ----------
async function publishHome(cfg: Record<string, string>, userId: string) {
  const blocks = await menuBlocks();
  await fetch("https://slack.com/api/views.publish", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ user_id: userId, view: { type: "home", blocks } }),
  });
}

function normalizeSlackText(text: string): string {
  return String(text || "")
    .replace(/<@[A-Z0-9]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function handleMessageEvent(event: any, cfg: Record<string, string>) {
  if (!event?.channel || event.bot_id || event.subtype) return;

  const text = normalizeSlackText(event.text || "");
  const channel = event.channel;
  const threadTs = event.thread_ts || event.ts;

  if (!text || text === "メニュー" || text.includes("何できる") || text.includes("なにできる")) {
    await postChannel(cfg, channel, "INCAGENTメニュー", await menuBlocks(), threadTs);
    return;
  }

  if (text.includes("ヘルプ") || text.includes("help") || text.includes("使い方")) {
    await postChannel(cfg, channel, "ヘルプ", await subMenuBlocks("help"), threadTs);
    return;
  }

  if (
    text.includes("案件探") ||
    text.includes("求人リード") ||
    text.includes("営業先") ||
    (text.includes("受電") && (text.includes("案件") || text.includes("求人") || text.includes("営業")))
  ) {
    await postChannel(cfg, channel, "受電代行の求人リード", await receptionBusinessBlocks(), threadTs);
    return;
  }

  if (text.includes("営業文") || text.includes("メール文") || text.includes("送信文")) {
    await postChannel(cfg, channel, "受電代行 営業文面", resultBlocks(receptionOutreachDraft()), threadTs);
    return;
  }

  if (text.includes("テンプレ") && (text.includes("作って") || text.includes("書いて") || text.includes("生成") || text.includes("作成"))) {
    await postChannel(cfg, channel, "受電テンプレ下書き", resultBlocks(await draftReceptionTemplate(event.text || "")), threadTs);
    return;
  }

  if (text.includes("テンプレ") && (text.includes("一覧") || text.includes("何個") || text.includes("いくつ") || text.includes("リスト"))) {
    const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
    await postChannel(cfg, channel, "受電テンプレ一覧", resultBlocks(templateInventoryText(s)), threadTs);
    return;
  }

  if (text.includes("テンプレ") && (text.includes("書き方") || text.includes("方法") || text.includes("指定"))) {
    await postChannel(cfg, channel, "受電テンプレの書き方", resultBlocks(templateHowToText()), threadTs);
    return;
  }

  if (text.includes("初期設定") || text.includes("初期テンプレ")) {
    await postChannel(cfg, channel, "受電テンプレ一覧", resultBlocks(templateDefaults()), threadTs);
    return;
  }

  if (text.includes("テンプレ") || text.includes("prompt") || text.includes("プロンプト")) {
    const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
    await postChannel(cfg, channel, "受電テンプレ", resultBlocks(currentTemplateText(s)), threadTs);
    return;
  }

  if (text.includes("受電") && (text.includes("設定") || text.includes("番号") || text.includes("転送"))) {
    const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
    await postChannel(cfg, channel, "受電設定", resultBlocks(formatSettings(s)), threadTs);
    return;
  }

  if (text.includes("受電") && (text.includes("履歴") || text.includes("ログ"))) {
    const logs = await apotrailCallLogs(cfg, 10, "inbound");
    await postChannel(cfg, channel, "受電履歴", inboundHistoryBlocks(logs), threadTs);
    return;
  }

  if (text.includes("受電") && (text.includes("分析") || text.includes("完結") || text.includes("削減"))) {
    const logs = await apotrailCallLogs(cfg, 200, "inbound");
    await postChannel(cfg, channel, "受電分析", resultBlocks(analyzeInbound(logs)), threadTs);
    return;
  }

  if (text.includes("今月") || text.includes("サマリ") || text.includes("summary")) {
    const logs = await apotrailCallLogs(cfg, 500, "inbound");
    await postChannel(cfg, channel, "今月のサマリ", resultBlocks(monthlySummary(logs)), threadTs);
    return;
  }

  if (text.includes("架電")) {
    const campaigns = await apotrailGet(cfg, "/api/campaigns");
    const camps = Array.isArray(campaigns) ? campaigns : (campaigns.campaigns || []);
    const logs = await apotrailCallLogs(cfg, 10, "outbound");
    await postChannel(cfg, channel, "架電状況", resultBlocks(formatOutbound(camps, logs)), threadTs);
    return;
  }

  if (text.includes("csv") || text.includes("出力") || text.includes("エクスポート")) {
    const logs = await apotrailCallLogs(cfg, 500, "inbound");
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `inbound_${stamp}.csv`;
    const url = await uploadCsv(toCsv(logs), filename);
    await postChannel(cfg, channel, "CSV出力完了", resultBlocks(`*📄 CSV出力完了（受電${logs.length}件）*\n<${url}|📥 ${filename} をダウンロード>`), threadTs);
    return;
  }

  await postChannel(
    cfg,
    channel,
    "INCAGENT",
    resultBlocks("その言い方だと対象が曖昧です。例: `受電履歴見せて` / `架電状況` / `受電テンプレ` / `ヘルプ`"),
    threadTs,
  );
}

// ---------- アクション処理 ----------
async function handleAction(actionId: string, cfg: Record<string, string>, sender: (t: string, b?: any[], replace?: boolean) => Promise<void>) {
  try {
    if (actionId === "menu_top") {
      await sender("", await menuBlocks(), true);
    } else if (actionId.startsWith("menu_")) {
      await sender("", await subMenuBlocks(actionId.replace("menu_", "")), true);
    } else if (actionId === "apo_inbound_history") {
      const logs = await apotrailCallLogs(cfg, 10, "inbound");
      await sender("", inboundHistoryBlocks(logs));
    } else if (actionId === "apo_inbound_analysis") {
      const logs = await apotrailCallLogs(cfg, 200, "inbound");
      await sender("", resultBlocks(analyzeInbound(logs)));
    } else if (actionId === "apo_summary") {
      const logs = await apotrailCallLogs(cfg, 500, "inbound");
      await sender("", resultBlocks(monthlySummary(logs)));
    } else if (actionId === "apo_export_csv") {
      const logs = await apotrailCallLogs(cfg, 500, "inbound");
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      const filename = `inbound_${stamp}.csv`;
      const url = await uploadCsv(toCsv(logs), filename);
      await sender("", resultBlocks(`*📄 CSV出力完了（受電${logs.length}件）*\n<${url}|📥 ${filename} をダウンロード>\n\nExcelでそのまま開けます（BOM付きUTF-8）。`));
    } else if (actionId === "apo_settings") {
      const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
      await sender("", resultBlocks(formatSettings(s)));
    } else if (actionId === "apo_template_defaults") {
      await sender("", resultBlocks(templateDefaults()));
    } else if (actionId === "apo_template_current") {
      const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
      await sender("", resultBlocks(currentTemplateText(s)));
    } else if (actionId === "apo_template_list") {
      const s = await apotrailGet(cfg, "/api/admin/incoming-settings");
      await sender("", resultBlocks(templateInventoryText(s)));
    } else if (actionId === "apo_template_howto") {
      await sender("", resultBlocks(templateHowToText()));
    } else if (actionId === "reception_sources") {
      await sender("", resultBlocks(receptionSearchLinks()));
    } else if (actionId.startsWith("reception_outreach_")) {
      const id = actionId.replace("reception_outreach_", "");
      const lead = await getReceptionLead(id);
      await sender("", resultBlocks(receptionOutreachDraft(lead)));
    } else if (actionId === "apo_outbound") {
      const campaigns = await apotrailGet(cfg, "/api/campaigns");
      const camps = Array.isArray(campaigns) ? campaigns : (campaigns.campaigns || []);
      const logs = await apotrailCallLogs(cfg, 10, "outbound");
      await sender("", resultBlocks(formatOutbound(camps, logs)));
    } else if (actionId.startsWith("select_")) {
      const id = actionId.replace("select_", "");
      const businesses = await getBusinesses();
      const biz = businesses.find((b: any) => b.id === id);
      if (biz?.status === "preparing") {
        await sender("", resultBlocks(`🚧 *${biz.name} は準備中です*\n対個人勧誘の法務確認後に開放します。今は *受電代行* で縦1本を回してください。`));
      } else if (isReceptionBusiness(id, biz)) {
        await sender("", await receptionBusinessBlocks());
      } else {
        await sender("", resultBlocks(`✅ *${biz?.name || id}* を選択。受電状況は「📥 受電履歴 / 📊 受電分析」で確認できます。`));
      }
    } else {
      await sender("", resultBlocks(`未対応のアクション: ${actionId}`));
    }
  } catch (e) {
    await sender("", resultBlocks(`エラー: ${(e as Error).message}`));
  }
}

// ---------- エントリ ----------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("INCAGENT Slack endpoint", { status: 200 });

  const cfg = await loadConfig();
  const body = await req.text();
  const ctype = req.headers.get("content-type") || "";

  // Slack Event Subscriptions URL verification must get the raw challenge back.
  // Supabase should still be deployed with --no-verify-jwt because Slack will not send a Supabase JWT.
  if (ctype.includes("application/json")) {
    try {
      const data = JSON.parse(body);
      if (data.type === "url_verification") {
        return new Response(data.challenge, { headers: { "Content-Type": "text/plain" } });
      }
    } catch {
      // Fall through to signature verification for non-JSON or malformed requests.
    }
  }

  const sig = req.headers.get("x-slack-signature") || "";
  const ts = req.headers.get("x-slack-request-timestamp") || "";
  if (!(await verifySlack(cfg.SLACK_SIGNING_SECRET, sig, ts, body))) {
    return new Response("invalid signature", { status: 401 });
  }

  // Events API（App Home / url_verification）は JSON
  if (ctype.includes("application/json")) {
    const data = JSON.parse(body);
    if (data.type === "event_callback" && data.event?.type === "app_home_opened") {
      const userId = data.event.user;
      (globalThis as any).EdgeRuntime?.waitUntil(publishHome(cfg, userId));
      if (!(globalThis as any).EdgeRuntime) await publishHome(cfg, userId);
      return new Response("", { status: 200 });
    }
    if (data.type === "event_callback" && (data.event?.type === "app_mention" || data.event?.type === "message")) {
      (globalThis as any).EdgeRuntime?.waitUntil(handleMessageEvent(data.event, cfg));
      if (!(globalThis as any).EdgeRuntime) await handleMessageEvent(data.event, cfg);
      return new Response("", { status: 200 });
    }
    return new Response("", { status: 200 });
  }

  // slash command / interactivity は form-urlencoded
  const params = new URLSearchParams(body);

  if (params.get("command")) {
    const blocks = await menuBlocks();
    return new Response(JSON.stringify({ response_type: "in_channel", blocks }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const payloadStr = params.get("payload");
  if (payloadStr) {
    const payload = JSON.parse(payloadStr);
    const action = payload.actions?.[0];
    const responseUrl = payload.response_url;
    const userId = payload.user?.id;
    if (action) {
      // チャンネルのメニュー → response_url。App Home のボタン → DM(chat.postMessage)
      const sender = responseUrl
        ? (t: string, b?: any[], replace?: boolean) => postResponse(responseUrl, t, b, replace)
        : (t: string, b?: any[]) => postDM(cfg, userId, t, b);
      (globalThis as any).EdgeRuntime?.waitUntil(handleAction(action.action_id, cfg, sender));
      if (!(globalThis as any).EdgeRuntime) await handleAction(action.action_id, cfg, sender);
    }
    return new Response("", { status: 200 });
  }

  return new Response("ok", { status: 200 });
});
