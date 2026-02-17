import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageTile } from '../PageTile';

describe('PageTile menu', () => {
  it('does not clip the dropdown (overflow-visible on tile)', async () => {
    const user = userEvent.setup();
    const onMenuAction = vi.fn();

    render(
      <PageTile
        page={{
          id: 1,
          document_id: 1,
          page_number: 1,
          image_path: 'x',
          lines_detected: false,
          is_ground_truth: false,
          line_order_mode: 'rtl',
          manual_transcription_percent: 0,
          has_model_transcription: false,
        }}
        onSelect={() => {}}
        onMenuAction={onMenuAction}
      />
    );

    const tile = screen.getByRole('button', { name: /Page 1/i });
    expect(tile.className).toMatch(/\boverflow-visible\b/);

    await user.click(screen.getByLabelText('Page options menu'));
    expect(screen.getByRole('button', { name: /Delete Page/i })).toBeInTheDocument();
  });

  it('keeps menu button inside tile bounds when L and M badges are present', () => {
    render(
      <PageTile
        page={{
          id: 1,
          document_id: 1,
          page_number: 1,
          image_path: 'x',
          lines_detected: true,
          is_ground_truth: false,
          line_order_mode: 'rtl',
          manual_transcription_percent: 0,
          has_model_transcription: true,
        }}
        onSelect={() => {}}
        onMenuAction={() => {}}
      />
    );

    const tile = screen.getByRole('button', { name: /Page 1/i });
    const menuButton = screen.getByLabelText('Page options menu');
    expect(menuButton.closest('article')).toBe(tile);

    const menuWrapper = screen.getByTestId('page-tile-menu-wrapper');
    expect(menuWrapper).toHaveClass('absolute');
    expect(tile).toContainElement(menuWrapper);
  });

  it('shows checkmark in progress ring when manual transcription is 100%', () => {
    render(
      <PageTile
        page={{
          id: 1,
          document_id: 1,
          page_number: 1,
          image_path: 'x',
          lines_detected: false,
          is_ground_truth: false,
          line_order_mode: 'rtl',
          manual_transcription_percent: 100,
          has_model_transcription: false,
        }}
        onSelect={() => {}}
      />
    );

    const progressArea = screen.getByTestId('page-tile-progress-ring');
    expect(progressArea).toBeInTheDocument();
    expect(progressArea).not.toHaveTextContent(/%/);
    expect(screen.getByTestId('progress-ring-checkmark')).toBeInTheDocument();
  });

  it('shows percentage in progress ring when manual transcription is incomplete', () => {
    render(
      <PageTile
        page={{
          id: 1,
          document_id: 1,
          page_number: 1,
          image_path: 'x',
          lines_detected: false,
          is_ground_truth: false,
          line_order_mode: 'rtl',
          manual_transcription_percent: 50,
          has_model_transcription: false,
        }}
        onSelect={() => {}}
      />
    );

    const progressArea = screen.getByTestId('page-tile-progress-ring');
    expect(progressArea).toHaveTextContent('50%');
  });

  it('exposes reliable hover targets for L/M badges (tooltip semantics)', () => {
    render(
      <PageTile
        page={{
          id: 1,
          document_id: 1,
          page_number: 1,
          image_path: 'x',
          lines_detected: true,
          is_ground_truth: true,
          line_order_mode: 'rtl',
          manual_transcription_percent: 0,
          has_model_transcription: true,
        }}
        onSelect={() => {}}
      />
    );

    const linesBadge = screen.getByLabelText('Lines detected');
    expect(linesBadge).toHaveAttribute('title', 'Lines detected');

    const modelBadge = screen.getByLabelText('Model transcription');
    expect(modelBadge).toHaveAttribute('title', 'Model transcription');

    // Tile view does not show gold star badge; ground truth is still in aria-label for accessibility
    const tile = screen.getByRole('button', { name: /Page 1/i });
    expect(tile).toHaveAttribute('aria-label', expect.stringMatching(/Marked as ground truth/));
  });
});

