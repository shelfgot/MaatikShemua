import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import App from '../App';

vi.mock('../pages/IndexPage', () => ({ default: () => <div>INDEX</div> }));
vi.mock('../pages/ModelsPage', () => ({ default: () => <div>MODELS</div> }));
vi.mock('../pages/TasksDashboard', () => ({ default: () => <div>TASKS</div> }));
vi.mock('../pages/EditorPage', () => ({ default: () => <div>EDITOR</div> }));

describe('header home link', () => {
  it('navigates home when clicking the title', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/models']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('MODELS')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /Maatik Shemua home/i }));
    expect(screen.getByText('INDEX')).toBeInTheDocument();
  });
});

