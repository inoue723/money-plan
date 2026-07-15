/**
 * プランの JSON export / import(#71)。
 *
 * プラン(入力条件一式)を JSON ファイルとして書き出し / 読み込みできるようにする。
 * 別ブラウザ・別マシンへの持ち運びやバックアップを目的とし、**外部送信は一切しない**
 * (export は Blob + `URL.createObjectURL` によるローカルダウンロード、import はローカル
 * ファイルの読み取りのみ)。
 *
 * ファイル形式:
 * ```json
 * {
 *   "app": "money-plan",
 *   "version": <PERSIST_VERSION>,
 *   "exportedAt": "<ISO 8601 日時>",
 *   "plans": [{ "name": "<プラン名>", "input": <SimulationInput> }]
 * }
 * ```
 */
import type { SimulationInput } from '@money-plan/finance-core';
import {
  PERSIST_VERSION,
  migratePlanInput,
  type ImportedPlan,
} from '../../stores/simulationStore';

/** export ファイルの `app` 識別子。import 時にこの値でファイル種別を検証する。 */
export const EXPORT_APP_ID = 'money-plan';

/** export ファイル内の 1 プラン。 */
export interface PlanFileEntry {
  name: string;
  input: SimulationInput;
}

/** export / import で扱う JSON ファイル全体の形。 */
export interface PlanFile {
  /** アプリ識別子。常に `money-plan`。 */
  app: string;
  /** 書き出し時の永続化スキーマ version(= `PERSIST_VERSION`)。 */
  version: number;
  /** 書き出し日時(ISO 8601)。 */
  exportedAt: string;
  /** 書き出したプラン一覧。 */
  plans: PlanFileEntry[];
}

/** 2 桁ゼロ埋め。 */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** export ファイル名(`money-plan-YYYYMMDD-HHmmss.json`)を組み立てる。 */
export const exportFileName = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `money-plan-${y}${m}${d}-${hh}${mm}${ss}.json`;
};

/** export 用の JSON オブジェクトを組み立てる(現在の `PERSIST_VERSION` を書き込む)。 */
export const buildPlanFile = (plans: PlanFileEntry[], date: Date = new Date()): PlanFile => ({
  app: EXPORT_APP_ID,
  version: PERSIST_VERSION,
  exportedAt: date.toISOString(),
  plans: plans.map((p) => ({ name: p.name, input: p.input })),
});

/**
 * プランをまとめて 1 つの JSON ファイルとしてダウンロードさせる。
 * Blob + `URL.createObjectURL` によるローカル保存で、外部へは送信しない。
 */
export const downloadPlans = (plans: PlanFileEntry[], date: Date = new Date()): void => {
  const file = buildPlanFile(plans, date);
  const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(date);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** import ファイルが不正なときに投げるエラー。UI はこの message をそのまま表示する。 */
export class PlanImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanImportError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * import ファイルの文字列をパース・検証し、現行スキーマへマイグレーション済みの
 * プラン一覧を返す。不正な形式・古すぎる/新しすぎる version の場合は
 * {@link PlanImportError} を投げる(呼び出し側でエラー表示して中断する)。
 *
 * - `app` が `money-plan` でなければエラー。
 * - `version` が数値でなければエラー。現在の `PERSIST_VERSION` より新しければエラー。
 *   古い場合は `migratePlanInput` で version に応じたマイグレーションを順に適用する。
 * - `plans` が非空配列で、各要素が `{ name: string, input: object }` でなければエラー。
 */
export const parseImportFile = (text: string): ImportedPlan[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanImportError('ファイルを読み込めませんでした(JSON の形式が不正です)');
  }
  if (!isObject(data)) {
    throw new PlanImportError('ファイルの形式が正しくありません');
  }
  if (data.app !== EXPORT_APP_ID) {
    throw new PlanImportError('money-plan のエクスポートファイルではありません');
  }
  const version = data.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new PlanImportError('ファイルの version が不正です');
  }
  if (version > PERSIST_VERSION) {
    throw new PlanImportError(
      'このファイルは新しいバージョンのアプリで作成されています。アプリを更新してください',
    );
  }
  if (!Array.isArray(data.plans) || data.plans.length === 0) {
    throw new PlanImportError('インポートできるプランが含まれていません');
  }
  return data.plans.map((raw): ImportedPlan => {
    if (!isObject(raw) || typeof raw.name !== 'string' || !isObject(raw.input)) {
      throw new PlanImportError('プランのデータ形式が正しくありません');
    }
    return {
      name: raw.name,
      // version に応じて現行の入力形状へマイグレーションする。
      input: migratePlanInput(raw.input as unknown as SimulationInput, version),
    };
  });
};
