import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

// Avoid jsdom canvas errors from libraries that probe canvas support.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => null,
});

// Provide a stable origin so URL() resolution works in tests.
Object.defineProperty(window, 'location', {
  value: new URL('http://localhost/'),
});

// Mock OpenSeadragon to keep unit tests lightweight.
vi.mock('openseadragon', () => {
  const Point = function (x: number, y: number) {
    return { x, y };
  } as any;

  const Viewer = function () {
    return {
      addHandler: () => {},
      removeHandler: () => {},
      destroy: () => {},
      viewport: {
        getZoom: () => 1,
        goHome: () => {},
        getCenter: () => ({ x: 0, y: 0 }),
        panTo: () => {},
        imageToViewerElementCoordinates: (p: any) => p,
        viewerElementToImageCoordinates: (p: any) => p,
      },
      world: {
        getItemAt: () => ({
          getBounds: () => ({ width: 1000, height: 1000 }),
        }),
      },
      container: { clientWidth: 1000, clientHeight: 1000 },
    };
  } as any;

  return { default: Object.assign(Viewer, { Point }) };
});

// Default fetch mock to silence network calls in component tests.
globalThis.fetch = vi.fn(async () => {
  return {
    ok: true,
    json: async () => ({ items: [], total: 0, offset: 0, limit: 20 }),
  } as any;
}) as any;

