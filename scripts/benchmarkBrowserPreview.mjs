/** Runs the real browser preview path against supplied PEZ charts through CDP. */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { unzipSync } from "fflate";
import {
  reservePort,
  waitForTarget,
  CdpClient,
  terminateProcess,
} from "../src/test/cdpHarness.mjs";

const DEFAULT_CHARTS = [
  "E:\\games\\mug\\phigros\\charts\\rbQ1030.pez",
  "E:\\games\\mug\\phigros\\charts\\RPG.pez",
  "E:\\games\\mug\\phigros\\charts\\big song (self insert).pez",
];
const args = process.argv.slice(2);
const durationMs = Number(args.find((value) => value.startsWith("--duration="))?.slice(11) ?? 2500);
const startSeconds = Number(
  args.find((value) => value.startsWith("--start-seconds="))?.slice(16) ?? 12,
);
const jsonOnly = args.includes("--json-only");
const compactOutput = args.includes("--compact");
const callbackProfile = args.includes("--callback-profile");
const muteAudio = !args.includes("--unmuted");
const cpuProfileEnabled = args.includes("--cpu-profile");
const crudOnly = args.includes("--crud-only");
const normalOnly = args.includes("--normal-only");
const multiLineOnly = args.includes("--multi-line-only");
const crudNoMultiLine = args.includes("--crud-no-multi-line");
const crudVisualOnly = args.includes("--crud-visual-only");
const splitMultiLine = args.includes("--split-multi-line");
const marqueeStress = args.includes("--marquee-stress");
const nativeMarquee = args.includes("--native-marquee");
const verbose = args.includes("--verbose");
const disableGpu = args.includes("--disable-gpu");
const softwareOnly = args.includes("--software-only");
const lineLabelsArgument = args.find((value) => value.startsWith("--line-labels="));
const lineLabels = lineLabelsArgument ? lineLabelsArgument.slice(14) !== "off" : null;
const multiLineCount = Number(
  args.find((value) => value.startsWith("--multi-line-count="))?.slice(19) ?? 0,
);
const files = args.filter((value) => !value.startsWith("--"));
const charts = files.length ? files : DEFAULT_CHARTS;
const frontendPort = Number(process.env.REDUX_FRONTEND_PORT ?? 47188);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function percentile(values, fraction) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summary(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: percentile(values, 1),
    avg: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
  };
}

function timingSummary(samples, field) {
  return summary(samples.map((sample) => Number(sample[field] ?? 0)).filter(Number.isFinite));
}

let lastChartOpenMs = 0;
let lastOpenStages = [];

/** Summarize sampled JavaScript self time without emitting the full CDP profile. */
function summarizeCpuProfile(profile) {
  if (!profile) {
    return null;
  }
  const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of nodes.values()) {
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }
  const frameName = (nodeId) => {
    const frame = nodes.get(nodeId)?.callFrame ?? {};
    return frame.functionName || "(anonymous)";
  };
  const stackFor = (nodeId) => {
    const stack = [];
    let current = nodeId;
    for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
      stack.push(frameName(current));
      current = parents.get(current);
    }
    return stack;
  };
  const selfTime = new Map();
  for (let index = 0; index < (profile.samples ?? []).length; index += 1) {
    const nodeId = profile.samples[index];
    selfTime.set(nodeId, (selfTime.get(nodeId) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  return [...selfTime.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15)
    .map(([nodeId, microseconds]) => {
      const frame = nodes.get(nodeId)?.callFrame ?? {};
      return {
        functionName: frame.functionName || "(anonymous)",
        url: frame.url || "",
        lineNumber: frame.lineNumber ?? 0,
        columnNumber: frame.columnNumber ?? 0,
        milliseconds: Number((microseconds / 1000).toFixed(3)),
        stack: stackFor(nodeId),
      };
    });
}

/** Aggregate CDP sampling-profile time by the deepest recorded JS frame. */
/** Read cumulative browser main-thread metrics exposed by CDP. */
async function performanceMetrics(client) {
  const response = await client.command("Performance.getMetrics");
  return Object.fromEntries(
    (response.metrics ?? [])
      .filter((entry) =>
        [
          "TaskDuration",
          "ScriptDuration",
          "LayoutDuration",
          "RecalcStyleDuration",
          "PaintDuration",
          "RasterTaskDuration",
          "LayoutCount",
          "RecalcStyleCount",
        ].includes(entry.name),
      )
      .map((entry) => [entry.name, entry.value]),
  );
}

/** Subtract cumulative CDP metrics so one scenario has an isolated sample. */
function metricDelta(before, after) {
  return Object.fromEntries(
    Object.keys(after).map((key) => [key, Number((after[key] - (before[key] ?? 0)).toFixed(4))]),
  );
}

function createChartServer(paths, chartJsonOnly) {
  const entries = paths.map((path) => {
    const source = readFileSync(path);
    if (!chartJsonOnly || source.toString("ascii", 0, 2) !== "PK") {
      return { bytes: source, name: basename(path) };
    }
    const json = Object.entries(unzipSync(new Uint8Array(source))).find(([name]) =>
      /\.json$/i.test(name),
    );
    if (!json) {
      throw new Error(`No JSON chart entry found in ${path}`);
    }
    return {
      bytes: Buffer.from(json[1]),
      name: `${basename(path).replace(/\.[^.]+$/u, "")}.json`,
    };
  });
  const server = createServer((request, response) => {
    const match = /^\/chart\/(\d+)$/.exec(request.url ?? "");
    if (!match || !entries[Number(match[1])]) {
      response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/octet-stream",
      "Content-Length": entries[Number(match[1])].bytes.byteLength,
      "Cache-Control": "no-store",
    });
    response.end(entries[Number(match[1])].bytes);
  });
  return {
    server,
    listen: () =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolvePromise(typeof address === "object" && address ? address.port : 0);
        });
      }),
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, { flag: "r" });
      return candidate;
    } catch {
      // Continue to the next conventional installation path.
    }
  }
  throw new Error("Chrome was not found; set CHROME_PATH to a Chromium executable.");
}

