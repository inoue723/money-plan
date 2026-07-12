import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Cloudflare Pages のデプロイ想定に合わせた出力先(SPEC.md 4.2 / issue #001 メモ)
    outDir: 'dist',
  },
});
