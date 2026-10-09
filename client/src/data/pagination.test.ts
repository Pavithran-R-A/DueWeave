import { describe, expect, it } from "vitest";
import { collectAllRows, PAGE_SIZE } from "@/data/pagination";

describe("complete paginated financial reads", () => {
  it("fetches and joins multiple pages without skipping the 1000th row", async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i);
    const ranges: number[][] = [];
    const result = await collectAllRows((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: ids.slice(from, to + 1), error: null });
    });
    expect(result).toEqual(ids);
    expect(ranges).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, PAGE_SIZE * 2 - 1], [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1]]);
  });

  it("returns an empty ledger from a zero-row page", async () => {
    expect(await collectAllRows(() => Promise.resolve({ data: [], error: null }))).toEqual([]);
  });

  it("refuses network failure rather than exporting a truncated partial ledger", async () => {
    let pages = 0;
    await expect(collectAllRows(async () => {
      pages += 1;
      return pages === 1 ? { data: Array.from({ length: PAGE_SIZE }, (_, i) => i), error: null } : { data: null, error: { message: "connection lost" } };
    })).rejects.toThrow();
    expect(pages).toBe(2);
  });

  it("refuses null data without an error rather than saying the archive is complete", async () => {
    await expect(collectAllRows(() => Promise.resolve({ data: null, error: null }))).rejects.toThrow("complete ledger");
  });
});