async function evaluate(client, expression, timeoutMs = 10000) {
  return client.evaluate(expression, { timeoutMs });
}

async function waitForRedux(client) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await evaluate(
      client,
      "({redux:typeof window.redux, document:typeof window.redux==='object' && window.redux.document ? window.redux.document.state() : null})",
    );
    if (state.redux === "object") {
      return state;
    }
    await sleep(100);
  }
  throw new Error("window.redux did not become available in the browser bundle");
}

/** Wait until the lazy editor provider has bound the document API. */
async function waitForDocumentRuntime(client) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const availability = await evaluate(client, "window.redux.document.availability()");
    if (availability?.status === "available") {
      return availability;
    }
    await sleep(100);
  }
  const diagnostics = await evaluate(
    client,
    `(()=>({availability:window.redux.document.availability(),body:(document.body?.innerText??'').slice(0,1000),app:document.querySelector('.redux-app-shell')?.getAttribute('data-at-home')??null,startup:document.querySelector('[role=alert]')?.innerText??null}))()`,
  );
  throw new Error(
    `window.redux document runtime did not become available: ${JSON.stringify(diagnostics)}`,
  );
}

async function loadChart(client, port, index, path) {
  const started = performance.now();
  const inputName = jsonOnly ? `${basename(path).replace(/\.[^.]+$/u, "")}.json` : basename(path);
  const result = await client.callFunction(
    `async function(chartPort, chartIndex, chartName) {
      if (!Number.isInteger(chartPort) || chartPort < 1 || chartPort > 65535) {
        throw new Error("Invalid benchmark chart server port");
      }
      if (!Number.isInteger(chartIndex) || chartIndex < 0) {
        throw new Error("Invalid benchmark chart index");
      }
      const chartUrl = new URL("/chart/" + chartIndex, "http://127.0.0.1:" + chartPort);
      const bytes = new Uint8Array(await (await fetch(chartUrl)).arrayBuffer());
      return await window.redux.document.openBytes(bytes, { name: chartName, replace: "discard" });
    }`,
    [port, index, inputName],
    { timeoutMs: 300000 },
  );
  if (!result?.ok) {
    throw new Error(`Unable to open ${path}: ${JSON.stringify(result)}`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await evaluate(client, "window.redux.document.state()", 120_000);
    if (state.status === "open") {
      lastChartOpenMs = performance.now() - started;
      return state;
    }
    await sleep(100);
  }
  throw new Error(`Timed out opening ${path}`);
}

async function setLayout(client, timelineVisible) {
  await evaluate(
    client,
    `(()=>{const v=window.redux.values.byId;v.set('preview-show-notes',${timelineVisible});v.set('preview-show-events',${timelineVisible});v.set('preview-enabled',true);${lineLabels === null ? "" : `v.set('line-numbers',${lineLabels});v.set('line-arrows',${lineLabels});`}window.dispatchEvent(new Event('resize'));return v.snapshot();})()`,
  );
  await sleep(250);
}

/** Select every judge line through the published editor value used by the UI. */
async function prepareMultiLine(client) {
  const result = await evaluate(
    client,
    `(()=>{const lines=window.redux.chart.lines();const count=lines?.value?.length??0;const selectedCount=${multiLineCount > 0 ? Math.trunc(multiLineCount) : "count"};if(count<2)return {count,active:false};window.redux.values.byId.set('editor.lineSelection',Array.from({length:Math.min(count,selectedCount)},(_,index)=>index));window.__REDUX_EDITOR_TEST__?.setMultiLineMerge(${splitMultiLine ? "false" : "true"});return {count,active:true,selectedCount:Math.min(count,selectedCount),split:${splitMultiLine}};})()`,
  );
  if (!result.active) {
    throw new Error(`Multi-line selection needs at least two lines: ${result.count}`);
  }
  await sleep(300);
}

async function startProbe(client) {
  return evaluate(
    client,
    `(()=>{window.__reduxRenderProfile=true;window.__reduxDetailedRenderProfile=${cpuProfileEnabled};window.__benchFrames=[];window.__benchFrameTasks=[];window.__benchPreviews=[];window.__benchRaf=[];window.__benchLongTasks=[];window.__benchCallbackTasks=[];window.__benchEvents=[];window.__benchSessionRenders=[];window.__benchSessionNotifies=[];window.__benchTransactions=[];window.__benchTimelineCache=[];window.__benchPointerPhases=[];window.__benchDocumentLoad=[];window.__reduxFrameTimingProbe=s=>window.__benchFrames.push(s);window.__reduxFrameTaskTimingProbe=s=>window.__benchFrameTasks.push(s);window.__reduxPreviewTimingProbe=s=>window.__benchPreviews.push(s);window.__reduxSessionRenderTimingProbe=s=>window.__benchSessionRenders.push(s);window.__reduxSessionNotifyTimingProbe=s=>window.__benchSessionNotifies.push(s);window.__reduxTransactionTimingProbe=s=>window.__benchTransactions.push(s);window.__reduxTimelineCacheTimingProbe=s=>window.__benchTimelineCache.push(s);window.__reduxDocumentLoadTimingProbe=s=>window.__benchDocumentLoad.push(s);window.__reduxTimelinePointerTimingProbe=(stage,durationMs)=>window.__benchPointerPhases.push({stage,durationMs});if(${callbackProfile}){const track=(kind,callback)=>function(...args){const started=performance.now();try{return callback.apply(this,args);}finally{const duration=performance.now()-started;if(duration>=8)window.__benchCallbackTasks.push({kind,name:callback.name||'anonymous',duration,startTime:started});}};window.__benchOriginalRaf=window.requestAnimationFrame;window.__benchOriginalTimeout=window.setTimeout;window.__benchOriginalInterval=window.setInterval;window.requestAnimationFrame=callback=>window.__benchOriginalRaf.call(window,track('raf',callback));window.setTimeout=(callback,delay,...args)=>window.__benchOriginalTimeout.call(window,typeof callback==='function'?track('timeout',callback):callback,delay,...args);window.setInterval=(callback,delay,...args)=>window.__benchOriginalInterval.call(window,typeof callback==='function'?track('interval',callback):callback,delay,...args);}if(typeof PerformanceObserver==='function'){window.__benchLongTaskObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__benchLongTasks.push({duration:entry.duration,name:entry.name,startTime:entry.startTime,attribution:(entry.attribution??[]).map(item=>({name:item.name,containerType:item.containerType,containerId:item.containerId,containerName:item.containerName}))});});try{window.__benchLongTaskObserver.observe({type:'longtask'});}catch{}window.__benchEventObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__benchEvents.push({name:entry.name,duration:entry.duration,startTime:entry.startTime,interactionId:entry.interactionId||0});});try{window.__benchEventObserver.observe({type:'event',durationThreshold:8,buffered:true});}catch{}}let previous=null;const tick=ts=>{if(window.__benchRafStop)return;if(previous!==null)window.__benchRaf.push(ts-previous);previous=ts;window.requestAnimationFrame(tick)};window.requestAnimationFrame(tick);window.redux.playback.startMeasurement();return true;})()`,
  );
}

async function stopProbe(client) {
  return evaluate(
    client,
    `(()=>{window.__benchRafStop=true;window.__reduxFrameTimingProbe=null;window.__reduxFrameTaskTimingProbe=null;window.__reduxPreviewTimingProbe=null;window.__reduxSessionRenderTimingProbe=null;window.__reduxSessionNotifyTimingProbe=null;window.__reduxTransactionTimingProbe=null;window.__reduxTimelineCacheTimingProbe=null;window.__reduxDocumentLoadTimingProbe=null;window.__reduxTimelinePointerTimingProbe=null;window.__benchLongTaskObserver?.disconnect();window.__benchEventObserver?.disconnect();const frames=window.__benchFrames.splice(0);const frameTasks=window.__benchFrameTasks.splice(0);const previews=window.__benchPreviews.splice(0);const raf=window.__benchRaf.splice(0);const longTasks=window.__benchLongTasks.splice(0);const callbackTasks=window.__benchCallbackTasks.splice(0);const events=window.__benchEvents.splice(0);const sessionRenders=window.__benchSessionRenders.splice(0);const sessionNotifies=window.__benchSessionNotifies.splice(0);const transactions=window.__benchTransactions.splice(0);const timelineCache=window.__benchTimelineCache.splice(0);const pointerPhases=window.__benchPointerPhases.splice(0);const documentLoad=window.__benchDocumentLoad.splice(0);const crudTimes=window.__benchCrudTimes??null;window.__benchCrudTimes=null;if(window.__benchOriginalRaf){window.requestAnimationFrame=window.__benchOriginalRaf;window.setTimeout=window.__benchOriginalTimeout;window.setInterval=window.__benchOriginalInterval;window.__benchOriginalRaf=null;window.__benchOriginalTimeout=null;window.__benchOriginalInterval=null;}const metrics=window.redux.playback.stopMeasurement();return {raf,frames,frameTasks,previews,longTasks,callbackTasks,events,sessionRenders,sessionNotifies,transactions,timelineCache,pointerPhases,documentLoad,crudTimes,metrics,gpu:(()=>{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webgl2:Boolean(gl.getParameter(gl.VERSION).includes('WebGL 2'))};})()};})()`,
  );
}

async function startPlayback(client, durationSeconds) {
  if (Number.isFinite(startSeconds) && startSeconds > 0) {
    await evaluate(client, `(()=>{window.redux.playback.seek(${startSeconds});return true;})()`);
  }
  const result = await evaluate(client, "(()=>{window.redux.playback.play();return true;})()");
  const playing = await evaluate(client, "window.redux.playback.state()");
  if (playing?.value?.playing || playing?.value?.isPlaying) {
    return { result, mode: "playback" };
  }
  await evaluate(
    client,
    `(async()=>{window.__benchManualStop=false;let t=${Number.isFinite(startSeconds) ? Math.max(0, startSeconds) : 0};window.__benchManualTimer=setInterval(()=>{if(window.__benchManualStop){clearInterval(window.__benchManualTimer);return;}t+=0.016;if(t>${Math.max(0.1, durationSeconds)})t=0;window.redux.playback.seek(t);},16);})()`,
  );
  return { result, mode: "manual-seek-fallback" };
}

async function stopPlayback(client) {
  await evaluate(
    client,
    `(()=>{window.__benchManualStop=true;if(window.__benchManualTimer)clearInterval(window.__benchManualTimer);window.redux.playback.pause();return true;})()`,
  );
}

async function startCrudAndSelection(client) {
  return evaluate(
    client,
    `(()=>{const api=window.redux;const first=api.chart.read('notes',{limit:1}).value?.items?.[0];const line=first?.lineIndex??0;let toggle=false;let inserted=null;const canvas=document.getElementById('notes');window.__benchCrudTimes={selection:[],update:[],insertDelete:[],pointerDown:[],pointerMove:[],pointerUp:[],cleanup:[]};const timed=(key,fn)=>{const start=performance.now();try{return fn();}finally{window.__benchCrudTimes[key].push(performance.now()-start);}};const drag=()=>{if(${nativeMarquee}||!canvas||window.__benchDrag)return;const rect=canvas.getBoundingClientRect();const common={bubbles:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:0,buttons:1,shiftKey:true};const start={...common,clientX:rect.left+rect.width*.15,clientY:rect.top+rect.height*.25};const end={...common,clientX:rect.left+rect.width*.8,clientY:rect.top+rect.height*.75};const moveCount=${marqueeStress ? 16 : 1};const moveDelay=${marqueeStress ? 8 : 45};window.__benchDrag=true;timed('pointerDown',()=>canvas.dispatchEvent(new PointerEvent('pointerdown',start)));let step=0;const move=()=>{step+=1;const progress=step/moveCount;const point={...common,clientX:start.clientX+(end.clientX-start.clientX)*progress,clientY:start.clientY+(end.clientY-start.clientY)*progress};timed('pointerMove',()=>canvas.dispatchEvent(new PointerEvent('pointermove',point)));if(step<moveCount){setTimeout(move,moveDelay);return;}setTimeout(()=>{timed('pointerUp',()=>canvas.dispatchEvent(new PointerEvent('pointerup',{...end,buttons:0,shiftKey:true})));window.__benchDrag=false;},90);};setTimeout(move,${marqueeStress ? 8 : 45});};window.__benchCrudStop=false;window.__benchCrudTimer=setInterval(()=>{if(window.__benchCrudStop){clearInterval(window.__benchCrudTimer);return;}toggle=!toggle;drag();timed('selection',()=>{try{api.selection.notes.range({lineIndex:line,from:{beat:0,positionX:-1},to:{beat:64,positionX:1},mode:toggle?'replace':'add'});}catch{}});timed('update',()=>{try{if(first)api.transaction.apply({label:'benchmark update',notes:{update:[{id:first.id,patch:{positionX:(first.note.positionX??0)+(toggle?.001:-.001)}}]}});}catch{}});if(!${crudVisualOnly})timed('insertDelete',()=>{try{if(inserted){api.transaction.apply({label:'benchmark delete',notes:{delete:[inserted]}});inserted=null;}else if(first){const note=first.note;const result=api.transaction.apply({label:'benchmark insert',notes:{insert:[{lineIndex:line,note:{type:note.type,startTime:note.startTime,endTime:note.endTime,positionX:(note.positionX??0)+.002}}]}});inserted=result.affectedObjectIds?.at(-1)??null;}}catch{}});},160);return {line,hasNote:Boolean(first),canvas:Boolean(canvas),marqueeStress:${marqueeStress},nativeMarquee:${nativeMarquee},visualOnly:${crudVisualOnly}};})()`,
  );
}

/** Drive a real browser pointer sequence so pointer capture and marquee routing run. */
async function runNativeMarquees(client, duration) {
  const started = Date.now();
  while (Date.now() - started < duration) {
    const rect = await evaluate(
      client,
      "(()=>{const canvas=document.getElementById('notes');if(!canvas)return null;const r=canvas.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()",
    );
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const start = { x: rect.left + rect.width * 0.15, y: rect.top + rect.height * 0.25 };
    const end = { x: rect.left + rect.width * 0.8, y: rect.top + rect.height * 0.75 };
    await client.command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: start.x,
      y: start.y,
      button: "left",
      buttons: 1,
      modifiers: 8,
      clickCount: 1,
    });
    const moveCount = marqueeStress ? 16 : 4;
    for (let step = 1; step <= moveCount; step += 1) {
      await sleep(marqueeStress ? 8 : 20);
      const progress = step / moveCount;
      await client.command("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        button: "none",
        buttons: 1,
        modifiers: 8,
      });
    }
    await client.command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: end.x,
      y: end.y,
      button: "left",
      buttons: 0,
      modifiers: 8,
      clickCount: 1,
    });
    await sleep(120);
  }
}

