import { describe, expect, it } from "vitest";
import {
  escapeLinkText,
  findLinkedPageIds,
  pageLinkMarkdown,
  parsePageUrl,
  syncLinkTitles,
  updateLinkTitle,
} from "../src/lib/pageLinks";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("pageLinks", () => {
  it("builds and parses page urls", () => {
    expect(pageLinkMarkdown(A, "Capital City")).toBe(`[Capital City](gdd://page/${A})`);
    expect(parsePageUrl(`gdd://page/${A}`)).toBe(A);
    expect(parsePageUrl("https://example.com")).toBeNull();
  });

  it("escapes brackets and backslashes in titles", () => {
    expect(escapeLinkText("a [b] \\c")).toBe("a \\[b\\] \\\\c");
    expect(pageLinkMarkdown(A, "")).toBe(`[Untitled](gdd://page/${A})`);
  });

  it("finds linked ids", () => {
    const md = `See [One](gdd://page/${A}) and [Two \\] x](gdd://page/${B}) and [web](https://x.y).`;
    expect([...findLinkedPageIds(md)].sort()).toEqual([A, B]);
  });

  it("rewrites only the renamed page's links", () => {
    const md = `[Old](gdd://page/${A}) - [Other](gdd://page/${B}) - [Old](gdd://page/${A})`;
    expect(updateLinkTitle(md, A, "New [1]")).toBe(
      `[New \\[1\\]](gdd://page/${A}) - [Other](gdd://page/${B}) - [New \\[1\\]](gdd://page/${A})`,
    );
  });

  it("round-trips titles containing brackets", () => {
    const once = updateLinkTitle(`[x](gdd://page/${A})`, A, "a]b");
    const twice = updateLinkTitle(once, A, "Plain");
    expect(twice).toBe(`[Plain](gdd://page/${A})`);
  });

  it("keeps text of links to unknown pages", () => {
    const md = `[Gone](gdd://page/${B})`;
    expect(syncLinkTitles(md, (id) => (id === A ? "A" : undefined))).toBe(md);
  });
});
