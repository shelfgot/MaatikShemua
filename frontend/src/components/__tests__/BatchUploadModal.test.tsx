import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchUploadModal } from '../BatchUploadModal';

describe('BatchUploadModal', () => {
  it('requires confirmation when multiple files selected', async () => {
    const user = userEvent.setup();
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];

    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <BatchUploadModal
        files={files}
        mode="upload-document"
        isOpen={true}
        isUploading={false}
        currentIndex={0}
        total={files.length}
        perFileStatus={files.map((f) => ({ name: f.name, status: 'pending' }))}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(
      screen.getByText(/You are about to upload 2 files/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Confirm & start upload/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

