/** Shared drawer assertions used by the remaining desktop smoke journeys. */

/**
 * Reads the public drawer selection beside the drawer mode the inspector paints.
 *
 * The selected pane comes from the public workspace API; the visible pane and
 * split come from the rendered inspector. Keeping the probe here lets restore
 * coverage verify that both views still describe the same drawer state.
 */
export function drawerSdkState(runner) {
  return runner.evaluate(`(() => {
    const inspector = document.querySelector('#inspector');
    const split = inspector?.querySelector('.drawer-split');
    const page = split?.closest('[data-drawer-pane]');
    return {
      selected: window.redux.workspace.drawerPane(),
      open: inspector?.classList.contains('is-drawer') === true,
      pane: page?.dataset.drawerPane ?? '',
      split: Boolean(split),
    };
  })()`);
}
