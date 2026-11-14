import { defineConfig } from 'vite';

export default defineConfig(async ({ command }) => {
  if (command !== 'serve') return {};
  const { localDemo } = await import('./tests/local-demo.mjs');
  return { plugins: [localDemo()] };
});
