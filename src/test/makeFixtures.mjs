/**
 * Generates the media and chart fixtures the smoke scripts drive the packaged
 * application with, so no check depends on a chart that happens to be on one
 * machine.
 *
 * The set is one picture, one piece of music, one chart that names both, and a
 * `.pez` package holding all three. Every encoder here is local and
 * dependency-free: a PNG writer (zlib IDAT, CRC32 chunks), a PCM WAV writer, a
 * ZIP writer, and the chart's own JSON. The chart is *built* through
 * `src/core/global/chart/chart.ts` and serialized by `serializeChart`, so the fixture
 * cannot drift from the format the editor reads.
 *
 * `fingerprint.json` records the semantic contract — dimensions, probe pixels,
 * sample rate, tone, duration, note counts — plus a content hash. The checks
 * assert the semantics; the hash is a drift alarm, not a requirement, because
 * the byte output of a compressor is allowed to differ between Node builds.
 *
 * Usage:
 *   node src/test/makeFixtures.mjs           # write fixtures, then verify
 *   node src/test/makeFixtures.mjs --check   # verify existing, write nothing
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, deflateSync, inflateSync } from "node:zlib";

import {
  CURRENT_RPE_VERSION,
  countScoringNotes,
  createChart,
  createEvent,
  createLine,
  createNote,
  parseChart,
  serializeChart,
} from "../core/global/chart/chart.ts";
import { readZip } from "../core/utils/zip.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One picture: four coloured quadrants, four distinct corners, one clear pixel. */
const IMAGE = {
  file: "smoke.png",
  width: 128,
  height: 128,
  quadrants: {
    topLeft: [255, 0, 0, 255],
    topRight: [0, 255, 0, 255],
    bottomLeft: [0, 0, 255, 255],
    bottomRight: [255, 255, 255, 255],
  },
  /** Corners that make a vertical flip visible, because no two share a colour. */
  corners: [
    [0, 0, [255, 255, 0, 255]],
    [127, 0, [0, 255, 255, 255]],
    [0, 127, [255, 0, 255, 255]],
    [127, 127, [255, 255, 255, 255]],
  ],
  transparent: [64, 64],
  /** Samples the checks read back after the editor has decoded the image. */
  probes: [
    { at: [0, 0], rgba: [255, 255, 0, 255] },
    { at: [127, 0], rgba: [0, 255, 255, 255] },
    { at: [0, 127], rgba: [255, 0, 255, 255] },
    { at: [127, 127], rgba: [255, 255, 255, 255] },
    { at: [32, 32], rgba: [255, 0, 0, 255] },
    { at: [96, 32], rgba: [0, 255, 0, 255] },
    { at: [32, 96], rgba: [0, 0, 255, 255] },
    { at: [96, 96], rgba: [255, 255, 255, 255] },
    { at: [64, 64], rgba: [0, 0, 0, 0] },
  ],
};

/**
 * One piece of music. The two tones are chosen so that the sample rate divides
 * by each of them exactly (22050 / 441 = 50, 22050 / 294 = 75), which makes the
 * waveform perfectly periodic: it loops without a click and compresses.
 */
const AUDIO = {
  file: "smoke.wav",
  sampleRate: 22050,
  channels: 2,
  bitsPerSample: 16,
  seconds: 4,
  amplitude: 0.5,
  tones: [441, 294],
};

const CHART = {
  file: "smoke.json",
  name: "Smoke Fixture",
  composer: "RPE Redux",
  charter: "Fixture",
  level: "1",
  lines: 3,
  notes: 6,
  scoringNotes: 5,
  bpmEntries: 2,
};

const PACKAGE = { file: "smoke.pez", info: "Info.txt" };

