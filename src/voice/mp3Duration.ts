/**
 * Measures how long an mp3 file really is, in seconds, by walking through
 * its frames. Each mp3 frame starts with a 4-byte header that says how many
 * samples it holds and at what sample rate, so adding those up gives the
 * exact playing time, for both fixed and variable bitrate files.
 *
 * Written by hand (about 40 lines of logic) to avoid adding a dependency or
 * needing ffprobe on the machine.
 */

/** Bitrates in kbit/s by header index, for the two table layouts we need. */
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
/** Sample rates for MPEG version 1. Versions 2 and 2.5 are a half and a quarter. */
const SAMPLE_RATES_V1 = [44100, 48000, 32000];

export function mp3DurationSeconds(file: Buffer): number {
  let position = 0;

  // Skip the ID3v2 tag (title, artist and so on) if the file starts with one.
  // Its size is stored in 4 bytes that use only 7 bits each.
  if (file.subarray(0, 3).toString("latin1") === "ID3") {
    const size = (file[6] << 21) | (file[7] << 14) | (file[8] << 7) | file[9];
    position = 10 + size;
  }

  let seconds = 0;
  while (position + 4 <= file.length) {
    const header = file.readUInt32BE(position);
    // A frame header starts with 11 set bits. Anything else is padding or a
    // trailing tag, so step forward one byte and look again.
    if (header >>> 21 !== 0x7ff) {
      position += 1;
      continue;
    }
    const versionBits = (header >>> 19) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (header >>> 17) & 3; // 1 = Layer III
    const bitrateIndex = (header >>> 12) & 15;
    const sampleRateIndex = (header >>> 10) & 3;
    const padding = (header >>> 9) & 1;

    // Only Layer III (which is what "mp3" means) is supported. Invalid
    // values mean this was not a real header: step on.
    if (layerBits !== 1 || versionBits === 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      position += 1;
      continue;
    }

    const isV1 = versionBits === 3;
    const sampleRate = SAMPLE_RATES_V1[sampleRateIndex] / (isV1 ? 1 : versionBits === 2 ? 2 : 4);
    const bitrate = (isV1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] * 1000;
    const samples = isV1 ? 1152 : 576;
    const frameBytes = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;

    seconds += samples / sampleRate;
    position += frameBytes;
  }
  return seconds;
}
