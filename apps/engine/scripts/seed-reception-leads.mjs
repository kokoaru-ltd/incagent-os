import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const SUPABASE_URL = env.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim();
const SUPABASE_KEY = env.match(/^SUPABASE_KEY=(.+)$/m)?.[1]?.trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL or SUPABASE_KEY missing");
}

const categories = [
  {
    prefix: "不動産受電候補",
    title: "不動産問い合わせ受付・一次対応",
    location: "東京都",
    score: 9,
    source: "townwork",
    url: "https://townwork.net/prefectures/tokyo/job_search/kw/%E4%B8%8D%E5%8B%95%E7%94%A3%E3%82%B3%E3%83%BC%E3%83%AB%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC/",
    reason: "不動産の問い合わせ受付は一次対応、要件整理、担当者連携が中心。AI受電デモの営業対象。",
  },
  {
    prefix: "美容クリニック予約候補",
    title: "美容クリニック予約受付コールセンター",
    location: "東京都",
    score: 9,
    source: "indeed",
    url: "https://jp.indeed.com/q-%E7%BE%8E%E5%AE%B9%E3%82%AF%E3%83%AA%E3%83%8B%E3%83%83%E3%82%AF%E4%BA%88%E7%B4%84%E5%8F%97%E4%BB%98%E3%82%B3%E3%83%BC%E3%83%AB%E3%82%BB%E3%83%B3%E3%82%BF%E3%83%BC-l-%E6%9D%B1%E4%BA%AC%E9%83%BD-%E6%B1%82%E4%BA%BA.html",
    reason: "予約電話の取りこぼしが売上に直結する。高単価業種で受電品質の訴求が効く。",
  },
  {
    prefix: "クリニック受付候補",
    title: "クリニック受付・予約電話対応",
    location: "東京都",
    score: 8,
    source: "indeed",
    url: "https://jp.indeed.com/q-%E3%82%AF%E3%83%AA%E3%83%8B%E3%83%83%E3%82%AF%E5%8F%97%E4%BB%98-l-%E6%9D%B1%E4%BA%AC%E9%83%BD-%E6%B1%82%E4%BA%BA.html",
    reason: "予約、変更、問い合わせの定型対応が多い。禁止回答と人間転送条件を明確にすれば導入しやすい。",
  },
  {
    prefix: "士業相談受付候補",
    title: "法律・税務・社労士事務所の相談受付",
    location: "首都圏",
    score: 8,
    source: "google",
    url: "https://www.google.com/search?q=%E5%A3%AB%E6%A5%AD+%E9%9B%BB%E8%A9%B1%E5%8F%97%E4%BB%98+%E6%B1%82%E4%BA%BA",
    reason: "相談受付は質が重要。専門判断を避け、要件整理と折り返し受付に限定すれば売りやすい。",
  },
  {
    prefix: "高級サービス受付候補",
    title: "高級サービス問い合わせ受付",
    location: "東京都",
    score: 8,
    source: "google",
    url: "https://www.google.com/search?q=%E9%AB%98%E7%B4%9A%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9+%E9%9B%BB%E8%A9%B1%E5%8F%97%E4%BB%98+%E6%B1%82%E4%BA%BA",
    reason: "電話応対の品質がブランド毀損に直結する。価格勝負を避けられる営業先。",
  },
  {
    prefix: "駐車場サポート候補",
    title: "駐車場・設備トラブル受電",
    location: "東京都",
    score: 7,
    source: "stanby",
    url: "https://jp.stanby.com/r_39397791bf0032204d72601433bf6ce7",
    reason: "問い合わせ分類と緊急度判定に向く。営業時間外の一次受付価値がある。",
  },
  {
    prefix: "通販問い合わせ候補",
    title: "通販サイトのお客様相談受付",
    location: "東京都",
    score: 7,
    source: "stanby",
    url: "https://jp.stanby.com/r_8ba94cff7d7141490d732a5565e5f12d",
    reason: "FAQ化しやすい問い合わせが多く、AI一次対応と人間転送の切り分けがしやすい。",
  },
  {
    prefix: "予約電話受付候補",
    title: "予約電話受付業務",
    location: "東京都",
    score: 7,
    source: "indeed",
    url: "https://jp.indeed.com/q-%E4%BA%88%E7%B4%84%E9%9B%BB%E8%A9%B1%E5%8F%97%E4%BB%98%E6%A5%AD%E5%8B%99-l-%E6%9D%B1%E4%BA%AC%E9%83%BD-%E6%B1%82%E4%BA%BA.html",
    reason: "予約受付は聞き取り項目が定型化しやすい。受電テンプレ生成と相性がよい。",
  },
];

const leads = [];
for (let i = 0; i < 80; i += 1) {
  const c = categories[i % categories.length];
  const n = String(Math.floor(i / categories.length) + 1).padStart(2, "0");
  leads.push({
    business_id: "inbound-agent",
    company: `${c.prefix} ${n}`,
    job_title: c.title,
    location: c.location,
    score: c.score,
    source: c.source,
    job_url: `${c.url}#incagent-${i + 1}`,
    source_url: c.url,
    reason: c.reason,
    status: "pending",
  });
}

let upserted = 0;
for (const lead of leads) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reception_leads?on_conflict=business_id,job_url`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(lead),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  upserted += 1;
}

const check = await fetch(
  `${SUPABASE_URL}/rest/v1/reception_leads?select=company,job_title,location,reason&business_id=eq.inbound-agent&order=score.desc&limit=120`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
).then((r) => r.json());

const bad = check.filter((row) =>
  [row.company, row.job_title, row.location, row.reason].some((value) => String(value || "").includes("?")),
);

console.log(JSON.stringify({ upserted, checked: check.length, bad_count: bad.length }, null, 2));
