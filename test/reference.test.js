/* Node test for the game-theory editor's bullet parser (js/reference.js).
 * Run: node test/reference.test.js
 * The editor converts nested bullets ⇄ indented plain text; a parse/serialize
 * mistake would silently corrupt the admin's content, so round-trip it hard. */
const R = require("../js/reference.js");

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) pass++; else { fail++; console.log("  FAIL " + label + (extra ? "  (" + extra + ")" : "")); } }
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, JSON.stringify(a) + " !== " + JSON.stringify(b));

// ---- every bundled category (both handbooks) survives a round trip unchanged
R.strategy.forEach((c) => {
  eq(R.parseBullets(R.serializeBullets(c.bullets)), c.bullets, `theory round-trip: ${c.id}`);
});
R.rules.forEach((c) => {
  eq(R.parseBullets(R.serializeBullets(c.bullets)), c.bullets, `rules round-trip: ${c.id}`);
});
// ---- House rules moved OUT of game theory and INTO the bottom of rules
ok(!R.strategy.some((c) => c.id === "houserules"), "house rules removed from game theory");
ok(R.rules[R.rules.length - 1].id === "houserules", "house rules is the last rules section");

// ---- nesting from indentation
eq(R.parseBullets("A\n  A1\n  A2\nB"),
   [{ t: "A", subs: [{ t: "A1" }, { t: "A2" }] }, { t: "B" }],
   "two levels of indentation nest correctly");

// ---- three levels deep
eq(R.parseBullets("A\n  B\n    C"),
   [{ t: "A", subs: [{ t: "B", subs: [{ t: "C" }] }] }],
   "three levels nest");

// ---- [debated] marks wip and is stripped from the text (case-insensitive)
eq(R.parseBullets("Risky idea [debated]"), [{ t: "Risky idea", wip: true }], "trailing [debated] sets wip");
eq(R.parseBullets("Risky [DEBATED]"), [{ t: "Risky", wip: true }], "[DEBATED] is case-insensitive");

// ---- blank lines are ignored; leading/trailing whitespace trimmed
eq(R.parseBullets("\n\nA\n\n  B\n\n"), [{ t: "A", subs: [{ t: "B" }] }], "blank lines ignored");

// ---- tabs count as one indent level (mixed with spaces)
eq(R.parseBullets("A\n\tB"), [{ t: "A", subs: [{ t: "B" }] }], "a tab indents one level");

// ---- 4-space indentation also works (stack compares relative indents)
eq(R.parseBullets("A\n    B\n        C"),
   [{ t: "A", subs: [{ t: "B", subs: [{ t: "C" }] }] }],
   "4-space indentation nests by relative depth");

// ---- serialize marks wip and indents
ok(R.serializeBullets([{ t: "X", wip: true, subs: [{ t: "Y" }] }]) === "X [debated]\n  Y\n", "serialize adds [debated] + indent");

// ---- empty / whitespace input -> empty list
eq(R.parseBullets(""), [], "empty text parses to no bullets");
eq(R.parseBullets("   \n  \n"), [], "whitespace-only text parses to no bullets");

// ---- blankCategory is a valid empty section with a unique id
const a = R.blankCategory(), b = R.blankCategory();
ok(a.id && a.id !== b.id && Array.isArray(a.bullets) && a.bullets.length === 0, "blankCategory: unique id, empty bullets");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
