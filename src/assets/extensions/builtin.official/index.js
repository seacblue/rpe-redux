/** Official built-in note transforms for exploring the Extension SDK. */

const NOTE_TYPES = Object.freeze({ Tap: 1, Hold: 2, Flick: 3, Drag: 4 });

/** Read selected notes and events with their current chart values. */
async function selectedObjects(api) {
  const selection = await api.selection.state();
  if (!selection.ok) {
    return { error: selection.error.code };
  }

  let lines = [];
  const notes = [];
  if (selection.value.notes.length > 0) {
    const lineResult = await api.chart.lines();
    if (!lineResult.ok) {
      return { error: lineResult.error.code };
    }
    lines = lineResult.value;
    notes.push(
      ...selection.value.notes
        .map((reference) => {
          const note = lines[reference.lineIndex]?.notes?.[reference.index];
          return note && note.id ? { note, id: note.id } : null;
        })
        .filter(Boolean),
    );
  }

  const events = [];
  for (const reference of selection.value.events) {
    const eventResult = await api.chart.event(reference.id);
    const event = eventResult.ok ? eventResult.value?.event : null;
    if (event && event.id) {
      events.push({ event, id: event.id });
    }
  }

  return notes.length || events.length ? { lines, notes, events } : { empty: true };
}

/** Commit id-addressed note and event patches and report the outcome. */
async function applyPatches({ api, i18n, ui }, key, patches) {
  const notePatches = Array.isArray(patches) ? patches : patches.notes;
  const eventPatches = Array.isArray(patches) ? [] : patches.events;
  const count = notePatches.length + eventPatches.length;
  if (count === 0) {
    ui.notice({ key: "notice.noChanges" }, { level: "warning" });
    return;
  }
  const result = await api.transaction.apply({
    label: i18n.t(`history.${key}`),
    ...(notePatches.length ? { notes: { update: notePatches } } : {}),
    ...(eventPatches.length ? { events: { update: eventPatches } } : {}),
  });
  if (!result.ok) {
    ui.notice({ key: "notice.failed", params: { status: result.error.code } }, { level: "error" });
  } else if (result.value.status === "committed") {
    ui.notice({ key: "notice.success", params: { count } }, { level: "success" });
  } else if (result.value.status === "unchanged") {
    ui.notice({ key: "notice.unchanged" }, { level: "info" });
  } else {
    ui.notice(
      { key: "notice.failed", params: { status: result.value.status } },
      { level: "error" },
    );
  }
}

/** Register one transform whose patch is derived from the current selection. */
function registerTransform(context, definition) {
  context.scripts.register({
    id: definition.id,
    label: { key: `script.${definition.id}.label` },
    description: { key: `script.${definition.id}.description` },
    icon: definition.icon || "mirror",
    ...(definition.defaultShortcuts ? { defaultShortcuts: definition.defaultShortcuts } : {}),
    ...(definition.shortcutScope ? { shortcutScope: definition.shortcutScope } : {}),
    async run({ api, i18n, ui }) {
      const selected = await selectedObjects(api);
      if (selected.error) {
        ui.notice({ key: "notice.failed", params: { status: selected.error } }, { level: "error" });
        return;
      }
      if (selected.empty) {
        ui.notice({ key: "notice.noSelection" }, { level: "warning" });
        return;
      }
      const patches = await definition.patch(
        selected.notes,
        selected.lines || [],
        selected.events,
        api,
      );
      const normalizedPatches = Array.isArray(patches)
        ? patches.filter(Boolean)
        : {
            notes: patches.notes.filter(Boolean),
            events: patches.events.filter(Boolean),
          };
      await applyPatches({ api, i18n, ui }, definition.id, normalizedPatches);
    },
  });
}

/** Register all official examples. */
export default {
  activate(context) {
    const transforms = [
      {
        id: "MirrorY",
        defaultShortcuts: [{ key: "A" }],
        patch: (notes, _lines, events) => ({
          notes: notes.map(({ id, note }) => ({
            id,
            patch: { positionX: -Number(note.positionX || 0) },
          })),
          events: events
            .map(({ id, event }) => {
              const patch = {};
              if (typeof event.start === "number" && Number.isFinite(event.start)) {
                patch.start = -event.start;
              }
              if (typeof event.end === "number" && Number.isFinite(event.end)) {
                patch.end = -event.end;
              }
              return Object.keys(patch).length ? { id, patch } : null;
            })
            .filter(Boolean),
        }),
      },
      {
        id: "MirrorMid",
        patch: (notes) => {
          const values = notes.map(({ note }) => Number(note.positionX)).filter(Number.isFinite);
          if (!values.length) {
            return [];
          }
          const center = (Math.min(...values) + Math.max(...values)) / 2;
          return notes.map(({ id, note }) => ({
            id,
            patch: { positionX: 2 * center - Number(note.positionX || 0) },
          }));
        },
      },
      {
        id: "SideSwitch",
        patch: (notes) =>
          notes.map(({ id, note }) => ({
            id,
            patch: {
              above:
                note.type === NOTE_TYPES.Hold
                  ? Number(note.above) === 1
                    ? 0
                    : 1
                  : Number(note.above) === 1
                    ? 2
                    : 1,
            },
          })),
      },
      {
        id: "SideUp",
        patch: (notes) => notes.map(({ id }) => ({ id, patch: { above: 1 } })),
      },
      {
        id: "SideDown",
        patch: (notes) =>
          notes.map(({ id, note }) => ({
            id,
            patch: { above: note.type === NOTE_TYPES.Hold ? 0 : 2 },
          })),
      },
      { id: "ToReal", patch: (notes) => notes.map(({ id }) => ({ id, patch: { isFake: 0 } })) },
      { id: "ToFake", patch: (notes) => notes.map(({ id }) => ({ id, patch: { isFake: 1 } })) },
      {
        id: "ToTap",
        patch: (notes) => notes.map(({ id }) => ({ id, patch: { type: NOTE_TYPES.Tap } })),
      },
      {
        id: "ToFlick",
        patch: (notes) => notes.map(({ id }) => ({ id, patch: { type: NOTE_TYPES.Flick } })),
      },
      {
        id: "ToDrag",
        patch: (notes) => notes.map(({ id }) => ({ id, patch: { type: NOTE_TYPES.Drag } })),
      },
      {
        id: "ToHold",
        patch: async (notes, lines, _events, api) => {
          const denominator = Math.max(1, lines.length);
          return Promise.all(
            notes.map(async ({ id, note }) => {
              const endTime = await api.chart.beats.addFraction(note.startTime, 1, denominator);
              if (!endTime.ok) {
                throw new Error(endTime.error.message);
              }
              return { id, patch: { type: NOTE_TYPES.Hold, endTime: endTime.value } };
            }),
          );
        },
      },
    ];
    transforms.forEach((definition) => registerTransform(context, definition));
  },
};
