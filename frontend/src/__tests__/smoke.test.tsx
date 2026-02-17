import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// Avoid background effects/state updates from pages in a smoke test.
// We only care that the app shell renders.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import { vi } from 'vitest';
vi.mock('../pages/IndexPage', () => ({ default: () => <div /> }));
vi.mock('../pages/EditorPage', () => ({ default: () => <div /> }));
vi.mock('../pages/ModelsPage', () => ({ default: () => <div /> }));
vi.mock('../pages/TasksDashboard', () => ({ default: () => <div /> }));

describe('smoke', () => {
  it('renders header title', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByText('מעתיק שמועה')).toBeInTheDocument();
  });
});

