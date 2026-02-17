import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRangeSelection } from '../useRangeSelection';

describe('useRangeSelection', () => {
  it('selects a single item on plain click', () => {
    const ids = [1, 2, 3];
    const { result } = renderHook(() => useRangeSelection(ids));

    act(() => {
      result.current.onItemClick(2, { metaKey: false, ctrlKey: false, shiftKey: false } as any);
    });

    expect(result.current.selected).toEqual([2]);
    expect(result.current.isSelected(2)).toBe(true);
  });

  it('toggles with Ctrl/Cmd click', () => {
    const ids = [1, 2, 3];
    const { result } = renderHook(() => useRangeSelection(ids));

    act(() => {
      result.current.onItemClick(1, { metaKey: false, ctrlKey: false, shiftKey: false } as any);
    });
    act(() => {
      result.current.onItemClick(3, { metaKey: true, ctrlKey: true, shiftKey: false } as any);
    });

    expect(new Set(result.current.selected)).toEqual(new Set([1, 3]));

    act(() => {
      result.current.onItemClick(1, { metaKey: true, ctrlKey: true, shiftKey: false } as any);
    });

    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(3)).toBe(true);
  });

  it('selects a range with Shift+click', () => {
    const ids = [10, 20, 30, 40];
    const { result } = renderHook(() => useRangeSelection(ids));

    act(() => {
      result.current.onItemClick(20, { metaKey: false, ctrlKey: false, shiftKey: false } as any);
    });

    act(() => {
      result.current.onItemClick(40, { metaKey: false, ctrlKey: false, shiftKey: true } as any);
    });

    expect(new Set(result.current.selected)).toEqual(new Set([20, 30, 40]));
  });
});

