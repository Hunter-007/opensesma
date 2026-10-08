import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	optimizeDeps: { exclude: ['@electric-sql/pglite'] },
	ssr: { external: ['@electric-sql/pglite'] },
	test: {
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 60000
	}
});
