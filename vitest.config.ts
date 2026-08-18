import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [],
    coverage: { reporter: ['text', 'html'] },
  },
});