async function stopCrudAndSelection(client) {
  await evaluate(
    client,
    "(()=>{window.__benchCrudStop=true;if(window.__benchCrudTimer)clearInterval(window.__benchCrudTimer);const started=performance.now();const result=window.redux.selection.clear('all');window.__benchCrudTimes?.cleanup.push(performance.now()-started);return result;})()",
  );
}

async function runScenario(client, port, path, chartIndex, scenario) {
  if (verbose) {
    console.error("benchmark: setLayout");
  }
  await setLayout(client, scenario.timeline);
  if (scenario.multiLine) {
    if (verbose) {
      console.error("benchmark: prepareMultiLine");
    }
    await prepareMultiLine(client);
  }
  if (verbose) {
    console.error("benchmark: metrics/chart");
  }
  const metricsBefore = await performanceMetrics(client);
  const metadata = await evaluate(client, "window.redux.chart.metadata()");
  const duration = Number(metadata?.ok ? (metadata.value?.duration ?? 30) : 30);
  if (cpuProfileEnabled) {
    await client.command("Profiler.enable");
  }
  if (verbose) {
    console.error("benchmark: startProbe");
  }
  const probe = await startProbe(client);
  if (verbose) {
    console.error("benchmark: startPlayback");
  }
  const playback = await startPlayback(client, duration);
  if (scenario.crud) {
    if (verbose) {
      console.error("benchmark: startCrud");
    }
    await startCrudAndSelection(client);
  }
  const nativeMarqueeTask =
    scenario.crud && nativeMarquee ? runNativeMarquees(client, durationMs) : null;
  if (cpuProfileEnabled) {
    await client.command("Profiler.start", { samplingInterval: 1000 });
  }
  await sleep(durationMs);
  if (nativeMarqueeTask) {
    await nativeMarqueeTask;
  }
  if (scenario.crud) {
    await stopCrudAndSelection(client);
  }
  const captured = await stopProbe(client);
  const cpuProfile = cpuProfileEnabled ? (await client.command("Profiler.stop")).profile : null;
  await stopPlayback(client);
  const metricsAfter = await performanceMetrics(client);
  return {
    chart: path,
    openMs: lastChartOpenMs,
    scenario: scenario.name,
    playbackMode: playback.mode,
    timeline: scenario.timeline,
    crudAndSelection: scenario.crud,
    multiLine: Boolean(scenario.multiLine),
    multiLineSplit: Boolean(scenario.multiLine && splitMultiLine),
    frameIntervalMs: summary(captured.raf),
    longTasks: captured.longTasks.sort((left, right) => right.duration - left.duration).slice(0, 5),
    events: captured.events.sort((left, right) => right.duration - left.duration).slice(0, 12),
    openStages: lastOpenStages,
    callbackTasks: captured.callbackTasks
      .sort((left, right) => right.duration - left.duration)
      .slice(0, 8),
    browserMetrics: metricDelta(metricsBefore, metricsAfter),
    sessionRender: timingSummary(captured.sessionRenders, "durationMs"),
    sessionRenderStages: Object.fromEntries(
      ["dataMs", "readoutsMs", "panelsMs", "selectionMs", "invalidateMs"].map((field) => [
        field,
        timingSummary(captured.sessionRenders, field),
      ]),
    ),
    sessionNotify: timingSummary(captured.sessionNotifies, "durationMs"),
    transaction: Object.fromEntries(
      ["plan", "commit"].map((stage) => [
        stage,
        timingSummary(
          captured.transactions.filter((sample) => sample.stage === stage),
          "durationMs",
        ),
      ]),
    ),
    transactionPhases: Object.fromEntries(
      [...new Set(captured.transactions.map((sample) => sample.stage))]
        .filter((stage) => stage !== "plan" && stage !== "commit")
        .map((stage) => [
          stage,
          timingSummary(
            captured.transactions.filter((sample) => sample.stage === stage),
            "durationMs",
          ),
        ]),
    ),
    frameTask: Object.fromEntries(
      [
        "clockMs",
        "autosaveMs",
        "drawMs",
        "progressMs",
        "readoutsMs",
        "performanceMs",
        "scheduleMs",
        "totalMs",
      ].map((field) => [field, timingSummary(captured.frameTasks, field)]),
    ),
    crud: captured.crudTimes
      ? Object.fromEntries(
          Object.entries(captured.crudTimes).map(([key, values]) => [key, summary(values)]),
        )
      : null,
    pointerPhases: Object.fromEntries(
      [...new Set(captured.pointerPhases.map((sample) => sample.stage))].map((stage) => [
        stage,
        summary(
          captured.pointerPhases
            .filter((sample) => sample.stage === stage)
            .map((sample) => sample.durationMs),
        ),
      ]),
    ),
    timelineCache: Object.fromEntries(
      [...new Set(captured.timelineCache.map((sample) => sample.mode))].map((mode) => [
        mode,
        timingSummary(
          captured.timelineCache.filter((sample) => sample.mode === mode),
          "durationMs",
        ),
      ]),
    ),
    frame: {
      total: timingSummary(captured.frames, "totalMs"),
      timeline: timingSummary(captured.frames, "timelineMs"),
      timelineDraw: timingSummary(captured.frames, "timelineDrawMs"),
      multiEditTimeline: timingSummary(captured.frames, "multiEditTimelineMs"),
      audioAnalysis: timingSummary(captured.frames, "audioAnalysisMs"),
      preview: timingSummary(captured.frames, "previewMs"),
      selection: timingSummary(captured.frames, "selectionMs"),
    },
    timelineLayout: captured.frames[0]
      ? {
          lineCount: captured.frames[0].timelineLineCount,
          targetLineCount: captured.frames[0].timelineTargetLineCount,
          panelCount: captured.frames[0].timelinePanelCount,
          visiblePanelRange: captured.frames[0].timelineVisiblePanelRange,
        }
      : null,
    preview: {
      total: timingSummary(captured.previews, "totalMs"),
      sceneCompile: timingSummary(captured.previews, "sceneCompileMs"),
      sceneCollections: timingSummary(captured.previews, "sceneCollectionsMs"),
      shaderCompile: timingSummary(captured.previews, "shaderCompileMs"),
      shaderPrewarm: timingSummary(captured.previews, "shaderPrewarmMs"),
      canvasPrepare: timingSummary(captured.previews, "canvasPrepareMs"),
      setup: timingSummary(captured.previews, "setupMs"),
      sample: timingSummary(captured.previews, "sampleMs"),
      visibility: timingSummary(captured.previews, "visibilityMs"),
      visibilityIndex: timingSummary(captured.previews, "visibilityIndexMs"),
      sampledLineCount: timingSummary(captured.previews, "sampledLineCount"),
      staticLineCacheHits: timingSummary(captured.previews, "staticLineCacheHits"),
      continuousLineCount: timingSummary(captured.previews, "continuousLineCount"),
      parentComposeCount: timingSummary(captured.previews, "parentComposeCount"),
      stateCopyCount: timingSummary(captured.previews, "stateCopyCount"),
      eventCursorHits: timingSummary(captured.previews, "eventCursorHits"),
      eventCursorMisses: timingSummary(captured.previews, "eventCursorMisses"),
      notes: timingSummary(captured.previews, "notesMs"),
      effects: timingSummary(captured.previews, "effectsMs"),
      composite: timingSummary(captured.previews, "compositeMs"),
      guide: timingSummary(captured.previews, "guideDrawMs"),
      guideGroups: timingSummary(captured.previews, "guideGroupCount"),
      guideVisibleGroups: timingSummary(captured.previews, "guideVisibleGroupCount"),
      guideTextCacheHits: timingSummary(captured.previews, "guideTextCacheHits"),
      guideTextCacheMisses: timingSummary(captured.previews, "guideTextCacheMisses"),
      guideDrawCalls: timingSummary(captured.previews, "guideDrawCalls"),
      guideRenderPaths: Object.fromEntries(
        [...new Set(captured.previews.map((sample) => sample.guideRenderPath ?? "unknown"))].map(
          (pathName) => [
            pathName,
            captured.previews.filter((sample) => sample.guideRenderPath === pathName).length,
          ],
        ),
      ),
      shaderSourceUpload: timingSummary(captured.previews, "shaderSourceUploadMs"),
      shaderOverlayUpload: timingSummary(captured.previews, "shaderOverlayUploadMs"),
      lineDraw: timingSummary(captured.previews, "lineDrawMs"),
      noteDraw: timingSummary(captured.previews, "noteDrawMs"),
      samplePeaks: [...captured.previews]
        .sort((left, right) => right.sampleMs - left.sampleMs)
        .slice(0, 5)
        .map((sample) => ({
          seconds: sample.seconds,
          sampleMs: sample.sampleMs,
          totalMs: sample.totalMs,
        })),
      visibleNotes: Math.max(...captured.previews.map((sample) => sample.visibleNoteCount ?? 0), 0),
      renderPaths: Object.fromEntries(
        [...new Set(captured.previews.map((sample) => sample.renderPath))].map((pathName) => [
          pathName,
          captured.previews.filter((sample) => sample.renderPath === pathName).length,
        ]),
      ),
    },
    gpu: captured.gpu,
    cpuProfile: summarizeCpuProfile(cpuProfile),
    playbackMetrics: captured.metrics,
    probe,
  };
}

