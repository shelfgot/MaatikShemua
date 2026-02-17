import { useCallback, useMemo, useState } from 'react';

export interface RangeSelectionState<TId extends number | string = number> {
  selectedIds: Set<TId>;
  anchorId: TId | null;
}

export interface RangeSelectionApi<TId extends number | string = number> {
  /** Raw Set of selected IDs for internal logic */
  selectedIds: Set<TId>;
  /** Selected IDs as a stable array, useful for rendering */
  selected: TId[];
  /** Anchor item for shift-range selections */
  anchorId: TId | null;
  /**
   * Handle an item click in a Windows Explorer–style way.
   * Call this from your row's onClick handler.
   */
  onItemClick: (id: TId, event: React.MouseEvent) => void;
  /** Check if an item is currently selected */
  isSelected: (id: TId) => boolean;
  /** Clear the current selection and anchor */
  clear: () => void;
}

/**
 * Windows Explorer–style range-selection manager.
 *
 * - Plain click: selects only that item and sets the anchor.
 * - Ctrl/Cmd+click: toggles the item without affecting other selections or anchor.
 * - Shift+click: selects a continuous range between the anchor and clicked item,
 *   based on the orderedIds provided for the current render. If there is no
 *   valid anchor, behaves like a plain click.
 *
 * The hook itself is UI-agnostic. Callers are responsible for:
 * - Passing the current orderedIds array (e.g. your rows in visual order).
 * - Wiring onItemClick into row click handlers.
 */
export function useRangeSelection<TId extends number | string = number>(
  orderedIds: TId[],
): RangeSelectionApi<TId> {
  const [state, setState] = useState<RangeSelectionState<TId>>({
    selectedIds: new Set<TId>(),
    anchorId: null,
  });

  const onItemClick = useCallback(
    (id: TId, event: React.MouseEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;

      setState(prev => {
        const nextSelected = new Set(prev.selectedIds);
        let nextAnchor = prev.anchorId;

        if (isShift && prev.anchorId != null) {
          const anchorIndex = orderedIds.indexOf(prev.anchorId);
          const targetIndex = orderedIds.indexOf(id);

          if (anchorIndex === -1 || targetIndex === -1) {
            // Fallback: treat as plain click if we can't compute a range
            return {
              selectedIds: new Set<TId>([id]),
              anchorId: id,
            };
          }

          const [start, end] =
            anchorIndex < targetIndex
              ? [anchorIndex, targetIndex]
              : [targetIndex, anchorIndex];

          nextSelected.clear();
          for (let i = start; i <= end; i++) {
            nextSelected.add(orderedIds[i]);
          }

          // Keep the original anchor to allow extending the range from it
          nextAnchor = prev.anchorId;

          return { selectedIds: nextSelected, anchorId: nextAnchor };
        }

        if (isMeta) {
          // Toggle the clicked id, leave others and anchor as-is
          if (nextSelected.has(id)) {
            nextSelected.delete(id);
          } else {
            nextSelected.add(id);
          }
          return { selectedIds: nextSelected, anchorId: nextAnchor };
        }

        // Plain click: select only this id and update anchor
        return {
          selectedIds: new Set<TId>([id]),
          anchorId: id,
        };
      });
    },
    [orderedIds],
  );

  const isSelected = useCallback(
    (id: TId) => state.selectedIds.has(id),
    [state.selectedIds],
  );

  const clear = useCallback(() => {
    setState({ selectedIds: new Set<TId>(), anchorId: null });
  }, []);

  const selectedArray = useMemo(() => Array.from(state.selectedIds), [state.selectedIds]);

  return {
    selectedIds: state.selectedIds,
    selected: selectedArray,
    anchorId: state.anchorId,
    onItemClick,
    isSelected,
    clear,
  };
}

