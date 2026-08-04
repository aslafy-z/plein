import { m } from '../paraglide/messages.js';
import { useApp, selectSorted, selectZoneLead } from '../state/store';
import SheetShell from './SheetShell';
import ZoneCard from './ZoneCard';
import ZoneList from './ZoneList';

/** Rows needed under the card before the first-run pull-up hint is worth it */
const HINT_MIN_ROWS = 2;

/**
 * Bottom sheet over the map — the PHONE arrangement of the zone. Collapsed:
 * the leading station card. Pulling it up reveals the list of the stations in
 * the radius. On a desktop window the same two pieces are docked beside the
 * map instead, always open, with no gesture at all (see ZonePanel).
 *
 * The gesture engine, the snap points and the collapsed-height report live in
 * SheetShell, shared with the route sheet — what belongs here is the zone's
 * content: ZoneCard as the collapsed head, ZoneList as the expanded body, and
 * the first-run hint arming (it needs rows worth revealing).
 */
export default function MapSheet({
  stageH,
  onCollapsedHeight,
  expanded,
  onExpandedChange,
}: {
  /** Height of the map stage the sheet lives in (drives the expanded size) */
  stageH: number;
  /** Reports the collapsed height so the map keeps that strip free */
  onCollapsedHeight: (h: number) => void;
  /** Open state lives in MapScreen (the map overlay needs it too) */
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const app = useApp();
  // What the card leads with — the sheet only needs to know WHETHER there is
  // one (nothing to expand from an empty zone); ZoneCard draws it.
  const hasCard = selectZoneLead(app) != null;
  const rowCount = selectSorted(app).length;

  return (
    <SheetShell
      stageH={stageH}
      onCollapsedHeight={onCollapsedHeight}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      hasBody={hasCard}
      expandAria={m.sheet_expand_aria()}
      collapseAria={m.sheet_collapse_aria()}
      hint={app.sheetHint && rowCount >= HINT_MIN_ROWS}
      onHintConsumed={app.consumeSheetHint}
      header={(handle) => <ZoneCard handle={handle} />}
      body={(scrollerRef, gestures, chrome) => (
        <ZoneList
          scrollerRef={scrollerRef}
          gestures={gestures}
          chromeGestures={chrome}
          onRowPick={() => onExpandedChange(false)}
        />
      )}
    />
  );
}
