// FILE: test/setup.ts
//
// Shared setup for every frontend test. Loaded by vitest.config.ts.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Unmount between tests. Without this, a component left mounted keeps its
// timers and subscriptions alive and the next test inherits them — which is
// exactly the kind of cross-test leak that makes a suite pass for the wrong
// reason.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom implements neither, and components that animate or measure will throw
// on mount without them.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

if (!window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as any;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// `scrollIntoView` is called by list views on selection and is absent in jsdom.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
