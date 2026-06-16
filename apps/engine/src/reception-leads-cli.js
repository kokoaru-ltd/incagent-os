import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildIndeedUrl,
  buildReceptionLeads,
  fetchIndeedHtml,
  parseInputRows,
  toCsv,
} from "./reception-lead-generator.js";
import { createReceptionLead } from "./db.js";

function parseArgs(argv) {
  const args = {
    businessId: process.env.BUSINESS_ID || "inbound-agent",
    query: "電話受付 受電 オペレーター",
    location: "",
    limit: 20,
    minScore: 5,
    insert: false,
    format: "csv",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--insert") args.insert = true;
    else if (arg === "--json") args.format = "json";
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    }
  }

  args.limit = Number(args.limit || 20);
  args.minScore = Number(args.minScore || 5);
  return args;
}

async function loadRows(args) {
  if (args.input) {
    const text = await readFile(args.input, "utf8");
    return parseInputRows(text, args.url || "");
  }

  const url = args.url || buildIndeedUrl({ query: args.query, location: args.location });
  const html = await fetchIndeedHtml(url);
  return parseInputRows(html, url);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadRows(args);
  const result = buildReceptionLeads(rows, {
    limit: args.limit,
    minScore: args.minScore,
  });

  const payload = {
    source: args.input || args.url || buildIndeedUrl(args),
    businessId: args.businessId,
    acceptedCount: result.accepted.length,
    rejectedCount: result.rejected.length,
    accepted: result.accepted,
  };

  if (args.insert) {
    payload.inserted = [];
    for (const lead of result.accepted) {
      payload.inserted.push(await createReceptionLead(args.businessId, lead));
    }
  }

  const output = args.format === "json" ? `${JSON.stringify(payload, null, 2)}\n` : toCsv(result.accepted);
  if (args.out) await writeFile(args.out, output, "utf8");
  else process.stdout.write(output);

  console.error(
    `[reception-leads] accepted=${result.accepted.length} rejected=${result.rejected.length} insert=${args.insert}`
  );
}

main().catch((error) => {
  console.error(`[reception-leads] ${error.stack || error.message}`);
  process.exit(1);
});