const CRC_TABLE = Uint32Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/** The same CRC-32 the zip reader carries, kept here so the writers share one table. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// --- PNG --------------------------------------------------------------------

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(encoder.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // not interlaced
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** Reads a PNG back through its chunks, checking every CRC, and returns the pixels. */
function decodePng(png) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [index, byte] of signature.entries()) {
    if (png[index] !== byte) {
      throw new Error(`PNG signature byte ${index} is ${png[index]}, expected ${byte}`);
    }
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let cursor = 8;
  let header = null;
  const idat = [];
  while (cursor < png.length) {
    const length = view.getUint32(cursor);
    const type = decoder.decode(png.subarray(cursor + 4, cursor + 8));
    const body = png.subarray(cursor + 8, cursor + 8 + length);
    const stored = view.getUint32(cursor + 8 + length);
    const actual = crc32(png.subarray(cursor + 4, cursor + 8 + length));
    if (stored !== actual) {
      throw new Error(`PNG chunk ${type} CRC is ${stored}, recomputed ${actual}`);
    }
    if (type === "IHDR") {
      header = {
        width: view.getUint32(cursor + 8),
        height: view.getUint32(cursor + 12),
        depth: body[8],
        colourType: body[9],
      };
    }
    if (type === "IDAT") {
      idat.push(body);
    }
    cursor += 12 + length;
  }
  if (!header) {
    throw new Error("PNG has no IHDR");
  }
  const raw = new Uint8Array(inflateSync(concat(idat)));
  const stride = header.width * 4;
  const pixels = new Uint8Array(stride * header.height);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) {
      throw new Error(`PNG row ${y} uses filter ${filter}, this writer only emits 0`);
    }
    pixels.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
  }
  return { ...header, pixels };
}

function drawImage() {
  const { width, height, quadrants, corners, transparent } = IMAGE;
  const pixels = new Uint8Array(width * height * 4);
  const put = (x, y, rgba) => pixels.set(rgba, (y * width + x) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const quadrant =
        y < height / 2
          ? x < width / 2
            ? quadrants.topLeft
            : quadrants.topRight
          : x < width / 2
            ? quadrants.bottomLeft
            : quadrants.bottomRight;
      put(x, y, quadrant);
    }
  }
  for (const [x, y, rgba] of corners) {
    put(x, y, rgba);
  }
  put(transparent[0], transparent[1], [0, 0, 0, 0]);
  return pixels;
}

// --- WAV --------------------------------------------------------------------

function writeAscii(bytes, offset, text) {
  bytes.set(encoder.encode(text), offset);
}

function encodeWav({ sampleRate, channels, bitsPerSample, seconds, amplitude, tones }) {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const frames = sampleRate * seconds;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(out, 36, "data");
  view.setUint32(40, dataBytes, true);
  let cursor = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const tone of tones) {
      const sample = Math.round(
        amplitude * 32767 * Math.sin((2 * Math.PI * tone * frame) / sampleRate),
      );
      view.setInt16(cursor, sample, true);
      cursor += 2;
    }
  }
  return out;
}

function decodeWav(wav) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (
    decoder.decode(wav.subarray(0, 4)) !== "RIFF" ||
    decoder.decode(wav.subarray(8, 12)) !== "WAVE"
  ) {
    throw new Error("WAV is missing its RIFF/WAVE header");
  }
  const header = {
    format: view.getUint16(20, true),
    channelCount: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
  const frames = header.dataBytes / (header.channelCount * (header.bitsPerSample / 8));
  // Samples come back as ±1 floats, the shape `decodeAudioData` hands the app.
  const samples = Array.from({ length: header.channelCount }, () => new Float64Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < header.channelCount; channel++) {
      samples[channel][frame] =
        view.getInt16(44 + (frame * header.channelCount + channel) * 2, true) / 32768;
    }
  }
  return { ...header, frames, samples };
}

/**
 * Energy at one frequency, normalized by the sample count, so a sine of
 * amplitude A reads about A/2. Proves the tone is where it was written rather
 * than only that samples exist.
 */
function goertzel(samples, sampleRate, hz) {
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sampleRate);
  let previous = 0;
  let older = 0;
  for (const sample of samples) {
    const current = sample + coefficient * previous - older;
    older = previous;
    previous = current;
  }
  const power = previous * previous + older * older - coefficient * previous * older;
  return Math.sqrt(Math.max(power, 0)) / samples.length;
}

// --- ZIP --------------------------------------------------------------------

/** Minimal ZIP writer: deflate each entry, or store it when deflate would grow it. */
function encodeZip(entries) {
  const records = [];
  const directories = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const nameBytes = encoder.encode(name);
    const compressed = deflateRawSync(contents, { level: 9 });
    const deflated = compressed.length < contents.length;
    const payload = deflated ? compressed : contents;
    const method = deflated ? 8 : 0;
    const checksum = crc32(contents);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x800, true); // names are UTF-8
    localView.setUint16(8, method, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, contents.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, payload.length, true);
    centralView.setUint32(24, contents.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    records.push(local, payload);
    directories.push(central);
    offset += local.length + payload.length;
  }
  const directorySize = directories.reduce((sum, entry) => sum + entry.length, 0);
  const trailer = new Uint8Array(22);
  const trailerView = new DataView(trailer.buffer);
  trailerView.setUint32(0, 0x06054b50, true);
  trailerView.setUint16(8, entries.length, true);
  trailerView.setUint16(10, entries.length, true);
  trailerView.setUint32(12, directorySize, true);
  trailerView.setUint32(16, offset, true);
  return concat([...records, ...directories, trailer]);
}