async function main() {
  for (const path of charts) {
    if (!resolve(path)) {
      throw new Error(`Invalid chart path: ${path}`);
    }
    readFileSync(path, { flag: "r" });
  }
  const chartServer = createChartServer(charts, jsonOnly);
  const chartPort = await chartServer.listen();
  const chrome = await findChrome();
  const cdpPort = await reservePort();
  const profile = mkdtempSync(join(tmpdir(), "rpe-redux-browser-benchmark-"));
  const processHandle = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-features=Translate,BackForwardCache",
      "--disable-sync",
      ...(softwareOnly
        ? ["--disable-gpu", "--disable-gpu-compositing", "--disable-webgl", "--disable-webgl2"]
        : disableGpu
          ? ["--disable-gpu", "--disable-gpu-compositing"]
          : ["--enable-gpu"]),
      ...(muteAudio ? ["--mute-audio"] : []),
      "--force-device-scale-factor=1",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  let client;
  try {
    const target = await waitForTarget(cdpPort, Date.now() + 30_000, processHandle);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.command("Page.enable");
    await client.command("Performance.enable");
    await client.command("Page.addScriptToEvaluateOnNewDocument", {
      source: "globalThis.__REDUX_TEST_API__=true;",
    });
    await client.command("Page.navigate", { url: `http://127.0.0.1:${frontendPort}/#/editor` });
    await sleep(2500);
    const initial = await waitForRedux(client);
    const documentRuntime = await waitForDocumentRuntime(client);
    if (!compactOutput) {
      console.log(
        JSON.stringify(
          {
            type: "browser",
            chartInput: jsonOnly ? "chart-json" : "full-pez",
            gpu: await evaluate(
              client,
              "(()=>{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webgl2:Boolean(c.getContext('webgl2'))};})()",
            ),
            initial,
            documentRuntime,
          },
          null,
          2,
        ),
      );
    }
    for (let chartIndex = 0; chartIndex < charts.length; chartIndex += 1) {
      const path = charts[chartIndex];
      if (verbose) {
        console.error(`benchmark: loading ${path}`);
      }
      await evaluate(
        client,
        "window.__benchDocumentLoad=[];window.__reduxDocumentLoadTimingProbe=s=>window.__benchDocumentLoad.push(s);",
      );
      await loadChart(client, chartPort, chartIndex, path);
      lastOpenStages = await evaluate(client, "window.__benchDocumentLoad.splice(0)");
      await evaluate(client, "window.__reduxDocumentLoadTimingProbe=null");
      if (verbose) {
        console.error(`benchmark: loaded ${path}`);
      }
      const scenarios = normalOnly
        ? [{ name: "normal-preview-playback", timeline: false, crud: false }]
        : crudOnly
          ? [
              {
                name: "timeline-preview-playback-crud-selection",
                timeline: true,
                crud: true,
                multiLine: !crudNoMultiLine,
              },
            ]
          : multiLineOnly
            ? [
                {
                  name: "timeline-preview-playback-multi-line",
                  timeline: true,
                  crud: false,
                  multiLine: true,
                },
              ]
            : [
                { name: "normal-preview-playback", timeline: false, crud: false },
                { name: "timeline-preview-playback", timeline: true, crud: false },
                {
                  name: "timeline-preview-playback-crud-selection",
                  timeline: true,
                  crud: true,
                  multiLine: true,
                },
              ];
      for (const scenario of scenarios) {
        if (verbose) {
          console.error(`benchmark: scenario ${scenario.name}`);
        }
        const result = await runScenario(client, chartPort, path, chartIndex, scenario);
        if (verbose) {
          console.error(`benchmark: finished ${scenario.name}`);
        }
        delete result.playbackMetrics;
        delete result.probe;
        console.log(
          JSON.stringify(
            compactOutput
              ? {
                  chart: result.chart,
                  scenario: result.scenario,
                  openMs: result.openMs,
                  openStages: result.openStages,
                  frameIntervalMs: result.frameIntervalMs,
                  longTasks: result.longTasks,
                  browserMetrics: result.browserMetrics,
                  frame: result.frame,
                  frameTask: result.frameTask,
                  sessionRender: result.sessionRender,
                  sessionRenderStages: result.sessionRenderStages,
                  sessionNotify: result.sessionNotify,
                  transaction: result.transaction,
                  transactionPhases: result.transactionPhases,
                  crud: result.crud,
                  pointerPhases: result.pointerPhases,
                  timelineCache: result.timelineCache,
                  callbackTasks: result.callbackTasks,
                  cpuProfile: result.cpuProfile,
                  preview: result.preview,
                  timelineLayout: result.timelineLayout,
                  gpu: result.gpu,
                }
              : result,
          ),
        );
      }
    }
  } finally {
    client?.close();
    await terminateProcess(processHandle);
    await chartServer.close();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (error) {
      // Chrome can briefly keep a profile file open on Windows after the
      // process exits. The benchmark result is still valid, so cleanup must
      // not replace it with an unrelated failure.
      if (error?.code !== "EPERM" && error?.code !== "EBUSY") {
        console.error("Could not remove the browser benchmark profile", error);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
