import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import { getI18n } from "@/lib/i18n/server";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { legalPagesFinal } from "@/lib/config/site";
import { Court, OperatorName } from "@/components/SiteDetails";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return staticPageMetadata("terms", m.nav.terms, "/terms");
}

export default async function TermsPage() {
  const { m, locale } = await getI18n();
  if (locale === "en") {
    return (
      <StaticPage title={m.nav.terms} draft={!legalPagesFinal()} updated="October 28, 2026">
        <p>
          <em>This is a translation for convenience. If there is any difference, the Japanese version prevails.</em>
        </p>
        <h2>Article 1 (The Service)</h2>
        <p>This service provides estimated sunlight, shade and weather information for each travel route. Operator: <OperatorName locale="en" /></p>
        <h2>Article 2 (Nature of the information)</h2>
        <ol>
          <li>Information about sunlight, shade and heat shown by this service is an estimate or forecast based on external data and calculations, and may differ from actual conditions.</li>
          <li>Information from this service does not guarantee that heatstroke or other harm to your health will not occur. Please use your own judgement based on how you feel and your surroundings.</li>
          <li>Route, timetable, weather and other information is provided by third parties, and we do not guarantee its accuracy, completeness or timeliness.</li>
        </ol>
        <h2>Article 3 (Prohibited conduct)</h2>
        <ul>
          <li>Placing an excessive load on this service or its external data providers (including automated mass access)</li>
          <li>Conduct that violates laws, regulations or public order and morals</li>
          <li>Conduct that interferes with the operation of this service</li>
        </ul>
        <h2>Article 4 (Disclaimer)</h2>
        <p>To the extent permitted by law, the operator is not liable for any damage arising from use of this service.</p>
        <h2>Article 5 (Changes and suspension)</h2>
        <p>The operator may change the content of this service or stop providing it without prior notice.</p>
        <h2>Article 6 (Governing law and jurisdiction)</h2>
        <p>These terms are governed by the laws of Japan. Competent court: <Court locale="en" /></p>
      </StaticPage>
    );
  }
  return (
    <StaticPage title={m.nav.terms} draft={!legalPagesFinal()} updated="2026年10月28日">
      <h2>第1条（本サービス）</h2>
      <p>本サービスは、移動経路ごとの日差し・日陰・気象の推定情報を提供するものです。運営者: <OperatorName locale="ja" /></p>
      <h2>第2条（情報の性質）</h2>
      <ol>
        <li>本サービスが表示する日差し・日陰・暑さに関する情報は、外部データと計算に基づく推定または予報であり、実際の状況と異なる場合があります。</li>
        <li>本サービスの情報は、熱中症その他の健康被害が生じないことを保証するものではありません。体調や周囲の状況に応じて、ご自身で判断してください。</li>
        <li>経路・時刻表・気象等の情報は第三者が提供するものであり、その正確性・完全性・最新性を保証しません。</li>
      </ol>
      <h2>第3条（禁止事項）</h2>
      <ul>
        <li>本サービスや外部データ提供元に過度な負荷をかける行為（自動化された大量アクセスを含む）</li>
        <li>法令または公序良俗に違反する行為</li>
        <li>本サービスの運営を妨げる行為</li>
      </ul>
      <h2>第4条（免責）</h2>
      <p>運営者は、本サービスの利用により生じた損害について、法令上許される範囲で責任を負いません。</p>
      <h2>第5条（変更・停止）</h2>
      <p>運営者は、事前の通知なく本サービスの内容を変更し、または提供を停止することがあります。</p>
      <h2>第6条（準拠法・管轄）</h2>
      <p>本規約は日本法に準拠します。管轄裁判所: <Court locale="ja" /></p>
    </StaticPage>
  );
}
