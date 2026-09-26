#!/usr/bin/env node
/**
 * Secret scan for the repository, with no dependencies.
 *
 *   node scripts/secret-scan.mjs --tree                   every tracked text file
 *   node scripts/secret-scan.mjs --diff <base> [<head>]   lines <head> (default HEAD) adds since <base>
 *
 * `SECRET_SCAN_ALLOWLIST` overrides the allowlist path (a self-test points it
 * at an empty file to prove the fixtures are found).
 *
 * The patterns are the credential shapes the application itself refuses
 * (`src/lib/agent-runs/safety.ts`, `src/lib/auth/config.ts`): private keys,
 * Supabase secret keys, JWTs (the service-role key's shape), provider keys
 * and generic literal credential assignments. A match fails the scan unless
 * `.github/secret-scan-allowlist` names that file and pattern id, which is
 * how synthetic test fixtures are admitted one by one rather than by
 * excluding test files wholesale.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATTERNS = [
  ["pem-private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["supabase-secret-key", /\bsb_secret_[A-Za-z0-9_-]{8,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["sk-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["google-oauth-token", /\bya29\.[0-9A-Za-z_-]{20,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  // A credential-named field assigned a quoted single-token literal of six
  // or more characters. A reference (`apiKey: options.apiKey`) is not a
  // literal, an empty placeholder (`ANTHROPIC_API_KEY=`) is too short, and a
  // sentence such as a user-facing message contains spaces; none match.
  ["credential-literal", /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|bearer|private[_-]?key)\s*[:=]\s*["'`][^"'`\s]{6,}["'`]/i],
];

const ALLOWLIST_PATH = process.env.SECRET_SCAN_ALLOWLIST || ".github/secret-scan-allowlist";
const SKIP = [/^package-lock\.json$/, /\.(png|ico|jpg|jpeg|gif|webp|woff2?|ttf|pdf)$/i];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readAllowlist() {
  const allowed = new Set();
  let text = "";
  try {
    text = readFileSync(resolve(ALLOWLIST_PATH), "utf8");
  } catch {
    return allowed;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const [file, pattern] = line.split(/\s+/);
    if (!file || !pattern) {
      console.error(`secret-scan: malformed allowlist line: ${raw}`);
      process.exit(2);
    }
    allowed.add(`${file}\u0000${pattern}`);
  }
  return allowed;
}

/** { file, lines: [{ number, text }] } for every file to scan. */
function treeSources() {
  return git("ls-files", "-z")
    .split("\u0000")
    .filter((file) => file !== "" && !SKIP.some((skip) => skip.test(file)))
    .map((file) => {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return null;
      }
      if (text.includes("\u0000")) return null;
      return { file, lines: text.split("\n").map((line, index) => ({ number: index + 1, text: line })) };
    })
    .filter((source) => source !== null);
}

function diffSources(base, head) {
  const diff = git("diff", "--unified=0", "--no-color", `${base}...${head}`);
  const sources = new Map();
  let file = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4);
      file = path === "/dev/null" ? null : path.replace(/^b\//, "");
      if (file && SKIP.some((skip) => skip.test(file))) file = null;
      if (file && !sources.has(file)) sources.set(file, { file, lines: [] });
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("index ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+")) {
      sources.get(file).lines.push({ number: line, text: raw.slice(1) });
      line += 1;
    } else if (!raw.startsWith("-") && !raw.startsWith("\\")) {
      line += 1;
    }
  }
  return [...sources.values()];
}

function main() {
  const [mode, base, head = "HEAD"] = process.argv.slice(2);
  let sources;
  if (mode === "--tree") sources = treeSources();
  else if (mode === "--diff" && base) sources = diffSources(base, head);
  else {
    console.error("usage: secret-scan.mjs --tree | --diff <base> [<head>]");
    process.exit(2);
  }

  const allowed = readAllowlist();
  const findings = [];
  const admitted = [];
  for (const { file, lines } of sources) {
    if (file === ".github/secret-scan-allowlist") continue;
    for (const { number, text } of lines) {
      for (const [id, pattern] of PATTERNS) {
        if (!pattern.test(text)) continue;
        const key = `${file}\u0000${id}`;
        if (allowed.has(key)) admitted.push(`${file}:${number} ${id}`);
        else findings.push(`${file}:${number} ${id}`);
        // One id per line is enough to fail it; keep the most specific first.
        break;
      }
    }
  }

  const scanned = sources.reduce((count, source) => count + source.lines.length, 0);
  console.log(`secret-scan: ${mode === "--tree" ? "tree" : `diff since ${base}`}, ${sources.length} files, ${scanned} lines, ${admitted.length} allowlisted fixture line(s)`);
  if (findings.length > 0) {
    console.error("secret-scan: credential-shaped text found (file:line pattern); the text itself is not printed:");
    for (const finding of findings) console.error(`  ${finding}`);
    console.error(`secret-scan: ${findings.length} finding(s). A deliberate test fixture is admitted by adding "<file> <pattern>" to ${ALLOWLIST_PATH}.`);
    process.exit(1);
  }
  console.log("secret-scan: clean");
}

main();
