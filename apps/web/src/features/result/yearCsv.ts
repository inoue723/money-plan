/**
 * 年次結果の CSV 生成とダウンロード(issue #11 / SPEC.md 4.1 プライバシー)。
 *
 * CSV はすべてクライアント側で生成し、Blob + a[download] でダウンロードさせる。
 * 外部への送信は一切行わない。Excel(日本語)での文字化けを避けるため BOM を付与する。
 */
import type { SimulationResult } from '@money-plan/finance-core';
import { CSV_COLUMNS } from './yearColumns';

/** UTF-8 BOM(U+FEFF)。Excel(日本語)が CSV を UTF-8 として認識するために先頭へ付与する。 */
const BOM = String.fromCharCode(0xfeff);

/** CSV の 1 セルをエスケープする(カンマ・引用符・改行を含む場合は引用符で囲む)。 */
function escapeCell(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** シミュレーション結果を CSV 文字列(ヘッダー付き)に変換する。 */
export function buildCsv(result: SimulationResult): string {
  const header = CSV_COLUMNS.map((c) => escapeCell(c.label)).join(',');
  const rows = result.map((r) => CSV_COLUMNS.map((c) => escapeCell(c.get(r))).join(','));
  return [header, ...rows].join('\r\n');
}

/**
 * CSV をブラウザでダウンロードさせる。
 * 先頭に BOM を付けて UTF-8 として Excel に正しく認識させる。
 */
export function downloadCsv(result: SimulationResult, filename: string): void {
  const csv = buildCsv(result);
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
