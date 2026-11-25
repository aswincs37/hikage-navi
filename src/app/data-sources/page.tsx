import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import type { Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.nav.dataSources, alternates: { canonical: "/data-sources" } };
}

interface Row {
  name: string;
  org: string;
  use: string;
  kind: string;
  note: string;
}

const rows: ({ href: string } & Record<Locale, Row>)[] = [
  {
    href: "https://maps.gsi.go.jp/development/ichiran.html",
    ja: { name: "地理院タイル（淡色地図）", org: "国土地理院", use: "背景地図", kind: "地図", note: "出典の明示により利用可。" },
    en: { name: "GSI Tiles (pale map)", org: "Geospatial Information Authority of Japan", use: "Base map", kind: "Map", note: "Free to use with attribution." },
  },
  {
    href: "https://msearch.gsi.go.jp/",
    ja: { name: "住所検索API", org: "国土地理院", use: "住所・地名の検索", kind: "地名検索", note: "サービス水準の保証なし。" },
    en: { name: "Address Search API", org: "Geospatial Information Authority of Japan", use: "Address and place search", kind: "Place search", note: "No service level guarantee." },
  },
  {
    href: "https://operations.osmfoundation.org/policies/nominatim/",
    ja: { name: "Nominatim", org: "OpenStreetMap Foundation", use: "駅・施設名の検索", kind: "地名検索", note: "公開サーバーは1秒1回まで・入力補完での利用禁止。本番では自前の設置が望ましい。" },
    en: {
      name: "Nominatim",
      org: "OpenStreetMap Foundation",
      use: "Station and facility search",
      kind: "Place search",
      note: "Public server limited to 1 request per second; autocomplete not allowed. Self-hosting is recommended in production.",
    },
  },
  {
    href: "https://photon.komoot.io/",
    ja: { name: "Photon", org: "komoot / OpenStreetMap", use: "入力中の地名・駅名の候補", kind: "地名検索", note: "公開サーバーは節度ある利用が条件。データは ODbL。本番では自前の設置が望ましい。" },
    en: {
      name: "Photon",
      org: "komoot / OpenStreetMap",
      use: "Place and station suggestions while typing",
      kind: "Place search",
      note: "Public server for fair use only. Data under ODbL. Self-hosting is recommended in production.",
    },
  },
  {
    href: "https://routing.openstreetmap.de/about.html",
    ja: { name: "OSRM（FOSSGIS 公開サーバー）", org: "FOSSGIS e.V. / OpenStreetMap", use: "道路（車・バス）の経路", kind: "経路データ", note: "開発・試験用。本番では自前の OSRM を推奨。" },
    en: {
      name: "OSRM (FOSSGIS public server)",
      org: "FOSSGIS e.V. / OpenStreetMap",
      use: "Road routes (car, bus)",
      kind: "Route data",
      note: "For development and testing. A self-hosted OSRM is recommended in production.",
    },
  },
  {
    href: "https://wiki.openstreetmap.org/wiki/Overpass_API",
    ja: { name: "Overpass API", org: "OpenStreetMap コミュニティ", use: "建物の形・高さ（日陰の推定）", kind: "建物データからの推定", note: "データは ODbL。公開サーバーには利用上限あり。" },
    en: {
      name: "Overpass API",
      org: "OpenStreetMap community",
      use: "Building shapes and heights (shade estimates)",
      kind: "Estimated from buildings",
      note: "Data under ODbL. Public servers have usage limits.",
    },
  },
  {
    href: "https://open-meteo.com/en/terms",
    ja: { name: "Open-Meteo 予報API", org: "Open-Meteo", use: "気温・湿度・風速・雲量・降水確率・UVインデックス", kind: "モデル予報", note: "無料APIは非商用向け。商用利用は有償プランが必要。CC BY 4.0。" },
    en: {
      name: "Open-Meteo Forecast API",
      org: "Open-Meteo",
      use: "Temperature, humidity, wind, cloud cover, chance of rain, UV index",
      kind: "Model forecast",
      note: "Free API is for non-commercial use; commercial use needs a paid plan. CC BY 4.0.",
    },
  },
  {
    href: "https://www.wbgt.env.go.jp/",
    ja: { name: "暑さ指数（WBGT）予測値", org: "環境省 熱中症予防情報サイト", use: "暑さ指数の予測", kind: "公式予報", note: "例年4月下旬〜10月下旬のみ提供。" },
    en: {
      name: "Heat index (WBGT) forecast",
      org: "Ministry of the Environment, Heatstroke Prevention Information",
      use: "Heat index forecast",
      kind: "Official forecast",
      note: "Usually available only from late April to late October.",
    },
  },
  {
    href: "https://www.jma.go.jp/jma/kishou/info/coment.html",
    ja: { name: "アメダス地点情報", org: "気象庁", use: "暑さ指数の地点の位置", kind: "地点情報", note: "気象庁ホームページの公開データ（仕様変更の可能性あり）。" },
    en: {
      name: "AMeDAS station information",
      org: "Japan Meteorological Agency",
      use: "Locations of heat index stations",
      kind: "Station data",
      note: "Public data from the JMA website (format may change).",
    },
  },
  {
    href: "https://www.opentripplanner.org/",
    ja: { name: "OpenTripPlanner（設定時のみ）", org: "運営者が設置", use: "電車・バスの経路と時刻", kind: "時刻表データ", note: "時刻表（GTFS / GTFS-JP）の入手と利用許諾は事業者ごとに異なる。" },
    en: {
      name: "OpenTripPlanner (only if configured)",
      org: "Hosted by the operator",
      use: "Train and bus routes and times",
      kind: "Timetable data",
      note: "How to obtain and license timetables (GTFS / GTFS-JP) differs by operator.",
    },
  },
];