// --- chart ------------------------------------------------------------------

/**
 * The fixture chart. Built from the editor's own constructors and serialized by
 * the editor's own writer, so `assertChart` and `TempoMap` have already accepted
 * it before it reaches disk. Names are set explicitly: the factories default to
 * translated text, which would make the file depend on the active language.
 */
function buildChart() {
  const chart = createChart();
  chart.META.RPEVersion = CURRENT_RPE_VERSION;
  chart.META.name = CHART.name;
  chart.META.composer = CHART.composer;
  chart.META.charter = CHART.charter;
  chart.META.level = CHART.level;
  chart.META.illustration = "Fixture Illustrator";
  chart.META.song = AUDIO.file;
  chart.META.background = IMAGE.file;
  chart.META.offset = 0;
  chart.BPMList = [
    { bpm: 120, startTime: [0, 0, 1] },
    { bpm: 240, startTime: [4, 0, 1] },
  ];
  chart.judgeLineGroup = ["Default"];

  const lines = [createLine("Line 1"), createLine("Line 2"), createLine("Line 3")];
  lines[0].notes = [
    createNote(1, 0, -0.5), // Tap
    createNote(2, 1, 0, 3), // Hold spanning beats 1..3, so it does not score
    createNote(3, 2, 0.5), // Flick
    createNote(4, 3, 0), // Drag
  ];
  lines[1].notes = [createNote(1, 0.5, 0.25), createNote(1, 1.5, -0.25)];
  lines[2].notes = [];
  lines.forEach((line, index) => {
    line.Name = `Line ${index + 1}`;
    line.Group = 0;
    line.zOrder = index;
    line.numOfNotes = countScoringNotes(line.notes);
  });
  lines[0].eventLayers[0].moveXEvents = [createEvent(0, 100, 0, 4)];

  chart.judgeLineList = lines;
  return chart;
}

function buildInfo() {
  return [
    `Chart: ${CHART.file}`,
    `Song: ${AUDIO.file}`,
    `Picture: ${IMAGE.file}`,
    `Name: ${CHART.name}`,
    `Composer: ${CHART.composer}`,
    `Charter: ${CHART.charter}`,
    `Level: ${CHART.level}`,
    "",
  ].join("\r\n");
}

// --- verification -----------------------------------------------------------

