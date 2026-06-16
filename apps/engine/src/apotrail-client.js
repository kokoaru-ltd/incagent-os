// アポトレール本番の機能を「裏側だけ」使うクライアント。
// 自社アカウントで Supabase Auth ログイン → access_token を取得 →
// その Bearer トークンで apotrail.jp の API を叩く。
// これにより user_id=自社UUID で「自社の事業」としてデータが繋がる。

import { createClient } from "@supabase/supabase-js";

const APOTRAIL_BASE_URL = process.env.APOTRAIL_BASE_URL || "https://apotrail.jp";
const APOTRAIL_SUPABASE_URL = process.env.APOTRAIL_SUPABASE_URL;
const APOTRAIL_SUPABASE_ANON_KEY = process.env.APOTRAIL_SUPABASE_ANON_KEY;
const APOTRAIL_EMAIL = process.env.APOTRAIL_EMAIL;
const APOTRAIL_PASSWORD = process.env.APOTRAIL_PASSWORD;

let _client = null;
let _token = null;
let _tokenExpiresAt = 0;

function getAuthClient() {
  if (!_client) {
    _client = createClient(APOTRAIL_SUPABASE_URL, APOTRAIL_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// 自社アカウントでログインして access_token を取得（5分マージンで再ログイン）
async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiresAt - 5 * 60 * 1000) {
    return _token;
  }

  if (!APOTRAIL_EMAIL || !APOTRAIL_PASSWORD) {
    throw new Error(
      "APOTRAIL_EMAIL / APOTRAIL_PASSWORD が未設定です。.env に自社アカウントのログイン情報を設定してください。"
    );
  }

  const supabase = getAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: APOTRAIL_EMAIL,
    password: APOTRAIL_PASSWORD,
  });
  if (error) throw new Error(`アポトレールログイン失敗: ${error.message}`);

  _token = data.session.access_token;
  _tokenExpiresAt = data.session.expires_at * 1000;
  console.log("[apotrail] ログイン成功、トークン取得");
  return _token;
}

// 共通: 認証付きで apotrail.jp の API を叩く
async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${APOTRAIL_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`apotrail API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ============================================================
// 架電履歴を取得
// GET /api/call-logs → { logs: [...], original_count, filtered_count }
// ============================================================
export async function getCallLogs(limit = 20, direction = null) {
  const dir = direction ? `&direction=${direction}` : "";
  const data = await apiFetch(`/api/call-logs?limit=${limit}${dir}`);
  return data.logs || [];
}

// 受電ログのみ取得（direction=inbound）
export async function getInboundLogs(limit = 50) {
  return getCallLogs(limit, "inbound");
}

// ============================================================
// キャンペーン一覧を取得
// GET /api/campaigns
// ============================================================
export async function getCampaigns() {
  const data = await apiFetch(`/api/campaigns`);
  return Array.isArray(data) ? data : data.campaigns || [];
}

// ============================================================
// 架電リスト(CSV/Excel)をアップロードしてキャンペーン作成
// POST /api/campaigns (multipart: file + name)
// ============================================================
export async function createCampaign(name, fileBuffer, fileName) {
  const token = await getToken();
  const form = new FormData();
  const blob = new Blob([fileBuffer]);
  form.append("file", blob, fileName || "leads.csv");
  form.append("name", name);

  const res = await fetch(`${APOTRAIL_BASE_URL}/api/campaigns`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`キャンペーン作成失敗 ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ============================================================
// 架電開始（自動）
// POST /api/campaigns/:id/auto-start
// ============================================================
export async function autoStartCampaign(campaignId) {
  return apiFetch(`/api/campaigns/${campaignId}/auto-start`, { method: "POST" });
}

// ============================================================
// 架電停止
// POST /api/campaigns/:id/stop
// ============================================================
export async function stopCampaign(campaignId) {
  return apiFetch(`/api/campaigns/${campaignId}/stop`, { method: "POST" });
}

// ============================================================
// 接続テスト（ログインだけ試す）
// ============================================================
export async function testConnection() {
  await getToken();
  return { ok: true };
}
