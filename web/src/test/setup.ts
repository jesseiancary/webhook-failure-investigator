import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom here provides no localStorage, which the ThemeProvider reads/writes. Back it with an
// in-memory store so theme persistence works under test.
if (!('localStorage' in globalThis) || globalThis.localStorage == null) {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });
}

// jsdom doesn't implement matchMedia, which the ThemeProvider reads to resolve the 'system' theme.
// Provide a no-op (reports light) so components under test can mount.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Unmount React trees between tests and reset the theme side-effects (the `.dark` class on <html>
// and the persisted choice) so state never leaks across cases. Dependency-light on purpose — richer
// matchers (jest-dom) can be added when a screen needs them.
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  try {
    localStorage.clear();
  } catch {
    // Storage unavailable — nothing to reset.
  }
});
