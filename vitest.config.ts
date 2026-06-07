import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'hbs-text',
      transform(source, id) {
        if (!id.endsWith('.hbs')) {
          return undefined;
        }
        return {
          code: `export default ${JSON.stringify(source)};`,
          map: null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/types.ts',
        'src/delivery/types.ts',
        'src/formatters/types.ts',
        'src/logger.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
