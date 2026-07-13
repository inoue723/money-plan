/**
 * 本人年齢を入力する `NumberField` のラッパー(#47)。
 *
 * フォーカス中、入力中の本人年齢に対応する各子どもの年齢をツールチップで表示する。
 * これにより、支出期間・働き方期間・投資枠などの年齢を決めるときに
 * 「その本人年齢のとき子どもが何歳か」を即座に確認できる。
 *
 * - 子どもの年齢 = 入力中の本人年齢 − `Child.bornAtParentAge`。
 * - まだ生まれていない(負になる)子どもは「未誕生」と表示する。
 * - 子どもが 0 人のときはツールチップを出さない(素の `NumberField` と同挙動)。
 * - 入力に追従してリアルタイムに更新される(`focusTooltip` が毎レンダー再評価されるため)。
 */
import { useSimulationStore } from '../stores/simulationStore';
import { NumberField, type NumberFieldProps } from './NumberField';
import { formatChildAgeLines } from './childAges';

export function AgeNumberField(props: NumberFieldProps) {
  const children = useSimulationStore((s) => s.input.family.children);

  return (
    <NumberField
      {...props}
      focusTooltip={
        children.length === 0
          ? undefined
          : (currentValue) => {
              // 入力途中で数値にならない場合はツールチップを出さない。
              if (Number.isNaN(currentValue)) return null;
              return formatChildAgeLines(children, currentValue).join('\n');
            }
      }
    />
  );
}
