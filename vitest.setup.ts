import '@testing-library/jest-dom/vitest';

// chunk 81 — react-resizable-panels v4 uses ResizeObserver in its
// Group internals. jsdom doesn't ship it; without a stub the App
// renders crash with "n is not a constructor".
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  // Minimal stub: never fires callbacks. Sufficient for unit tests
  // where layout values aren't asserted.
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement matchMedia; theme-provider relies on it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