const text = {
  ja: {
    intro: "このサービスは以下のデータを利用しています。各データの利用条件は、提供元の最新の規約をご確認ください。",
    headers: ["データ", "提供元", "用途", "種類", "備考"],
    attributionTitle: "帰属表示",
    attributions: [
      "地図データ・建物データ・経路: © OpenStreetMap contributors（ODbL）",
      "背景地図: 地理院タイル（国土地理院）",
      "Weather data by Open-Meteo.com（CC BY 4.0）",
      "暑さ指数: 環境省 熱中症予防情報サイト",
      "地点情報: 気象庁ホームページ",
    ],
    transitTitle: "電車・バスの時刻表について",
    transitBody:
      "全国の鉄道・バスの時刻表を網羅するデータは、多くの場合、有償の利用許諾が必要です。このサービスは時刻表を独自に作成することはなく、運営者が正式に入手した時刻表データ（GTFS 等）を OpenTripPlanner に読み込ませた場合に限り、電車・バスの経路を表示します。設定されていない場合、電車・バスの検索は「利用できません」と表示されます。",
  },
  en: {
    intro: "This service uses the data below. Please check each provider's latest terms for the conditions of use.",
    headers: ["Data", "Provider", "Used for", "Type", "Notes"],
    attributionTitle: "Attribution",
    attributions: [
      "Map, building and route data: © OpenStreetMap contributors (ODbL)",
      "Base map: GSI Tiles (Geospatial Information Authority of Japan)",
      "Weather data by Open-Meteo.com (CC BY 4.0)",
      "Heat index: Ministry of the Environment, Heatstroke Prevention Information",
      "Station data: Japan Meteorological Agency website",
    ],
    transitTitle: "About train and bus timetables",
    transitBody:
      "Data covering every railway and bus timetable in Japan usually requires a paid license. This service never creates its own timetables; it shows train and bus routes only when the operator has loaded officially obtained timetable data (GTFS, etc.) into OpenTripPlanner. Otherwise, train and bus searches show \"Not available\".",
  },
};

export default async function DataSourcesPage() {
  const { m, locale } = await getI18n();
  const t = text[locale];
  return (
    <StaticPage title={m.nav.dataSources}>
      <p>{t.intro}</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              {t.headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const r = row[locale];
              return (
                <tr key={row.href}>
                  <td>
                    <a href={row.href} target="_blank" rel="noreferrer">
                      {r.name}
                    </a>
                  </td>
                  <td>{r.org}</td>
                  <td>{r.use}</td>
                  <td>{r.kind}</td>
                  <td>{r.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2>{t.attributionTitle}</h2>
      <ul>
        {t.attributions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <h2>{t.transitTitle}</h2>
      <p>{t.transitBody}</p>
    </StaticPage>
  );
}
