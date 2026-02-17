import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelsPage from '../ModelsPage';

vi.mock('../../services/api', () => ({
  getModels: vi.fn(async () => ({
    items: [
      { id: 10, name: 'Rec', type: 'recognition', path: '/m', is_default: true },
    ],
  })),
  getGroundTruthPages: vi.fn(async () => ({
    minimum_required: 1,
    pages: [
      { id: 101, document_id: 1, page_number: 1 },
      { id: 102, document_id: 2, page_number: 1 },
    ],
    count: 2,
  })),
  getPage: vi.fn(async (id: number) => {
    if (id === 101) return { id: 101, document_id: 1, page_number: 1, image_path: 'x', lines_detected: true, is_ground_truth: true, line_order_mode: 'rtl', manual_transcription_percent: 100, has_model_transcription: false };
    return { id: 102, document_id: 2, page_number: 1, image_path: 'y', lines_detected: true, is_ground_truth: true, line_order_mode: 'rtl', manual_transcription_percent: 50, has_model_transcription: false };
  }),
  getDocument: vi.fn(async (id: number) => ({ id, name: id === 1 ? 'Doc A' : 'Doc B', page_count: 1 })),
  startFineTuning: vi.fn(async () => ({ task_id: 't', training_pages: 1 })),
  setDefaultModel: vi.fn(async () => ({})),
  deleteModel: vi.fn(async () => ({})),
  addModel: vi.fn(async () => ({})),
}));

describe('ModelsPage fine-tune modal', () => {
  it('groups selectable pages by document', async () => {
    const user = userEvent.setup();
    render(<ModelsPage />);

    await user.click(await screen.findByRole('button', { name: /Fine-tune/i }));

    expect(await screen.findByText(/Doc A/i)).toBeInTheDocument();
    expect(screen.getByText(/Doc B/i)).toBeInTheDocument();
  });
});

