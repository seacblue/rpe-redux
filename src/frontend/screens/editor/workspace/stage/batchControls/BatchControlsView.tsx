/**
 * Draws the batch control balls and their drag hints inside the stage overlay.
 * All state and pointer actions come from `batchControls`; this component only
 * renders what that controller publishes.
 *
 * The group's position is deliberately not a prop: the controller writes it to
 * the element every frame, because a dock anchored to chart time has to move
 * with the playhead rather than at the rate React commits renders.
 */
import {
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { t } from "../../../../../../i18n/index.ts";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { batchControlConfigurations } from "./batchControlSpecs.ts";
import type { BatchControlActions, BatchControlsState } from "./batchControls.ts";
import type { BatchControlSpec } from "./batchControlSpecs.ts";

export interface BatchControlsViewProps {
  actions: BatchControlActions;
}

function BatchControlGroup({
  area,
  entries,
  actions,
  state,
}: {
  area: string;
  entries: readonly BatchControlSpec[];
  actions: BatchControlActions;
  state: BatchControlsState;
}) {
  const presentation = useSyncExternalStore(
    state.presentations.subscribe,
    () => state.presentations.get()[area],
    () => state.presentations.get()[area],
  );
  const hint = useSyncExternalStore(
    (listener) => state.hints.subscribeKey(area, listener),
    () => state.hints.get(area),
    () => state.hints.get(area),
  );
  return (
    <div
      className="batch-controls"
      data-area={area}
      hidden={!presentation?.visible}
      ref={(element) => {
        actions.attachGroup(area, element);
      }}
    >
      {entries.map(({ kind, title, color }) => (
        <Button
          key={kind}
          type="button"
          variant="plain"
          className="batch-ball"
          aria-label={t(title)}
          data-tip-title={t(title)}
          data-kind={kind}
          tabIndex={-1}
          style={{ "--ball-color": color } as CSSProperties}
          onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) =>
            actions.onDown(area, kind, event.nativeEvent, event.currentTarget)
          }
          onPointerMove={(event: ReactPointerEvent<HTMLButtonElement>) =>
            actions.onMove(event.nativeEvent)
          }
          onPointerUp={(event: ReactPointerEvent<HTMLButtonElement>) =>
            actions.onUp(event.nativeEvent)
          }
          onPointerCancel={actions.onCancel}
        />
      ))}
      <output className="batch-hint" aria-live="polite" aria-atomic="true">
        {hint}
      </output>
    </div>
  );
}

/** Each area observes only its own hint and presentation. */
export function BatchControlsView({
  actions,
  state,
}: BatchControlsViewProps & { state: BatchControlsState }) {
  return (
    <>
      {Object.entries(batchControlConfigurations).map(([area, entries]) => (
        <BatchControlGroup
          key={area}
          area={area}
          entries={entries}
          actions={actions}
          state={state}
        />
      ))}
    </>
  );
}
