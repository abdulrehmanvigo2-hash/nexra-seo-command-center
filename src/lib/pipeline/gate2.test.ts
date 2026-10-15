import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkStatus, gate2Confirmation, gate2View, indexingLink, liveUrl, runGate2, type Gate2Io, type Gate2Snapshot } from "@/lib/pipeline/gate2";
import type { PublicationEntry } from "@/lib/publishing/presenter";

const ARTICLE = "a0000000-0000-4000-8000-000000000001";
const PUB = "p0000000-0000-4000-8000-000000000001";

function snapshot(over: {
  passed?: number;
  eligibility?: "eligible" | "approved" | "blocked";
  attested?: number;
  proposal?: "none" | "current" | "stale";
  destination?: boolean;
  liveSlug?: string | null;
  latest?: { status: string; ready?: boolean; pullRequestUrl?: string | null } | null;
} = {}): Gate2Snapshot {
  const eligibility = over.eligibility ?? "eligible";
  const latest = over.latest ?? null;
  return {
    approval: {
      articleId: ARTICLE,
      currentVersion: 2,
      attestedCount: over.attested ?? 0,
      unitCounts: { total: 13, passed: over.passed ?? 13, needsReview: 0, failed: 0, pending: 0, unchecked: 0, mismatched: 0 },
      eligibility: eligibility === "blocked" ? { status: "blocked", blocks: [{}] } : eligibility === "approved" ? { status: "approved", approval: {} } : { status: "eligible" },
    } as never,
    proposal: {
      articleId: ARTICLE,
      destination: over.destination === false ? null : { key: "nexra-agency-website", label: "Nexra Agency website", host: "www.nexraagency.com" },
      eligibility: { status: "eligible" },
      activeProposal: over.proposal === "current" || over.proposal === "stale" ? { id: "x" } : null,
      activeProposalCurrent: over.proposal === "current" ? true : over.proposal === "stale" ? false : null,
      liveSlug: over.liveSlug ?? null,
    } as never,
    mode: "dry-run",
    configured: true,
    publications: latest === null ? [] : [{ publication: { id: PUB, articleId: ARTICLE, slug: "ai-sdr-tool", status: latest.status, pullRequestUrl: latest.pullRequestUrl ?? null, requestedAt: "2026-10-15T00:00:00Z" }, approval: null, ready: latest.ready ?? false } as unknown as PublicationEntry],
  };
}

describe("gate2View", () => {
  test("not offered until every unit passed", () => {
    assert.deepEqual(gate2View(snapshot({ passed: 12 })), { state: "not-checked" });
  });
  test("a fresh, fully checked version: approve → propose → request → publish", () => {
    assert.deepEqual(gate2View(snapshot()), { state: "ready", steps: ["approve", "propose", "request", "publish"], needsAttestation: false, attestedCount: 0 });
  });
  test("steps already done are skipped; the tick is needed only when this press approves an attested version", () => {
    const v = gate2View(snapshot({ eligibility: "approved", proposal: "current", attested: 3, latest: { status: "requested", ready: true } }));
    assert.deepEqual(v, { state: "ready", steps: ["publish"], needsAttestation: false, attestedCount: 3 });
    assert.equal((gate2View(snapshot({ attested: 3 })) as unknown as { needsAttestation: boolean }).needsAttestation, true);
    assert.deepEqual((gate2View(snapshot({ latest: { status: "requested", ready: false } })) as unknown as { steps: string[] }).steps, ["approve", "propose", "request", "publish"]);
  });
  test("blocked: an approval refusal, a stale proposal, no destination, already live elsewhere", () => {
    assert.equal(gate2View(snapshot({ eligibility: "blocked" })).state, "blocked");
    assert.match((gate2View(snapshot({ proposal: "stale" })) as unknown as { reason: string }).reason, /withdraw it/);
    assert.equal(gate2View(snapshot({ destination: false })).state, "blocked");
    assert.equal(gate2View(snapshot({ liveSlug: "old-slug" })).state, "blocked");
  });
  test("under way: Check status; live: the page and the indexing link", () => {
    assert.deepEqual(gate2View(snapshot({ latest: { status: "pull-request-open", pullRequestUrl: "https://github.com/x/y/pull/1" } })), { state: "in-progress", publicationId: PUB, status: "pull-request-open", pullRequestUrl: "https://github.com/x/y/pull/1" });
    assert.deepEqual(gate2View(snapshot({ latest: { status: "live" } })), { state: "live", url: "https://www.nexraagency.com/blog/ai-sdr-tool" });
    assert.equal(liveUrl("a-b"), "https://www.nexraagency.com/blog/a-b");
    assert.equal(indexingLink("https://www.nexraagency.com/blog/a-b"), "https://search.google.com/search-console/inspect?id=https%3A%2F%2Fwww.nexraagency.com%2Fblog%2Fa-b");
  });
  test("the confirmation names the steps and the mode, and spends no run", () => {
    const c = gate2Confirmation("nexra-agency", snapshot(), ["approve", "propose", "request", "publish"], "2026-10-15");
    assert.equal(c.usage, null);
    assert.match(c.facts.find((f) => f.label === "Steps")!.value, /approve this version → record its publication proposal → request publication → press Publish/);
    assert.match(c.facts.find((f) => f.label === "Publish mode")!.value, /^Dry run/);
  });
});

