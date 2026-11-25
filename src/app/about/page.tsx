import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import { getI18n } from "@/lib/i18n/server";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return staticPageMetadata("about", m.nav.about, "/about");
}

export default async function AboutPage() {
  const { m, locale } = await getI18n();
  return <StaticPage title={m.nav.about}>{locale === "en" ? <AboutEn promise={m.brand.promise} /> : <AboutJa promise={m.brand.promise} />}</StaticPage>;
}

function AboutJa({ promise }: { promise: string }) {
  return (
    <>
      <p>{promise}</p>
      <p>
        夏の日本では、同じ目的地でも、どの道を通るか・何時に出るかで、炎天下にいる時間が大きく変わります。
        ひかげナビは、経路ごとの「屋外にいる時間」「日差しを受ける可能性」「日陰」と、予想気温・紫外線・暑さ指数を並べて比べられるようにするサービスです。
      </p>
      <h2>大切にしていること</h2>
      <ul>
        <li>予報・観測・計算・推定を区別して表示します。</li>
        <li>データがないものは「データなし」「不明」と表示し、数字を作りません。</li>
        <li>電車・バスの時刻表は、正式なデータが設定されている場合のみ表示します。</li>
        <li>危険な暑さの警告は、おすすめの順位とは関係なく表示します。</li>
        <li>アカウント登録は不要で、検索内容や位置情報を保存しません。</li>
      </ul>
      <h2>現在の対応状況</h2>
      <ul>
        <li>道路（車・バス）と電車: 座席の左右どちらに日が当たるかの推定、天気・紫外線・暑さ指数、出発時刻の比較に対応しています（徒歩・自転車は対象外です）。</li>
        <li>電車・バス: 時刻表データ（OpenTripPlanner）が設定されている場合のみ対応します。</li>
        <li>休憩場所の案内、樹木の影の推定は未対応です。</li>
      </ul>
    </>
  );
}

function AboutEn({ promise }: { promise: string }) {
  return (
    <>
      <p>{promise}</p>
      <p>
        In a Japanese summer, the time you spend in the blazing sun can vary a lot depending on which way you go and when you leave, even to the same destination.
        Hikage Navi lets you compare each route side by side: time outdoors, chance of direct sun, shade, and the forecast temperature, UV and heat index.
      </p>
      <h2>What we care about</h2>
      <ul>
        <li>Forecasts, observations, calculations and estimates are labelled separately.</li>
        <li>Where there is no data, we say &quot;No data&quot; or &quot;Unknown&quot; instead of making up numbers.</li>
        <li>Train and bus timetables are shown only when official data is configured.</li>
        <li>Dangerous heat warnings are shown regardless of how a route is ranked.</li>
        <li>No account is needed, and your searches and location are never stored.</li>
      </ul>
      <h2>What&apos;s supported now</h2>
      <ul>
        <li>Road (car, bus) and train: which side of the vehicle gets the sun, weather, UV and heat index, and departure time comparison (walking and cycling are not covered).</li>
        <li>Trains and buses: only when timetable data (OpenTripPlanner) is configured.</li>
        <li>Rest stop suggestions and tree shade estimates are not yet supported.</li>
      </ul>
    </>
  );
}
