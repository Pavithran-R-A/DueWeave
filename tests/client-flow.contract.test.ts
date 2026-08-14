import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sheet = readFileSync(resolve(root, "client/src/components/sheets.tsx"), "utf8");
const home = readFileSync(resolve(root, "client/src/pages/Home.tsx"), "utf8");

describe("Stage 4.1 client and conversion contracts", () => {
  it("requires an explicit client choice and supports createForClient without name-based merging", () => {
    expect(sheet).toContain('mode: "existing"');
    expect(sheet).toContain('mode: "new"');
    expect(sheet).toContain("Search existing clients");
    expect(sheet).toContain("DueWeave never merges people by name.");
    expect(home).toContain("receivableRepository.createForClient");
    expect(home).toContain("receivableRepository.createWithClient");
  });

  it("turns the database-authoritative Free-plan cap into a real Founder route without relaxing the cap", () => {
    expect(home).toContain("Free plan allows up to three active receivables");
    expect(home).toContain("setFounderLimitReached(true)");
    expect(home).toContain('navigateTo("/founder")');
    expect(home).toContain("Founder access is activated only after manual payment review.");
  });
});
