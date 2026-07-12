import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  // Tailwind CSS v4 は Vite プラグインとして導入(PostCSS 設定不要。Vite6 と整合)。
  plugins: [react(), tailwindcss()],
  build: {
    // Cloudflare Pages のデプロイ想定に合わせた出力先(SPEC.md 4.2 / issue #001 メモ)
    outDir: 'dist',
  },
});
