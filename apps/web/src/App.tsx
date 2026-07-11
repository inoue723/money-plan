import { ping } from '@money-plan/finance-core';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', lineHeight: 1.6 }}>
      <h1>資産推移シミュレーション</h1>
      <p>monorepo の初期セットアップが完了しました。</p>
      <p>
        {/* packages/finance-core からの workspace 依存の疎通確認 */}
        finance-core 疎通確認: <strong>{ping()}</strong>
      </p>
    </main>
  );
}
