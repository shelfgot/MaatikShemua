import { Task } from '../types';

export type TileInferenceProgress =
  | { status: 'pending'; progress: 0 }
  | { status: 'processing'; progress: number }
  | { status: 'completed'; progress: 100 }
  | { status: 'failed'; progress: 0 };

export function getTileInferenceProgress(
  task: Task | null | undefined,
  inferencePageIds: number[],
  pageId: number
): TileInferenceProgress | undefined {
  if (!task) return undefined;
  if (!inferencePageIds.includes(pageId)) return undefined;

  if (task.status === 'failed') return { status: 'failed', progress: 0 };
  if (task.status === 'completed') return { status: 'completed', progress: 100 };

  const idx = inferencePageIds.indexOf(pageId);
  const currentIdx = task.progress?.current ?? 0;
  const currentPageId = task.progress?.page_id;

  if (currentPageId === pageId) {
    return { status: 'processing', progress: 50 };
  }
  if (idx < currentIdx) {
    return { status: 'completed', progress: 100 };
  }
  if (idx === currentIdx) {
    return { status: 'processing', progress: 50 };
  }
  return { status: 'pending', progress: 0 };
}

