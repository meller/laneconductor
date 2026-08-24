import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        include: ['server/tests/**/*.test.mjs', 'src/**/*.test.js', 'src/**/*.test.jsx'],
        // Component tests (.jsx) need a DOM; server/lib tests (.mjs/.js) don't
        // and shouldn't pay jsdom's overhead — scope it to component tests only.
        environmentMatchGlobs: [['src/**/*.test.jsx', 'jsdom']],
        setupFiles: ['./vitest.setup.js'],
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
