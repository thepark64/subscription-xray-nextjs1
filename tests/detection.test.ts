import { describe, expect, it } from "vitest";
import { analyzeCsv, parseDate, parseAmount, parseCsv, merchantKey } from "@/lib/detection";

// All data below is invented for testing.

describe("parseDate", () => {
  it("reads DD/MM/YYYY (Indian format), including days above 12", () => {
    expect(parseDate("25/01/2024")?.toISOString().slice(0, 10)).toBe("2024-01-25");
    expect(parseDate("05/06/2024")?.toISOString().slice(0, 10)).toBe("2024-06-05");
  });
  it("falls back to MM/DD when the second part cannot be a day-first month", () => {
    expect(parseDate("01/25/2024")?.toISOString().slice(0, 10)).toBe("2024-01-25");
  });
  it("reads ISO and textual dates", () => {
    expect(parseDate("2024-03-09")?.toISOString().slice(0, 10)).toBe("2024-03-09");
    expect(parseDate("9-Mar-24")?.toISOString().slice(0, 10)).toBe("2024-03-09");
    expect(parseDate("09 Mar 2024")?.toISOString().slice(0, 10)).toBe("2024-03-09");
    expect(parseDate("Mar 9, 2024")?.toISOString().slice(0, 10)).toBe("2024-03-09");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("31/02/2024")).toBeNull();
    expect(parseDate("hello")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles currency symbols, commas, Dr/Cr and negatives", () => {
    expect(parseAmount("₹1,299.00")?.value).toBe(1299);
    expect(parseAmount("1,200.50Dr")).toEqual({ value: 1200.5, marker: "debit" });
    expect(parseAmount("500 Cr")).toEqual({ value: 500, marker: "credit" });
    expect(parseAmount("(649.00)")?.value).toBe(-649);
    expect(parseAmount("-649")?.value).toBe(-649);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, quotes and newlines, BOM and semicolons", () => {
    const rows = parseCsv('﻿a,b\n"x, y","line1\nline2"\n"he said ""hi""",z');
    expect(rows[1]).toEqual(["x, y", "line1\nline2"]);
    expect(rows[2][0]).toBe('he said "hi"');
    expect(parseCsv("a;b\n1;2")[1]).toEqual(["1", "2"]);
  });
});

describe("merchantKey", () => {
  it("ignores reference numbers, UPI handles and payment-mode words", () => {
    expect(merchantKey("UPI/412345678901/NETFLIX@okaxis/Payment")).toBe(merchantKey("UPI/998877665544/NETFLIX@okaxis/Payment"));
  });
});

describe("analyzeCsv", () => {
  const debitCreditCsv = [
    "Account statement for XXXX",
    "Generated 01/04/2024",
    "Txn Date,Value Date,Narration,Withdrawal Amt.,Deposit Amt.,Balance",
    "05/01/2024,05/01/2024,UPI/111111111111/NETFLIX@okaxis,649.00,,10000",
    "01/02/2024,01/02/2024,SALARY ACME LTD,,50000.00,60000",
    "05/02/2024,05/02/2024,UPI/222222222222/NETFLIX@okaxis,649.00,,59351",
    "01/03/2024,01/03/2024,SALARY ACME LTD,,50000.00,109351",
    "06/03/2024,06/03/2024,UPI/333333333333/NETFLIX@okaxis,649.00,,108702",
    "10/01/2024,10/01/2024,SPOTIFY INDIA 1,119.00,,1",
    "10/02/2024,10/02/2024,SPOTIFY INDIA 2,119.00,,1",
    "10/03/2024,10/03/2024,SPOTIFY INDIA 3,119.00,,1",
    "03/01/2024,03/01/2024,SWIGGY ORDER 8,310.00,,1",
    "09/01/2024,09/01/2024,SWIGGY ORDER 9,455.00,,1",
    "11/01/2024,11/01/2024,SWIGGY ORDER 4,120.00,,1",
    "20/02/2024,20/02/2024,SWIGGY ORDER 3,820.00,,1",
  ].join("\n");

  it("finds subscriptions, skips salary and one-off orders, finds the header below a preamble", () => {
    const r = analyzeCsv(debitCreditCsv);
    const names = r.subscriptions.map((s) => s.merchant);
    expect(names).toContain("Netflix");
    expect(names).toContain("Spotify");
    expect(names.some((n) => /salary/i.test(n))).toBe(false);
    expect(names.some((n) => /swiggy/i.test(n))).toBe(false);
    const netflix = r.subscriptions.find((s) => s.merchant === "Netflix")!;
    expect(netflix.frequency).toBe("monthly");
    expect(netflix.occurrences).toBe(3);
    expect(netflix.service?.url).toContain("netflix.com");
    expect(r.monthlyTotal).toBeCloseTo(649 + 119, 0);
  });

  it("handles a single signed Amount column (negatives are spending)", () => {
    const csv = [
      "Date,Description,Amount",
      "2024-01-15,Google One storage,-130",
      "2024-02-15,Google One storage,-130",
      "2024-03-16,Google One storage,-130",
      "2024-02-28,Salary,45000",
    ].join("\n");
    const r = analyzeCsv(csv);
    expect(r.subscriptions).toHaveLength(1);
    expect(r.subscriptions[0].monthlyEquivalent).toBeCloseTo(130);
  });

  it("detects annual charges and uses Dr/Cr type column", () => {
    const csv = [
      "Date,Details,Amount,Type",
      "12/03/2023,Adobe Creative Cloud,4230.00,Debit",
      "11/03/2024,Adobe Creative Cloud,4230.00,Debit",
      "01/03/2024,Refund Amazon,999.00,Credit",
    ].join("\n");
    const r = analyzeCsv(csv);
    expect(r.subscriptions).toHaveLength(1);
    expect(r.subscriptions[0].frequency).toBe("annual");
    expect(r.subscriptions[0].monthlyEquivalent).toBeCloseTo(4230 / 12);
  });

  it("does not flag frequent same-merchant purchases with varying amounts", () => {
    const csv = ["Date,Description,Amount"];
    for (let d = 1; d <= 20; d += 2) csv.push(`${String(d).padStart(2, "0")}/01/2024,BIG BAZAAR,${100 + d * 37}`);
    expect(analyzeCsv(csv.join("\n")).subscriptions).toHaveLength(0);
  });

  it("throws clear errors for unusable files", () => {
    expect(() => analyzeCsv("just one line")).toThrow();
    expect(() => analyzeCsv("foo,bar\n1,2")).toThrow(/columns/i);
  });
});
