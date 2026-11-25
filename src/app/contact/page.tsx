import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import { getI18n } from "@/lib/i18n/server";
import { staticPageMetadata } from "@/lib/seo/metadata";
import { legalPagesFinal } from "@/lib/config/site";
import { ContactLinks } from "@/components/SiteDetails";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return staticPageMetadata("contact", m.nav.contact, "/contact");
}

export default async function ContactPage() {
  const { m, locale } = await getI18n();
  return (
    <StaticPage title={m.nav.contact} draft={!legalPagesFinal()}>
      {locale === "en" ? (
        <>
          <p>For questions about this service or to report incorrect data, please contact us below.</p>
          <p>
            Contact: <ContactLinks locale="en" />
          </p>
          <h2>Before you contact us</h2>
          <ul>
            <li>Errors in map or building information can often be corrected directly on OpenStreetMap.</li>
            <li>For the weather forecast and heat index values themselves, please check each provider (Open-Meteo, Ministry of the Environment).</li>
            <li>Please do not send sensitive information such as your personal location.</li>
          </ul>
        </>
      ) : (
        <>
          <p>本サービスに関するお問い合わせ・データの誤りのご報告は、以下の窓口までお寄せください。</p>
          <p>
            連絡先: <ContactLinks locale="ja" />
          </p>
          <h2>お問い合わせの前に</h2>
          <ul>
            <li>地図や建物の情報の誤りは、OpenStreetMap で直接修正できる場合があります。</li>
            <li>気象予報・暑さ指数の値そのものについては、各提供元（Open-Meteo、環境省）の情報をご確認ください。</li>
            <li>個人の位置情報など、機微な情報はお送りにならないでください。</li>
          </ul>
        </>
      )}
    </StaticPage>
  );
}