describe("runGate2", () => {
  function io(over: Partial<{ approve: boolean; propose: boolean; requestStatus: number; publishBody: unknown; publishStatus: number }> = {}) {
    const calls: string[] = [];
    const x: Gate2Io = {
      approve: async (tick) => {
        calls.push(`approve ${tick}`);
        return over.approve === false ? { ok: false, reason: "ineligible" } : { ok: true };
      },
      readProposal: async () => {
        calls.push("readProposal");
        return snapshot({ eligibility: "approved" }).proposal;
      },
      propose: async (destination, version) => {
        calls.push(`propose ${destination} ${version}`);
        return over.propose === false ? { ok: false, reason: "refused" } : { ok: true };
      },
      request: async (date) => {
        calls.push(`request ${date}`);
        return over.requestStatus === 409 ? { status: 409, body: { error: "not-eligible", reason: "no-active-proposal" } } : { status: 201, body: { status: "requested", publication: { id: PUB, approvalId: "ap1" } } };
      },
      readPublications: async () => {
        calls.push("readPublications");
        return snapshot({ latest: { status: "requested", ready: true } }).publications;
      },
      publish: async (id) => {
        calls.push(`publish ${id}`);
        return { status: over.publishStatus ?? 200, body: over.publishBody ?? { status: "waiting", waitingFor: "owner-merge" } };
      },
    };
    return { io: x, calls };
  }
  const options = { attestationConfirmed: true, publishedOn: "2026-10-15" };

  test("every step in order; dry-run waits for the owner's merge", async () => {
    const { io: x, calls } = io();
    const out = await runGate2(x, snapshot(), ["approve", "propose", "request", "publish"], options);
    assert.deepEqual(calls, ["approve true", "readProposal", "propose nexra-agency-website 2", "request 2026-10-15", `publish ${PUB}`]);
    assert.deepEqual(out.done, ["approve", "propose", "request", "publish"]);
    assert.match(out.text, /Merge it on GitHub/);
  });
  test("stops at the first refusal", async () => {
    const refused = io({ approve: false });
    const out = await runGate2(refused.io, snapshot(), ["approve", "propose", "request", "publish"], options);
    assert.deepEqual(refused.calls, ["approve true"]);
    assert.equal(out.tone, "warning");
    const request = io({ requestStatus: 409 });
    const r = await runGate2(request.io, snapshot(), ["request", "publish"], options);
    assert.ok(!request.calls.some((c) => c.startsWith("publish")));
    assert.match(r.text, /proposal first/);
  });
  test("publishing off or a render refusal is a warning, not done", async () => {
    const off = await runGate2(io({ publishStatus: 409, publishBody: { error: "publishing-off" } }).io, snapshot(), ["publish"], options);
    assert.equal(off.tone, "warning");
    assert.deepEqual(off.done, []);
  });
  test("a ready request is reused, not requested again", async () => {
    const { io: x, calls } = io();
    await runGate2(x, snapshot(), ["publish"], options);
    assert.deepEqual(calls, ["readPublications", `publish ${PUB}`]);
  });
  test("Check status presses Publish again", async () => {
    const live = await checkStatus(io({ publishBody: { status: "live" } }).io, PUB);
    assert.equal(live.tone, "positive");
  });
});

describe("Gate 2 on the article step", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("src/components/content/gate2-panel.tsx", "utf8");
  const step = readFileSync("src/components/content/gate1-article.tsx", "utf8");
  test("shown only when every unit passed; one confirmation; the tick is the owner's", () => {
    assert.match(step, /checks\.value\.counts\.passed === checks\.value\.counts\.total && \(\s*<Gate2Panel/);
    assert.match(panel, /gate2Confirmation\(projectId, snapshot, view\.steps, publishedOn\)/);
    assert.match(panel, /useState\(false\)/);
    assert.match(panel, /attestationConfirmed: view\.needsAttestation && ticked/);
  });
  test("through the existing actions and routes only", () => {
    assert.match(panel, /approveArticleVersion\(/);
    assert.match(panel, /recordArticleProposal\(projectId, articleId, articleVersion, destination, RECORD_PROPOSAL_CONFIRMATION\)/);
    assert.match(panel, /fetch\("\/api\/publications", \{ method: "POST"/);
    assert.match(panel, /JSON\.stringify\(\{ action: "publish" \}\)/);
    assert.doesNotMatch(panel, /action: "abandon"|NEXRA_PUBLISH_MODE|merge\(/);
  });
});
