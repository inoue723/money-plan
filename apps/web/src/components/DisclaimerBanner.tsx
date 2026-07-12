/**
 * 免責表示(SPEC.md 1.4)とプライバシー説明(SPEC.md 4.1)の最小実装。
 *
 * - 免責: 簡易シミュレーションであり金融商品の勧誘・投資助言ではない旨、
 *   税制・社会保険は簡略化モデルで実額と異なりうる旨を明示する。
 * - プライバシー: 入力データは外部送信せずブラウザ内で完結する旨を明示する。
 */
export function DisclaimerBanner() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs leading-relaxed text-slate-500">
      <p>
        本システムは簡易シミュレーションであり、金融商品の勧誘や投資助言を行うものではありません。
        税制・社会保険制度は簡略化したモデルで計算しており、実際の金額とは異なる場合があります。
      </p>
      <p className="mt-1">
        入力したデータは外部に送信されず、すべてお使いのブラウザ内でのみ処理されます。
      </p>
    </footer>
  );
}