function verifyImage(png) {
  const decoded = decodePng(png);
  const problems = [];
  if (decoded.width !== IMAGE.width || decoded.height !== IMAGE.height) {
    problems.push(
      `size ${decoded.width}x${decoded.height}, expected ${IMAGE.width}x${IMAGE.height}`,
    );
  }
  if (decoded.depth !== 8 || decoded.colourType !== 6) {
    problems.push(`depth ${decoded.depth} colour type ${decoded.colourType}, expected 8 / 6`);
  }
  const read = (x, y) => [
    ...decoded.pixels.subarray((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 4),
  ];
  for (const probe of IMAGE.probes) {
    const [x, y] = probe.at;
    const actual = read(x, y);
    if (actual.join() !== probe.rgba.join()) {
      problems.push(`pixel (${x}, ${y}) is [${actual}], expected [${probe.rgba}]`);
    }
  }
  return { problems, decoded };
}

function verifyAudio(wav) {
  const decoded = decodeWav(wav);
  const problems = [];
  if (decoded.format !== 1) {
    problems.push(`format ${decoded.format}, expected 1 (PCM)`);
  }
  if (decoded.channelCount !== AUDIO.channels) {
    problems.push(`${decoded.channelCount} channels, expected ${AUDIO.channels}`);
  }
  if (decoded.sampleRate !== AUDIO.sampleRate) {
    problems.push(`sample rate ${decoded.sampleRate}, expected ${AUDIO.sampleRate}`);
  }
  if (decoded.frames !== AUDIO.sampleRate * AUDIO.seconds) {
    problems.push(`${decoded.frames} frames, expected ${AUDIO.sampleRate * AUDIO.seconds}`);
  }
  let peak = 0;
  for (const channel of decoded.samples) {
    for (const sample of channel) {
      peak = Math.max(peak, Math.abs(sample));
    }
  }
  if (peak < 0.48 || peak > 0.5) {
    problems.push(`peak ${peak.toFixed(4)}, expected between 0.48 and 0.5`);
  }
  const [left, right] = decoded.samples;
  const energy = {
    leftAt441: goertzel(left, decoded.sampleRate, AUDIO.tones[0]),
    leftAt294: goertzel(left, decoded.sampleRate, AUDIO.tones[1]),
    rightAt441: goertzel(right, decoded.sampleRate, AUDIO.tones[0]),
    rightAt294: goertzel(right, decoded.sampleRate, AUDIO.tones[1]),
  };
  for (const [channel, name, index] of [
    [left, "left", 0],
    [right, "right", 1],
  ]) {
    const own = goertzel(channel, decoded.sampleRate, AUDIO.tones[index]);
    const other = goertzel(channel, decoded.sampleRate, AUDIO.tones[1 - index]);
    if (!(own > 0.2 && own < 0.3)) {
      problems.push(
        `${name} channel energy at ${AUDIO.tones[index]} Hz is ${own.toFixed(4)}, expected 0.2..0.3`,
      );
    }
    if (!(own > other * 20)) {
      problems.push(
        `${name} channel does not favour ${AUDIO.tones[index]} Hz: ${own.toFixed(4)} vs ${other.toFixed(4)}`,
      );
    }
  }
  return { problems, decoded, energy, peak };
}

function verifyChart(text) {
  const problems = [];
  const chart = parseChart(text);
  const lines = chart.judgeLineList ?? [];
  const notes = lines.flatMap((line) => line.notes ?? []);
  const scoring = countScoringNotes(notes);
  if (lines.length !== CHART.lines) {
    problems.push(`${lines.length} lines, expected ${CHART.lines}`);
  }
  if (notes.length !== CHART.notes) {
    problems.push(`${notes.length} notes, expected ${CHART.notes}`);
  }
  if (scoring !== CHART.scoringNotes) {
    problems.push(`${scoring} scoring notes, expected ${CHART.scoringNotes}`);
  }
  if (chart.BPMList.length !== CHART.bpmEntries) {
    problems.push(`${chart.BPMList.length} BPM entries, expected ${CHART.bpmEntries}`);
  }
  if (chart.META.song !== AUDIO.file || chart.META.background !== IMAGE.file) {
    problems.push(`META names ${chart.META.song} / ${chart.META.background}`);
  }
  return { problems, chart, lines: lines.length, notes: notes.length, scoring };
}

async function verifyPackage(pez, expected) {
  const problems = [];
  const files = await readZip(pez);
  for (const name of [PACKAGE.info, CHART.file, IMAGE.file, AUDIO.file]) {
    if (!files.has(name)) {
      problems.push(`package is missing ${name}`);
    }
  }
  if (files.size !== 4) {
    problems.push(`package holds ${files.size} entries, expected 4`);
  }
  const chartText = files.has(CHART.file) ? decoder.decode(files.get(CHART.file)) : "";
  const png = files.get(IMAGE.file);
  const wav = files.get(AUDIO.file);
  if (
    chartText &&
    sha256(encoder.encode(chartText)) !== sha256(encoder.encode(expected.chartText))
  ) {
    problems.push("packaged chart differs from the standalone chart");
  }
  if (png && sha256(png) !== sha256(expected.png)) {
    problems.push("packaged image differs from the standalone image");
  }
  if (wav && sha256(wav) !== sha256(expected.wav)) {
    problems.push("packaged audio differs from the standalone audio");
  }
  return { problems, names: [...files.keys()] };
}

// --- main -------------------------------------------------------------------

async function main() {
  const check = process.argv.includes("--check");

  const pixels = drawImage();
  const png = encodePng(IMAGE.width, IMAGE.height, pixels);
  const wav = encodeWav(AUDIO);
  const chartText = serializeChart(buildChart());
  if (chartText.includes("\r\n")) {
    throw new Error("serializeChart returned CRLF; the fixture must be LF");
  }
  const chartBytes = encoder.encode(chartText);
  const infoBytes = encoder.encode(buildInfo());
  const pez = encodeZip([
    [PACKAGE.info, infoBytes],
    [CHART.file, chartBytes],
    [IMAGE.file, png],
    [AUDIO.file, wav],
  ]);

  if (!check) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(join(FIXTURES, IMAGE.file), png);
    writeFileSync(join(FIXTURES, AUDIO.file), wav);
    writeFileSync(join(FIXTURES, CHART.file), chartText);
    writeFileSync(join(FIXTURES, PACKAGE.file), pez);
  } else {
    for (const name of [IMAGE.file, AUDIO.file, CHART.file, PACKAGE.file]) {
      const onDisk = readFileSync(join(FIXTURES, name));
      const regenerated = {
        [IMAGE.file]: png,
        [AUDIO.file]: wav,
        [CHART.file]: chartBytes,
        [PACKAGE.file]: pez,
      }[name];
      const drift =
        sha256(onDisk) === sha256(regenerated) ? "identical" : "differs (a compressor may differ)";
      console.log(`  ${name.padEnd(12)} ${onDisk.length} bytes on disk, ${drift}`);
    }
  }

  const image = verifyImage(png);
  const audio = verifyAudio(wav);
  const chart = verifyChart(chartText);
  const pkg = await verifyPackage(pez, { chartText, png, wav });

  const problems = [
    ...image.problems.map((entry) => `image: ${entry}`),
    ...audio.problems.map((entry) => `audio: ${entry}`),
    ...chart.problems.map((entry) => `chart: ${entry}`),
    ...pkg.problems.map((entry) => `package: ${entry}`),
  ];

  const fingerprint = {
    generatedBy: "src/test/makeFixtures.mjs",
    contract: "Assert the semantics below. Hashes are a drift alarm, not a requirement.",
    image: {
      file: IMAGE.file,
      width: IMAGE.width,
      height: IMAGE.height,
      probes: IMAGE.probes.map((probe) => ({ at: probe.at, rgba: probe.rgba })),
      bytes: png.length,
      sha256: sha256(png),
    },
    audio: {
      file: AUDIO.file,
      sampleRate: AUDIO.sampleRate,
      channels: AUDIO.channels,
      bitsPerSample: AUDIO.bitsPerSample,
      frames: AUDIO.sampleRate * AUDIO.seconds,
      durationSeconds: AUDIO.seconds,
      tones: AUDIO.tones,
      peak: audio.peak,
      energy: Object.fromEntries(
        Object.entries(audio.energy).map(([key, value]) => [key, Number(value.toFixed(4))]),
      ),
      bytes: wav.length,
      sha256: sha256(wav),
    },
    chart: {
      file: CHART.file,
      lines: chart.lines,
      notes: chart.notes,
      scoringNotes: chart.scoring,
      bpmEntries: CHART.bpmEntries,
      song: AUDIO.file,
      background: IMAGE.file,
      sha256: sha256(chartBytes),
    },
    package: {
      file: PACKAGE.file,
      entries: pkg.names,
      bytes: pez.length,
      sha256: sha256(pez),
    },
  };

  if (!check) {
    writeFileSync(join(FIXTURES, "fingerprint.json"), `${JSON.stringify(fingerprint, null, 2)}\n`);
  }

  console.log(`${check ? "Verifying" : "Wrote"} fixtures in ${FIXTURES}`);
  console.log(`  ${IMAGE.file}  ${IMAGE.width}x${IMAGE.height} RGBA, ${png.length} bytes`);
  console.log(
    `  ${AUDIO.file}  ${AUDIO.channels}ch ${AUDIO.sampleRate} Hz ${AUDIO.bitsPerSample}-bit ` +
      `${AUDIO.seconds}s, tones ${AUDIO.tones.join(" / ")} Hz, peak ${audio.peak.toFixed(4)}, ` +
      `${wav.length} bytes`,
  );
  console.log(
    `  ${CHART.file}  ${chart.lines} lines, ${chart.notes} notes (${chart.scoring} scoring), ` +
      `${CHART.bpmEntries} BPM entries, ${chartBytes.length} bytes`,
  );
  console.log(`  ${PACKAGE.file}  ${pkg.names.length} entries, ${pez.length} bytes`);

  if (problems.length) {
    console.error("\nFAILED");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("\nAll fixtures verified.");
}

await main();
