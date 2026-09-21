import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSupabaseProjectGateway } from "./supabase/gateway.ts";
import { PROJECT_INTAKE_COLUMNS, projectIntakeRowToIntake, type ProjectRow } from "./supabase/schema.ts";

/**
 * The write at the table boundary: one column of one row, by id, with the
 * intake columns read back. A stateful in-memory client stands in for
 * Supabase and records every call, so the patch the real client would send
 * is asserted exactly and a later read shows what a reload would show —
 * without a database.
 *
 * The repository above this boundary is four lines (an id guard, the call,
 * null → unknown project, the row mapped) and its module pulls the fixture
 * roster into `node --test`, so the guard is covered where it is also
 * applied, in the update rule's tests, and the boundary is covered here.
 */

const ROW: ProjectRow = {
  id: "nexra-agency",
  name: "Nexra Agency",
  client: "Nexra",
  domain: "nexraagency.com",
  initials: "NA",
  industry: "Marketing",
  type: "lead-gen",
  status: "onboarding",
  goal: "leads",
  market: "United States",
  language: "English (US)",
  target_location: "United States",
  summary: "",
  competitor_domains: [],
  intake_notes: "Client wants leads.",
  started_on: "2026-09-01",
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
};

const OTHER_ROW: ProjectRow = { ...ROW, id: "halcyon-fintech", domain: "halcyon.example", competitor_domains: ["halcyon-rival.example"] };

type Call = { readonly table: string; readonly mode: "select" | "update"; readonly patch: Record<string, unknown>; readonly filters: [string, unknown][]; readonly columns: string };

/** Enough of the client to hold rows and record exactly what the gateway sends. */
function fakeClient() {
  const rows = new Map<string, Record<string, unknown>>([
    [ROW.id, { ...ROW }],
    [OTHER_ROW.id, { ...OTHER_ROW }],
  ]);
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call = { table, mode: "select" as "select" | "update", patch: {} as Record<string, unknown>, filters: [] as [string, unknown][], columns: "" };
      const matching = () => [...rows.values()].filter((row) => call.filters.every(([column, value]) => row[column] === value));
      const query = {
        update(patch: Record<string, unknown>) {
          call.mode = "update";
          call.patch = patch;
          return query;
        },
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return query;
        },
        async maybeSingle() {
          calls.push({ ...call, filters: [...call.filters] });
          const targets = matching();
          if (call.mode === "update") for (const row of targets) Object.assign(row, call.patch);
          const row = targets[0];
          if (!row) return { data: null, error: null };
          const picked = Object.fromEntries(call.columns.split(",").map((column) => [column, row[column]]));
          return { data: picked, error: null };
        },
      };
      return query;
    },
  };
  const gateway = createSupabaseProjectGateway(client as unknown as Parameters<typeof createSupabaseProjectGateway>[0]);
  return { gateway, rows, calls };
}

describe("the gateway's competitor update", () => {
  test("updates one column of one row by id, and reads back the intake columns only", async () => {
    const { gateway, calls } = fakeClient();

    const row = await gateway.updateCompetitorDomains("nexra-agency", ["rival.example", "other.example"]);
    assert.deepEqual(row, { id: "nexra-agency", competitor_domains: ["rival.example", "other.example"], intake_notes: "Client wants leads." });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.table, "projects");
    assert.equal(calls[0]?.mode, "update");
    assert.deepEqual(calls[0]?.patch, { competitor_domains: ["rival.example", "other.example"] });
    assert.deepEqual(Object.keys(calls[0]?.patch ?? {}), ["competitor_domains"], "the patch names one column");
    assert.deepEqual(calls[0]?.filters, [["id", "nexra-agency"]], "the row is chosen by id and nothing else");
    assert.equal(calls[0]?.columns, PROJECT_INTAKE_COLUMNS);
  });

  test("the persisted list is what a later intake read returns — it survives a reload", async () => {
    const { gateway } = fakeClient();
    await gateway.updateCompetitorDomains("nexra-agency", ["rival.example"]);
    const read = await gateway.selectIntakeById("nexra-agency");
    assert.deepEqual(read, { id: "nexra-agency", competitor_domains: ["rival.example"], intake_notes: "Client wants leads." });
    assert.deepEqual(projectIntakeRowToIntake(read), { competitorDomains: ["rival.example"], intakeNotes: "Client wants leads." });
  });

  test("nothing else on the row changes, and no other row is touched", async () => {
    const { gateway, rows } = fakeClient();
    const before = { ...rows.get("nexra-agency")! };
    await gateway.updateCompetitorDomains("nexra-agency", ["rival.example"]);
    const after = rows.get("nexra-agency")!;
    for (const column of Object.keys(before)) {
      if (column === "competitor_domains") continue;
      assert.deepEqual(after[column], before[column], column);
    }
    assert.deepEqual(after.competitor_domains, ["rival.example"]);
    assert.deepEqual(rows.get("halcyon-fintech"), { ...OTHER_ROW });
  });

  test("removing every domain stores an empty list, not a null", async () => {
    const { gateway, rows } = fakeClient();
    await gateway.updateCompetitorDomains("nexra-agency", ["rival.example"]);
    const row = await gateway.updateCompetitorDomains("nexra-agency", []);
    assert.deepEqual(row?.competitor_domains, []);
    assert.deepEqual(rows.get("nexra-agency")?.competitor_domains, []);
  });

  test("a row that does not exist answers null rather than throwing, and writes nothing", async () => {
    const { gateway, rows } = fakeClient();
    assert.equal(await gateway.updateCompetitorDomains("no-such-project", ["rival.example"]), null);
    assert.deepEqual(rows.get("nexra-agency")?.competitor_domains, []);
    assert.deepEqual(rows.get("halcyon-fintech")?.competitor_domains, ["halcyon-rival.example"]);
  });

  test("the list is copied into the patch, so the caller's array is not what is sent", async () => {
    const { gateway, calls } = fakeClient();
    const list = ["rival.example"];
    await gateway.updateCompetitorDomains("nexra-agency", list);
    assert.notEqual(calls[0]?.patch.competitor_domains, list);
    assert.deepEqual(calls[0]?.patch.competitor_domains, list);
  });
});
