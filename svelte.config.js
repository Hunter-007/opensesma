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
		csrf: { trustedOrigins: [] }
	}
};

export default config;
