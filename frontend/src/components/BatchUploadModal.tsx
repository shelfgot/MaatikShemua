
export type BatchUploadMode = 'upload-document' | 'add-pages';

export interface BatchUploadFileStatus {
  name: string;
  status: 'pending' | 'ok' | 'error';
  errorMessage?: string;
}

export interface BatchUploadModalProps {
  files: File[] | FileList | null;
  mode: BatchUploadMode;
  isOpen: boolean;
  isUploading: boolean;
  currentIndex: number;
  total: number;
  perFileStatus: BatchUploadFileStatus[];
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional handler for requesting stop-after-current-file while uploading */
  onRequestStop?: () => void;
  /** Whether a stop has already been requested */
  isStopRequested?: boolean;
}

export function BatchUploadModal({
  files,
  mode,
  isOpen,
  isUploading,
  currentIndex,
  total,
  perFileStatus,
  onConfirm,
  onCancel,
  onRequestStop,
  isStopRequested,
}: BatchUploadModalProps) {
  if (!isOpen || !files || total === 0) return null;

  const asArray: File[] = Array.from(files as any);
  const totalSize = asArray.reduce((sum, f) => sum + (f.size || 0), 0);
  const humanSize =
    totalSize > 1024 * 1024
      ? `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
      : `${(totalSize / 1024).toFixed(1)} KB`;

  const progressPercent =
    total > 0 ? Math.round((currentIndex / total) * 100) : 0;

  const multiple = total > 1;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">
            {mode === 'upload-document'
              ? 'Upload document'
              : 'Add pages to document'}
          </h3>
          <button
            className="text-gray-600 hover:text-gray-900"
            onClick={onCancel}
            disabled={isUploading}
            aria-label="Close upload dialog"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          <div className="text-sm text-gray-700">
            <div className="flex justify-between">
              <span>
                {total} file{multiple ? 's' : ''} selected
              </span>
              <span>{humanSize}</span>
            </div>
          </div>

          <ul className="border rounded max-h-48 overflow-y-auto text-sm divide-y">
            {asArray.map((file, idx) => {
              const status = perFileStatus[idx];
              return (
                <li
                  key={file.name + idx}
                  className="px-2 py-1 flex items-center justify-between gap-2"
                >
                  <span className="truncate" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-xs">
                    {status?.status === 'ok' && (
                      <span className="text-green-600">✓</span>
                    )}
                    {status?.status === 'error' && (
                      <span
                        className="text-red-600"
                        title={status.errorMessage || 'Error'}
                      >
                        !
                      </span>
                    )}
                    {(!status || status.status === 'pending') && (
                      <span className="text-gray-400">…</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {multiple && !isUploading && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded p-2">
              You are about to upload {total} files. This may take a while.
              Please confirm to continue.
            </p>
          )}

          {isUploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-600">
                <span>
                  Uploading {currentIndex}/{total}
                </span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded">
                <div
                  className="h-2 bg-blue-600 rounded transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-60"
            onClick={() => {
              if (isUploading) {
                if (onRequestStop) {
                  onRequestStop();
                }
              } else {
                onCancel();
              }
            }}
            disabled={isUploading && isStopRequested}
          >
            {isUploading ? (isStopRequested ? 'Stopping…' : 'Stop after current file') : 'Cancel'}
          </button>
          <button
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
            onClick={onConfirm}
            disabled={isUploading}
          >
            {multiple ? 'Confirm & start upload' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}