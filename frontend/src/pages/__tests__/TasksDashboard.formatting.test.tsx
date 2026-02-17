import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TasksDashboard from '../TasksDashboard';

vi.mock('../../services/api', () => ({
  getTasks: vi.fn(async () => ({
    items: [
      {
        task_id: 'abc12345-0000-0000-0000-000000000000',
        type: 'inference',
        status: 'failed',
        progress: { current: 1, total: 10 },
        error: { message: 'Boom', detail: { nested: true } },
        result: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    total: 1,
    offset: 0,
    limit: 100,
  })),
  cancelTask: vi.fn(async () => ({})),
}));

describe('TasksDashboard formatting', () => {
  it('shows human-readable error message (not raw json)', async () => {
    render(<TasksDashboard />);
    expect(await screen.findByText(/Error:/)).toBeInTheDocument();
    expect(screen.getByText(/Boom/)).toBeInTheDocument();
  });

  it('renders compact task cards', async () => {
    render(<TasksDashboard />);
    const card = await screen.findByTestId('task-card-abc12345-0000-0000-0000-000000000000');
    expect(card.className).toMatch(/\bp-2\b/);
  });
});

