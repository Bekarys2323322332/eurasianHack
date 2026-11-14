/**
 * Self-check for the scroll measuring. Run with:
 *   npx tsx src/renderer/scroll.check.ts
 * Builds a tall made-up page out of random rows, takes two "screenshots" of
 * it at different scroll positions, and checks that the distance between
 * them is found.
 */
import assert from "node:assert/strict";
import { bestShift } from "./scrollShift";

// A fixed sequence of pseudo-random numbers, so the check is repeatable.
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) % 256;

const page = Array.from({ length: 2000 }, () => Uint8Array.from({ length: 64 }, random));
const shot = (top: number) => page.slice(top, top + 720);

assert.equal(bestShift(shot(100), shot(100)), 0); // page did not move
assert.equal(bestShift(shot(100), shot(400)), 300); // scrolled down 300 rows
assert.equal(bestShift(shot(400), shot(100)), -300); // scrolled up 300 rows
assert.equal(bestShift(shot(0), shot(1200)), null); // nothing in common

// A header that stays at the top of both screenshots must not confuse it.
const header = page.slice(1900, 1960);
const withHeader = (top: number) => [...header, ...shot(top).slice(60)];
assert.equal(bestShift(withHeader(100), withHeader(350)), 250);

console.log("scroll check passed");
