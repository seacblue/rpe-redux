/**
 * A small in-app pet built from the public surface and asset APIs.
 *
 * The package ships four SVG frames, resolves them through `context.assets`,
 * and keeps a persistent draggable surface in the editor window. Clicking the
 * pet opens an anchored bubble; clicking the bubble's close button removes it.
 */

/** Resolve a named frame into the media node's runtime shape. */
async function frame(context, name, durationMs) {
  return { src: await context.assets.url(name), durationMs };
}

/** Build the bubble tree for the current language. */
function bubbleTree(context) {
  return {
    kind: "group",
    layout: "absolute",
    children: [
      {
        kind: "element",
        tag: "div",
        style: {
          position: "absolute",
          inset: "0",
          display: "flex",
          alignItems: "center",
          padding: "var(--space-3) var(--space-4)",
          borderRadius: "var(--radius-panel)",
          background: "var(--surface-raised)",
          color: "var(--foreground)",
          border: "1px solid var(--edge-emphasis)",
          boxShadow: "var(--shadow-panel)",
          fontSize: "var(--type-body)",
        },
        text: context.i18n.t("bubble"),
      },
      {
        kind: "button",
        id: "close",
        label: "×",
        placement: { x: 0.92, y: 0.12, unit: "fraction", anchor: "center" },
      },
    ],
  };
}

export default {
  async activate(context) {
    const idle = await frame(context, "idle", 1100);
    const blink = await frame(context, "blink", 130);
    const wave = await frame(context, "wave", 420);
    const sleep = await frame(context, "sleep", 900);
    let bubble = null;

    const pet = context.ui.registerSurface({
      id: "pet",
      width: 160,
      height: 160,
      placement: { x: 0.92, y: 0.9, unit: "fraction", anchor: "bottom-right" },
      draggable: true,
      tree: {
        kind: "media",
        id: "pet",
        media: {
          kind: "animation",
          frames: [idle, idle, blink, idle, wave, idle, sleep, idle],
          loop: true,
        },
        placement: { x: 0, y: 0, width: 1, height: 1, unit: "fraction" },
        fit: "contain",
        alt: context.i18n.t("name"),
        draggable: true,
      },
      onEvent(event) {
        if (event.kind !== "click" || event.nodeId !== "pet") {
          return;
        }
        if (bubble) {
          bubble.close();
          bubble = null;
          return;
        }
        bubble = context.ui.openAnchoredSurface({
          id: "pet-bubble",
          width: 240,
          height: 120,
          anchor: { kind: "surface", id: "pet" },
          side: "top",
          tree: bubbleTree(context),
          onEvent(inner) {
            if (inner.kind === "click" && inner.nodeId === "close") {
              bubble?.close();
              bubble = null;
            }
          },
        });
      },
    });

    context.addCleanup(() => {
      bubble?.close();
      bubble = null;
      pet.dispose();
    });
  },
};
