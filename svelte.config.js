import adapterNetlify from '@sveltejs/adapter-netlify';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Netlify is the default target. Set ADAPTER=node to build a plain Node server
// (useful for local end-to-end runs or self-hosting on a VPS).
const adapter = process.env.ADAPTER === 'node' ? adapterNode() : adapterNetlify({ edge: false, split: false });

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		serviceWorker: { register: false }, // registered manually so we control update prompts
		csrf: { trustedOrigins: [] },
		// Content-Security-Policy. SvelteKit hashes its own inline scripts (mode auto),
		// so no inline script from anywhere else can run. blob: workers are for the
		// QR scanner; blob: media is the camera preview.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'worker-src': ['self', 'blob:'],
				'media-src': ['self', 'blob:'],
				'manifest-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none']
			}
		}
	}
};

export default config;
