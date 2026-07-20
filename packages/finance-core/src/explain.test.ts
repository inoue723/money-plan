import { describe, expect, it } from 'vitest';

import {
  formatNodeRef,
  formatNodeValue,
  fromYen,
  manyen,
  percent,
  renderFormula,
  years,
  type CalcNode,
} from './explain';

describe('計算根拠ノード(CalcNode)の表示フォーマッタ', () => {
  it('ノード値を単位に応じて整形する(既定は万円・桁区切り・小数2桁まで)', () => {
    expect(formatNodeValue(manyen('退職金 額面', 2000))).toBe('2,000万円');
    // 計算値は丸めず、表示だけ小数2桁までに丸める。
    expect(formatNodeValue(manyen('手取り', 1797.0716))).toBe('1,797.07万円');
    expect(formatNodeValue(fromYen('速算控除額', 636_000))).toBe('63.6万円');
    expect(formatNodeValue(percent('所得税率', 23))).toBe('23%');
    expect(formatNodeValue(years('勤続年数', 35))).toBe('35年');
    expect(formatNodeValue({ label: '円建て', value: 5_000, unit: 'yen' })).toBe('5,000円');
  });

  it('ノード参照は「値(label)」形式で整形する', () => {
    expect(formatNodeRef(manyen('課税退職所得', 800))).toBe('800万円(課税退職所得)');
  });
});

describe('計算式の平文化(renderFormula)', () => {
  it('リテラルとノード参照(op つき)を並べて平文化する', () => {
    const node: CalcNode = {
      label: '所得税',
      value: 122.9284,
      formula: [
        { node: manyen('課税退職所得', 800) },
        { op: '×', node: percent('所得税率', 23) },
        { op: '−', node: manyen('速算控除額', 63.6) },
        '(復興特別所得税2.1%込)',
      ],
    };
    expect(renderFormula(node)).toBe(
      '800万円(課税退職所得) × 23%(所得税率) − 63.6万円(速算控除額) (復興特別所得税2.1%込)',
    );
  });

  it('hidden の項は先行する演算子(op)ごとスキップする', () => {
    const node: CalcNode = {
      label: 'その他収入',
      value: 1000,
      formula: [
        { node: manyen('退職金(本人・手取り)', 1000) },
        { op: '+', node: manyen('退職金以外のその他収入', 0, { hidden: true }) },
      ],
    };
    expect(renderFormula(node)).toBe('1,000万円(退職金(本人・手取り))');
  });

  it('formula を持たない葉ノードは空文字を返す', () => {
    expect(renderFormula(manyen('入力値', 42))).toBe('');
  });
});
