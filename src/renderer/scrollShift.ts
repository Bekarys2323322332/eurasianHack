/**
 * Works out how far a page scrolled between two screenshots, so a scroll
 * step can be shown as a real vertical pan instead of one picture pushing
 * the other away.
 *
 * The step file does not say how far the page moved. The two screenshots
 * do: after a scroll, most of the "after" picture is the same as a lower
 * part of the "before" picture. This file finds the vertical offset where
 * the two line up best.
 *
 * Runs in Node only (renderJob.ts calls it before rendering). It reads PNG
 * files by hand with zlib, to avoid adding an image library for one job.
 */
import fs from "node:fs";
import zlib from "node:zlib";

/** How many brightness samples are taken across each row of pixels. */
const SAMPLES_PER_ROW = 64;

/** One row of a picture, reduced to a few brightness values (0 to 255). */
type RowSignature = Uint8Array;

/**
 * Read a PNG and return one small brightness signature per row of pixels.
 * Supports what browser screenshots are: 8 bits per channel, RGB or RGBA,
 * not interlaced. Returns null for anything else.
 */
export function readRowSignatures(file: string): RowSignature[] | null {
  const png = fs.readFileSync(file);
  if (png.readUInt32BE(0) !== 0x89504e47) return null;

  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  // A PNG is a list of chunks: 4 bytes length, 4 bytes name, data, 4 bytes checksum.
  for (let position = 8; position < png.length; ) {
    const length = png.readUInt32BE(position);
    const name = png.toString("latin1", position + 4, position + 8);
    const body = png.subarray(position + 8, position + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      const colorType = body[9];
      const interlaced = body[12];
      channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
      if (bitDepth !== 8 || channels === 0 || interlaced !== 0) return null;
    } else if (name === "IDAT") {
      data.push(body);
    }
    position += 12 + length;
  }
  if (!width || !height) return null;

  // The pixel data is compressed, and each row is stored as differences
  // from its neighbours ("filtered"). Undo both to get plain pixels.
  const packed = zlib.inflateSync(Buffer.concat(data));
  const rowBytes = width * channels;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (rowBytes + 1)];
    const source = y * (rowBytes + 1) + 1;
    const target = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= channels ? pixels[target + i - channels] : 0;
      const up = y > 0 ? pixels[target + i - rowBytes] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[target + i - rowBytes - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        // Paeth: whichever neighbour is closest to left + up - upLeft.
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      pixels[target + i] = (packed[source + i] + predicted) & 255;
    }
  }

  const rows: RowSignature[] = [];
  for (let y = 0; y < height; y++) {
    const signature = new Uint8Array(SAMPLES_PER_ROW);
    for (let sample = 0; sample < SAMPLES_PER_ROW; sample++) {
      const x = Math.floor(((sample + 0.5) * width) / SAMPLES_PER_ROW);
      const at = y * rowBytes + x * channels;
      // Rough brightness: green counts double, as the eye sees it.
      signature[sample] = (pixels[at] + 2 * pixels[at + 1] + pixels[at + 2]) >> 2;
    }
    rows.push(signature);
  }
  return rows;
}

/**
 * Find how many rows the page moved. A positive result means the page was
 * scrolled down (its content moved up by that many rows). Returns null when
 * the two pictures do not line up anywhere, for example after a jump to a
 * completely different part of the page.
 */
export function bestShift(before: RowSignature[], after: RowSignature[]): number | null {
  const height = Math.min(before.length, after.length);
  // The two pictures must share at least this many rows to count as a match.
  const minOverlap = Math.floor(height * 0.2);
  // Two rows count as "the same" when their brightness differs by less than
  // this on average (0 to 255). Screenshots of the same content are identical
  // or very nearly so.
  const sameRow = 8;
  // An offset is accepted when at most this share of the shared rows differ.
  // Counting rows, instead of averaging everything, means parts that do not
  // scroll with the page (a header stuck to the top, a fixed side panel, a
  // cookie bar) cannot outvote the part that does.
  const maxDifferentShare = 0.35;

  let best: number | null = null;
  let bestCost = maxDifferentShare;
  // Try small moves first, so when several offsets fit equally well (large
  // plain areas) the smallest move wins.
  for (let distance = 0; distance <= height - minOverlap; distance++) {
    for (const shift of distance === 0 ? [0] : [distance, -distance]) {
      let different = 0;
      let rows = 0;
      // Row y of "after" is compared with row y + shift of "before".
      for (let y = Math.max(0, -shift); y < height - Math.max(0, shift); y += 2) {
        const a = after[y];
        const b = before[y + shift];
        let total = 0;
        for (let sample = 0; sample < SAMPLES_PER_ROW; sample += 2) {
          total += Math.abs(a[sample] - b[sample]);
        }
        if (total / (SAMPLES_PER_ROW / 2) >= sameRow) different += 1;
        rows += 1;
      }
      const cost = different / rows;
      // A later candidate must be clearly better to replace an earlier one.
      if (cost < bestCost - 0.02) {
        bestCost = cost;
        best = shift;
      }
    }
  }
  return best;
}

/**
 * How far the page scrolled between two screenshots, as a fraction of the
 * page height: 0.5 means half a screen down, -0.25 a quarter of a screen up,
 * 0 means it did not move. Null when the pictures do not line up (the
 * renderer then slides one whole picture away, as for a full-screen jump).
 */
export function estimateScrollShift(beforeFile: string, afterFile: string): number | null {
  try {
    const before = readRowSignatures(beforeFile);
    const after = readRowSignatures(afterFile);
    if (!before || !after || before.length !== after.length) return null;
    const shift = bestShift(before, after);
    return shift === null ? null : shift / before.length;
  } catch {
    // A picture we cannot read is never a reason to fail the render.
    return null;
  }
}
