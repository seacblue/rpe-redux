/**
 * Playback speeds offered by the editor's transport surfaces.
 *
 * Slower speeds are the authoring tool; faster-than-realtime playback is not
 * part of the product. Keeping the list here makes the toolbar and the view
 * actions offer exactly the same choices.
 */
/** Supported playback rates, from realtime to slowest for top-to-bottom menus. */
export const PLAYBACK_RATES = ["1", "0.75", "0.5", "0.25"] as const;
