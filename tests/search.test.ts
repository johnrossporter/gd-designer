import { describe, expect, it } from "vitest";
import { buildMatcher, findMatches, markdownToPlainText, searchPages } from "../src/lib/search";
import type { Page } from "../src/types/document";

function page(id: string, title: string, content: string): Page {
  return { id, title, content, parentId: null, children: [], createdAt: "", updatedAt: "" };
}

describe("markdownToPlainText", () => {
  it("strips markdown syntax, link urls and image data", () => {
    const md = [
      "# The **Capital**",
      "",
      "- [ ] visit [Skyhold](gdd://page/abc-123) and *the* `docks`",
      "> quoted \\[text\\]",
      "![a map](data:image/png;base64,AAAAcapitalAAAA)",
      "```",
      "code line",
      "```",
      "| a | b |",
      "| --- | --- |",
      "---",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(
      ["The Capital", "", "visit Skyhold and the docks", "quoted [text]", "a map", "code line", "a  b"].join("\n"),
    );
  });
});

describe("matching", () => {
  it("supports case and whole-word options", () => {
    const text = "Port, port, Portal and PORT";
    expect(findMatches(text, buildMatcher("port")!)).toHaveLength(4);
    expect(findMatches(text, buildMatcher("port", { matchCase: true })!)).toHaveLength(1);
    expect(findMatches(text, buildMatcher("port", { wholeWord: true })!)).toHaveLength(3);
    expect(buildMatcher("   ")).toBeNull();
    expect(findMatches("a.b axb", buildMatcher("a.b")!)).toHaveLength(1);
  });
});

describe("searchPages", () => {
  const pages: Record<string, Page> = {
    a: page("a", "Places", "Nothing here."),
    b: page("b", "Harbor", "The harbor is big.\nShips leave the harbor at dawn."),
    c: page("c", "Docks", "See [the Harbor](gdd://page/b)."),
    d: page("d", "Images", "![x](data:image/png;base64,harborharbor)"),
  };

  it("finds title and content matches with snippets and occurrences", () => {
    const results = searchPages(pages, ["a", "b", "c", "d"], "harbor");
    expect(results.map((r) => r.id)).toEqual(["b", "c"]);
    const harbor = results[0];
    expect(harbor.titleMatch).toBe(true);
    expect(harbor.total).toBe(2);
    expect(harbor.hits.map((h) => h.occurrence)).toEqual([0, 1]);
    const hit = harbor.hits[1];
    expect(hit.snippet.slice(hit.start, hit.end)).toBe("harbor");
    expect(hit.snippet).toBe("Ships leave the harbor at dawn.");
    expect(results[1].hits[0].snippet).toBe("See the Harbor.");
  });

  it("trims long lines around the match", () => {
    const long = "x".repeat(200) + " needle " + "y".repeat(200);
    const [r] = searchPages({ p: page("p", "P", long) }, ["p"], "needle");
    const h = r.hits[0];
    expect(h.snippet.startsWith("…")).toBe(true);
    expect(h.snippet.endsWith("…")).toBe(true);
    expect(h.snippet.slice(h.start, h.end)).toBe("needle");
  });
});
