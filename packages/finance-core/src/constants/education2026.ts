/**
 * 2026年度基準の教育費テーブル(SPEC.md 2.3.3)。
 *
 * 文部科学省の調査等に基づく年額の目安値。進路(公立/私立)は子どもごとに選択でき、
 * 設定で上書き可能とする(本テーブルはデフォルト値)。
 *
 * 単位: すべて「万円/年」(システムの基本単位に合わせる)。
 *
 * 学齢期の対応年齢(目安):
 * - preschool  : 0〜5歳
 * - elementary : 6〜11歳(小学校)
 * - juniorHigh : 12〜14歳(中学校)
 * - highSchool : 15〜17歳(高校)
 * - university : 18〜21歳(大学)
 */

/** 公立/私立の年額(万円)。 */
export interface PublicPrivateCost {
  /** 公立(万円/年)。 */
  public: number;
  /** 私立(万円/年)。 */
  private: number;
}

/** 未就学〜高校の教育費テーブル(万円/年)。 */
export const EDUCATION_COST = {
  preschool: { public: 30, private: 50 },
  elementary: { public: 35, private: 170 },
  juniorHigh: { public: 55, private: 145 },
  highSchool: { public: 50, private: 100 },
} as const satisfies Record<string, PublicPrivateCost>;

/**
 * 大学の教育費テーブル(万円/年)。
 * 進路区分(SimulationInput の UniversityType)に対応する。
 */
export const UNIVERSITY_COST = {
  /** 国公立。 */
  national: 250,
  /** 私立文系。 */
  privateLiberal: 400,
  /** 私立理系。 */
  privateScience: 550,
} as const;
