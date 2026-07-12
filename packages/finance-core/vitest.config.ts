import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // UI 非依存の純粋関数パッケージのため Node 環境で実行する。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
