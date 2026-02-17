import { describe, it, expect } from 'vitest';
import { getTileInferenceProgress } from '../inferenceProgress';

describe('getTileInferenceProgress', () => {
  const ids = [11, 12, 13];

  it('returns processing for current page id', () => {
    const task: any = { status: 'running', progress: { current: 0, total: 3, page_id: 11 } };
    expect(getTileInferenceProgress(task, ids, 11)?.status).toBe('processing');
  });

  it('returns completed for pages before current index', () => {
    const task: any = { status: 'running', progress: { current: 2, total: 3, page_id: 13 } };
    expect(getTileInferenceProgress(task, ids, 11)?.status).toBe('completed');
    expect(getTileInferenceProgress(task, ids, 12)?.status).toBe('completed');
  });

  it('returns pending for pages after current index', () => {
    const task: any = { status: 'running', progress: { current: 0, total: 3, page_id: 11 } };
    expect(getTileInferenceProgress(task, ids, 13)?.status).toBe('pending');
  });
});

