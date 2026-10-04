import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ARTICLE_PART_INSTRUCTIONS } from "@/lib/briefs/article-part";

/**
 * The second auto-drafted article (brief a8515cfb, 4 Oct) checked 6 of 13 units at the first pass. Apart from the
 * pricing sentence (its admitted unit never reached the checker: the article was not linked to the opportunity's
 * task), every sentence the checker held UNVERIFIABLE was one of these kinds. The Writer is told never to write them
 * outside an opinion line, with an example and the rewrite for each.
 */
describe("the Writer's never-write rules", () => {
  const rules: readonly [string, RegExp][] = [
    ["a general description of a kind of product", /a general description of what a kind of product is or does \(not "An AI receptionist is software that answers calls" but "In this guide, an AI receptionist means software that answers calls"\)/],
    ["a claim about what tools, vendors or a market do", /a claim about what tools, vendors or a market do \(not "Some tools only take messages" but "Find out whether a tool only takes messages"\)/],
    ["what something is built for", /a statement of what something is built for or best at/],
    ["a predicted outcome", /a prediction of an outcome or consequence \(not "a trial will tell you something useful" but "Run a trial once your questions are written down"\)/],
    ["an unquoted proportion", /a proportion or frequency such as most, many, usually or often that no admitted unit's quote states\./],
  ];

  for (const [name, rule] of rules) test(name, () => assert.match(ARTICLE_PART_INSTRUCTIONS, rule));

  test("each is rewritten as advice, a question or a sentence about the guide; an evidence line keeps to its quote", () => {
    assert.match(ARTICLE_PART_INSTRUCTIONS, /Never write, outside an \[opinion\] line, what the article check cannot verify:/);
    assert.match(ARTICLE_PART_INSTRUCTIONS, /Write each of those as advice, a question for the reader to ask, or a sentence about this guide instead\. An \[evidence E<n>\] line keeps to that unit's quote and adds no qualifier, audience or scope the quote does not state\./);
  });

  test("the rules come after the advice rule and before the record rule", () => {
    const at = (text: string) => ARTICLE_PART_INSTRUCTIONS.indexOf(text);
    assert.ok(at("Prefer advice to opinion") < at("Never write, outside an [opinion] line"));
    assert.ok(at("Write each of those as advice") < at("Never tag a record the supplied blocks do not hold"));
  });
});
