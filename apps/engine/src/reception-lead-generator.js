const RECEPTION_KEYWORDS = [
  "受電",
  "電話受付",
  "電話対応",
  "問い合わせ対応",
  "問合せ対応",
  "予約受付",
  "一次対応",
  "コールセンター",
  "カスタマーサポート",
  "受付スタッフ",
];

const DIRECT_COMPANY_SIGNALS = [
  "自社",
  "自社サービス",
  "自社サイト",
  "自社店舗",
  "当社",
  "弊社",
  "クリニック",
  "医院",
  "歯科",
  "不動産",
  "法律事務所",
  "税理士",
  "行政書士",
  "士業",
  "予約",
  "問い合わせ窓口",
];

const REJECT_KEYWORDS = [
  "派遣",
  "人材派遣",
  "紹介予定派遣",
  "登録制",
  "求人広告",
  "求人媒体",
  "転職エージェント",
  "人材紹介",
  "BPO",
  "アウトソーシング",
  "コールセンター代行",
  "受託",
  "オペレーター派遣",
];

const PHONE_PATTERN = /(?:0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10})/;

export function buildIndeedUrl({ query = "電話受付 受電 オペレーター", location = "" } = {}) {
  const params = new URLSearchParams({ q: query });
  if (location) params.set("l", location);
  return `https://jp.indeed.com/jobs?${params.toString()}`;
}

