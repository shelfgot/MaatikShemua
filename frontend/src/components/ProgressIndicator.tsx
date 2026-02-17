import { Task } from '../types';

interface ProgressIndicatorProps {
  task: Task | null;
  onCancel?: () => void;
}

export function ProgressIndicator({ task, onCancel }: ProgressIndicatorProps) {
  if (!task) return null;

  const progress = task.progress;
  const hasNumeric =
    progress &&
    progress.total != null &&
    progress.total > 0 &&
    progress.current != null;
  const percent = hasNumeric
    ? Math.min(100, Math.round((progress!.current! / progress!.total!) * 100))
    : null;
  const progressLabel =
    progress?.message ||
    progress?.phase ||
    (hasNumeric
      ? `${progress!.current} / ${progress!.total}`
      : null);

  return (
    <div
      className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-4 min-w-[300px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">
          {task.type === 'inference' ? 'Running inference' : 'Training model'}
        </span>
        <span className="text-sm text-gray-500">
          {task.status}
        </span>
      </div>

      {(task.status === 'running' || task.status === 'pending') && (
        <>
          {progressLabel && (
            <p className="text-sm text-gray-600 mb-1">{progressLabel}</p>
          )}
          <div className="progress-bar">
            {percent != null ? (
              <div
                className="progress-bar-fill"
                style={{ width: `${percent}%` }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            ) : (
              <div
                className="progress-bar-fill animate-pulse"
                style={{ width: '100%' }}
                role="progressbar"
                aria-valuetext="In progress"
              />
            )}
          </div>
          {percent != null && (
            <div className="mt-1 text-sm text-gray-500 text-right">
              {percent}%
            </div>
          )}
        </>
      )}
      
      {task.status === 'failed' && task.error && (
        <div className="mt-2 text-sm text-red-600">
          Error: {task.error.message}
        </div>
      )}
      
      {task.status === 'completed' && (
        <div className="mt-2 text-sm text-green-600">
          Completed successfully!
        </div>
      )}
      
      {onCancel && task.status === 'running' && (
        <button
          onClick={onCancel}
          className="mt-2 text-sm text-red-600 hover:text-red-800"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
