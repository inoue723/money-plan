/**
 * 本人年齢から各子どもの年齢ラベルを組み立てるヘルパ(#47)。
 *
 * 子どもの年齢 = 本人年齢 − `Child.bornAtParentAge`。
 * まだ生まれていない(負になる)子どもは年齢の代わりに「未誕生」と表示する。
 */
import type { Child } from '@money-plan/finance-core';

/** `第N子 X歳`(未誕生は年齢の代わりに「未誕生」)の行文字列を返す。 */
export const formatChildAgeLines = (children: readonly Child[], parentAge: number): string[] =>
  children.map((child, i) => {
    const childAge = parentAge - child.bornAtParentAge;
    return `第${i + 1}子 ${childAge < 0 ? '未誕生' : `${childAge}歳`}`;
  });