export async function fetchIndeedHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    },
  });
  if (!res.ok) {
    throw new Error(`Indeed fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

export function parseInputRows(text, sourceUrl = "") {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed);
    const rows = Array.isArray(json) ? json : json.jobs || json.results || [];
    return rows.map(normalizeExternalRow);
  }

  if (trimmed.includes("<html") || trimmed.includes("mosaic-provider-jobcards")) {
    return parseIndeedHtml(trimmed, sourceUrl);
  }

  return parseCsvRows(trimmed).map(normalizeExternalRow);
}

export function parseIndeedHtml(html, sourceUrl = "") {
  const rows = [];
  rows.push(...parseJsonLdJobs(html, sourceUrl));
  rows.push(...parseIndeedMosaicJobs(html, sourceUrl));
  return dedupeRows(rows);
}

export function scoreReceptionLead(row) {
  const haystack = [row.company, row.jobTitle, row.description, row.location, row.jobUrl]
    .join(" ")
    .toLowerCase();
  const matched = RECEPTION_KEYWORDS.filter((word) => haystack.includes(word.toLowerCase()));
  const directSignals = DIRECT_COMPANY_SIGNALS.filter((word) => haystack.includes(word.toLowerCase()));
  const rejects = REJECT_KEYWORDS.filter((word) => haystack.includes(word.toLowerCase()));

  let score = 0;
  score += matched.length * 3;
  score += directSignals.length * 2;
  score += row.company ? 2 : 0;
  score += row.jobUrl ? 1 : 0;
  score -= rejects.length * 5;

  const accepted = score >= 5 && matched.length > 0 && rejects.length === 0;
  const reason = [
    matched.length ? `受電系キーワード: ${matched.join(", ")}` : "受電系キーワードなし",
    directSignals.length ? `自社運用シグナル: ${directSignals.join(", ")}` : "自社運用シグナル弱い",
    rejects.length ? `除外: ${rejects.join(", ")}` : "除外語なし",
    `score=${score}`,
  ].join(" / ");

  return { accepted, score, reason, matched, directSignals, rejects };
}

export function buildReceptionLeads(rows, { limit = 20, minScore = 5 } = {}) {
  const evaluated = dedupeRows(rows)
    .map((row) => {
      const verdict = scoreReceptionLead(row);
      return {
        ...row,
        phone: row.phone || extractPhone(row.description),
        score: verdict.score,
        accepted: verdict.accepted && verdict.score >= minScore,
        reason: verdict.reason,
        matched_keywords: verdict.matched,
        direct_signals: verdict.directSignals,
        reject_keywords: verdict.rejects,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    accepted: evaluated.filter((row) => row.accepted).slice(0, limit),
    rejected: evaluated.filter((row) => !row.accepted),
    evaluated,
  };
}

export function toCsv(rows) {
  const headers = ["company", "jobTitle", "phone", "location", "score", "reason", "jobUrl", "source", "sourceUrl"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

function parseJsonLdJobs(html, sourceUrl) {
  const rows = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const raw = decodeHtml(match[1]).trim();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const item of items) {
        if (item["@type"] !== "JobPosting") continue;
        rows.push(
          normalizeExternalRow({
            source: "indeed",
            sourceUrl,
            company: item.hiringOrganization?.name || "",
            jobTitle: item.title || "",
            jobUrl: item.url || sourceUrl,
            location: normalizeLocation(item.jobLocation),
            description: stripTags(item.description || ""),
          })
        );
      }
    } catch {
      // Ignore non-JSON script blocks.
    }
  }
  return rows;
}

function parseIndeedMosaicJobs(html, sourceUrl) {
  const rows = [];
  const cardPattern =
    /<div[^>]+class=["'][^"']*job_seen_beacon[^"']*["'][\s\S]*?(?=<div[^>]+class=["'][^"']*job_seen_beacon|<\/main>|<\/body>)/gi;
  for (const match of html.matchAll(cardPattern)) {
    const card = match[0];
    const href = firstMatch(card, /href=["']([^"']*\/viewjob\?[^"']+)["']/i);
    const title = attr(card, "aria-label") || textByClass(card, "jobTitle") || textByDataTest(card, "job-title") || "";
    const company = textByDataTest(card, "company-name") || textByClass(card, "companyName") || "";
    const location = textByDataTest(card, "text-location") || textByClass(card, "companyLocation") || "";
    const description = stripTags(card);
    if (!title && !company) continue;
    rows.push(
      normalizeExternalRow({
        source: "indeed",
        sourceUrl,
        company,
        jobTitle: title,
        jobUrl: absolutizeIndeedUrl(href, sourceUrl),
        location,
        description,
      })
    );
  }
  return rows;
}

function parseCsvRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function splitCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += ch;
    }
  }
  values.push(value);
  return values;
}

function normalizeExternalRow(row) {
  return {
    source: row.source || "manual",
    sourceUrl: row.sourceUrl || row.searchUrl || "",
    company: clean(row.company || row.companyName || row.employer || row.hiringOrganization || ""),
    jobTitle: clean(row.jobTitle || row.title || row.position || ""),
    jobUrl: clean(row.jobUrl || row.url || row.link || ""),
    location: clean(row.location || row.area || ""),
    description: clean(row.description || row.summary || row.notes || ""),
    phone: clean(row.phone || row.tel || ""),
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows.map(normalizeExternalRow)) {
    const key = `${row.company}|${row.jobTitle}|${row.jobUrl}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function normalizeLocation(location) {
  if (!location) return "";
  if (Array.isArray(location)) {
    return location.map(normalizeLocation).filter(Boolean).join(" / ");
  }
  if (typeof location === "object") {
    return clean([location.address?.addressRegion, location.address?.addressLocality, location.address?.streetAddress].filter(Boolean).join(" "));
  }
  return clean(String(location));
}

function textByClass(html, className) {
  const re = new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return clean(stripTags(firstMatch(html, re)));
}

function textByDataTest(html, testId) {
  const re = new RegExp(`<[^>]+data-testid=["']${testId}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return clean(stripTags(firstMatch(html, re)));
}

function attr(html, name) {
  return clean(firstMatch(html, new RegExp(`${name}=["']([^"']+)["']`, "i")));
}

function firstMatch(text, regex) {
  return text.match(regex)?.[1] || "";
}

function absolutizeIndeedUrl(href, sourceUrl) {
  if (!href) return "";
  try {
    return new URL(href, sourceUrl || "https://jp.indeed.com").toString();
  } catch {
    return href;
  }
}

function extractPhone(text) {
  return text.match(PHONE_PATTERN)?.[0] || "";
}

function stripTags(text) {
  return decodeHtml(String(text).replace(/<[^>]*>/g, " "));
}

function decodeHtml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function clean(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
