/** Pure-JavaScript fixtures for the complete user-journey smoke suite. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SOURCE = join(ROOT, "src", "test", "fixtures");
const OUTPUT = join(ROOT, ".scratch", "e2e-smoke-quality", "fixtures");
const encoder = new TextEncoder();

const IDS = {
  line: "00000000-0000-7000-8000-000000000201",
  note: "00000000-0000-7000-8000-000000000202",
  event: "00000000-0000-7000-8000-000000000203",
};

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc32(contents), true);
    localView.setUint32(18, contents.length, true);
    localView.setUint32(22, contents.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localParts.push(local, contents);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc32(contents), true);
    centralView.setUint32(20, contents.length, true);
    centralView.setUint32(24, contents.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + contents.length;
  }

  const directoryOffset = offset;
  const directory = concat(centralParts);
  const trailer = new Uint8Array(22);
  const trailerView = new DataView(trailer.buffer);
  trailerView.setUint32(0, 0x06054b50, true);
  trailerView.setUint16(8, entries.length, true);
  trailerView.setUint16(10, entries.length, true);
  trailerView.setUint32(12, directory.length, true);
  trailerView.setUint32(16, directoryOffset, true);
  return concat([...localParts, directory, trailer]);
}

/**
 * A PE package chart: the PhiEdit command text a PE package stores beside its
 * `info.csv` sheet. Three taps with speed/size continuations and one hold.
 */
const PE_CHART = `175
bp 0.000 120.000
cp 0 0 1024 700
cm 0 0 1 1024 700 1
cd 0 0 0
ca 0 0 255
cv 0 0 17.111
n1 0 1 1024 1 0
# 1.000
& 1.00
n1 0 2 1024 1 0
# 1.000
& 1.00
n1 0 3 1024 2 0
# 1.000
& 1.00
n2 0 4 6 1024 1 0
# 1.000
& 1.00
`;

const PE_INFO = `Chart,Music,Image,Name,Level,Illustrator,Designer
chart.pec,smoke.wav,smoke.png,PE Package Fixture,2,Fixture Artist,Fixture Charter
`;

export function fixturePaths() {
  return {
    json: join(SOURCE, "smoke.json"),
    image: join(SOURCE, "smoke.png"),
    audio: join(SOURCE, "smoke.wav"),
    pez: join(OUTPUT, "smoke.pez"),
    pePackage: join(OUTPUT, "smoke.pe.zip"),
  };
}

export function ensureFixtures() {
  const paths = fixturePaths();
  for (const path of [paths.json, paths.image, paths.audio]) {
    const bytes = readFileSync(path);
    if (bytes.length === 0) {
      throw new Error(`Fixture is empty: ${path}`);
    }
  }
  mkdirSync(OUTPUT, { recursive: true });
  const chart = readFileSync(paths.json);
  const info = encoder.encode(
    [
      "Chart: smoke.json",
      "Song: smoke.wav",
      "Picture: smoke.png",
      "Name: Smoke Fixture",
      "Composer: RPE Redux",
      "Charter: Fixture",
      "Level: 1",
      "",
    ].join("\r\n"),
  );
  const packageBytes = zipStored([
    ["Info.txt", info],
    ["smoke.json", chart],
    ["smoke.png", readFileSync(paths.image)],
    ["smoke.wav", readFileSync(paths.audio)],
  ]);
  writeFileSync(paths.pez, packageBytes);
  // A PE package is an archive with no RPE JSON: the native open must hand it to
  // the external converter, which reads `info.csv` + the PEC chart.
  writeFileSync(
    paths.pePackage,
    zipStored([
      ["info.csv", encoder.encode(PE_INFO)],
      ["chart.pec", encoder.encode(PE_CHART)],
      ["smoke.png", readFileSync(paths.image)],
      ["smoke.wav", readFileSync(paths.audio)],
    ]),
  );
  return paths;
}

export function canonicalChart() {
  const chart = JSON.parse(readFileSync(fixturePaths().json, "utf8"));
  const line = chart.judgeLineList?.[0];
  const note = line?.notes?.[0];
  const event = line?.eventLayers?.[0]?.moveXEvents?.[0];
  if (!line || !note || !event) {
    throw new Error("Canonical fixture must contain a line, note, and moveX event");
  }
  line.id = IDS.line;
  note.id = IDS.note;
  event.id = IDS.event;
  return { chart, ids: { ...IDS } };
}

export function chartSemantics(chart) {
  const lines = chart?.judgeLineList ?? [];
  const notes = lines.flatMap((line) => line?.notes ?? []);
  const events = lines.flatMap((line) => {
    const layers = [...(line?.eventLayers ?? []), line?.extended].filter(Boolean);
    return layers.flatMap((layer) =>
      Object.entries(layer)
        .filter(([key, value]) => key.endsWith("Events") && Array.isArray(value))
        .flatMap(([, value]) => value),
    );
  });
  return {
    name: chart?.META?.name ?? "",
    composer: chart?.META?.composer ?? "",
    charter: chart?.META?.charter ?? "",
    level: chart?.META?.level ?? "",
    lines: lines.length,
    notes: notes.length,
    events: events.length,
    bpmEntries: chart?.BPMList?.length ?? 0,
    resources: [chart?.META?.song, chart?.META?.background].filter(Boolean).sort(),
  };
}
