import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['server/tests/**/*.test.mjs'],
        coverage: {
            provider: 'v8',
            include: ['server/**/*.mjs'],
            exclude: ['server/tests/**'],
            thresholds: {
                lines: 49,
                functions: 50,
                branches: 40,
                statements: 49
            }
        }
    }
});
