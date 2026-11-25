import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import { getI18n } from "@/lib/i18n/server";
import { staticPageMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return staticPageMetadata("howItWorks", m.nav.howItWorks, "/how-it-works");
}

export default async function HowItWorksPage() {
  const { m, locale } = await getI18n();
  return <StaticPage title={m.nav.howItWorks}>{locale === "en" ? <HowItWorksEn /> : <HowItWorksJa />}</StaticPage>;
}

function HowItWorksJa() {
  return (
    <>
      <p>
        ひかげナビは、経路・太陽の位置・建物・気象予報を組み合わせて、移動中の日差しや暑さを「推定」します。
        ここでは、それぞれの値がどのように計算され、どこに限界があるのかを説明します。
      </p>

      <h2>1. 4つの異なる情報を区別しています</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">情報</th>
            <th scope="col">内容</th>
            <th scope="col">表示</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>太陽の位置</td>
            <td>日時と場所から天文計算で求めた太陽の高さ・方角。雲や建物は関係ありません。</td>
            <td>天文計算</td>
          </tr>
          <tr>
            <td>日差しの可能性</td>
            <td>太陽が出ていて、建物の影にならないと推定された時間。雲は含みません。</td>
            <td>推定</td>
          </tr>
          <tr>
            <td>日陰</td>
            <td>地図データの建物の形と高さから、影に入ると推定された時間。</td>
            <td>建物データからの推定</td>
          </tr>
          <tr>
            <td>実際の日照</td>
            <td>その場所で実際に日が当たったかどうかの観測。現在このサービスでは扱っていません。</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>

      <h2>2. 区間ごとの計算</h2>
      <ol>
        <li>経路検索サービスから、経路の形と所要時間を取得します（区間ごとの所要時間が提供される場合はそれを使います）。</li>
        <li>経路を短い区間（屋外は約30秒ごと、車内は約1分ごと）に分け、各区間を通過する時刻を推定します。</li>
        <li>各区間の中点・通過時刻で、太陽の方位角と高度を計算します（ライブラリ: astronomy-engine）。</li>
        <li>屋外の区間では、太陽の方向へ水平に線を伸ばし、建物の外周と交わる距離 d と建物の高さ H から、H &gt; d × tan(太陽高度) なら影と判定します。</li>
        <li>区間の結果を合計し、分単位に丸めて表示します。秒単位の精度はありません。</li>
      </ol>

      <h2>3. 日陰が「不明」になる場合</h2>
      <ul>
        <li>光線上の建物に高さの情報がない（OpenStreetMap の建物の多くは高さが未登録です）。</li>
        <li>近く（約100m以内）に建物データがまったくない。データがないことは、日なたであることを意味しません。</li>
        <li>太陽が低く、調べた範囲（約200m）より遠い建物の影を否定できない。</li>
        <li>経路が長い（初期設定では5kmを超える）ため、建物データを取得していない。</li>
      </ul>
      <p>樹木・地形・アーケード・歩道橋の影は、現在ほとんど考慮していません。建物の階数しか分からない場合は1階あたり3mとして高さを推定し、精度が低いものとして扱います。</p>

      <h2>4. 電車・車の「左右」の推定</h2>
      <p>
        線路や道路の向きを区間ごとに求め、太陽が進行方向の右側（30°〜150°）にあれば右側、左側にあれば左側に日が差し込みやすいとみなします。
        太陽が高い（60°以上）ときは窓から差し込みにくいため左右を区別しません。カーブの多い路線でも区間ごとに計算します。
      </p>
      <p>雲・沿線の建物・トンネル・座席の向きは考慮していません。車の場合、窓ガラスやスモークなどで大きく変わり、車内温度の予測ではありません。</p>

      <h2>5. 気象・紫外線・暑さ指数</h2>
      <ul>
        <li>気温・湿度・風速・雲量・降水確率・UVインデックスは、経路上の複数地点で、その地点を通過する時刻に最も近い毎時の予報値を使います（出発地の現在値で代用しません）。</li>
        <li>これらは数値予報モデルの値（Open-Meteo）で、気象庁の公式な予報発表ではありません。</li>
        <li>暑さ指数（WBGT）は、環境省が発表する予測値がある場合のみ、最寄りの地点（初期設定では25km以内）の値を表示します。気温と湿度から独自に計算することはしません。</li>
        <li>出発日時が7日より先の場合、予報の不確実性が大きいため気象は表示しません（太陽の位置は計算します）。</li>
      </ul>

      <h2>6. おすすめの順位</h2>
      <p>
        選んだ条件（所要時間・屋外時間・日差しなど）ごとに、候補の値を最小〜最大で0〜1に揃え、重み付きで合計して並べます。
        ある候補だけデータが欠けている場合は、その指標を「最も不利」として扱い、データの欠損で有利になることはありません。
        すべての候補でデータがない条件は順位に反映せず、その旨を表示します。
      </p>
      <p>
        <strong>順位や一致度は、候補同士の相対比較です。</strong>危険な暑さの警告は順位とは独立に表示され、順位が高いことは安全を意味しません。
      </p>
    </>
  );
}

function HowItWorksEn() {
  return (
    <>
      <p>
        Hikage Navi combines routes, the sun&apos;s position, buildings and weather forecasts to <em>estimate</em> the sunlight and heat you&apos;ll meet on the way.
        This page explains how each value is calculated and where its limits are.
      </p>

      <h2>1. We keep four kinds of information separate</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Information</th>
            <th scope="col">What it is</th>
            <th scope="col">Label</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sun position</td>
            <td>The sun&apos;s height and direction, calculated astronomically from the date, time and place. Clouds and buildings play no part.</td>
            <td>Astronomical</td>
          </tr>
          <tr>
            <td>Possible sun</td>
            <td>Time when the sun is up and you are estimated not to be in a building&apos;s shadow. Clouds are not included.</td>
            <td>Estimate</td>
          </tr>
          <tr>
            <td>Shade</td>
            <td>Time estimated to be in shadow, based on building shapes and heights in map data.</td>
            <td>Estimated from buildings</td>
          </tr>
          <tr>
            <td>Actual sunshine</td>
            <td>An observation of whether the sun actually reached that spot. This service does not currently provide it.</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>

      <h2>2. Calculating each stretch</h2>
      <ol>
        <li>We get the route shape and travel time from a routing service (using per-leg times when they are provided).</li>
        <li>We split the route into short stretches (about every 30 seconds outdoors, every minute in vehicles) and estimate when you pass each one.</li>
        <li>For the midpoint and passing time of each stretch, we calculate the sun&apos;s azimuth and elevation (library: astronomy-engine).</li>
        <li>
          Outdoors, we cast a horizontal line toward the sun. If it meets a building outline at distance d and the building height H satisfies H &gt; d × tan(sun elevation), the stretch is judged to be in shadow.
        </li>
        <li>We add up the results and show them rounded to the minute. There is no per-second precision.</li>
      </ol>

      <h2>3. When shade is &quot;Unknown&quot;</h2>
      <ul>
        <li>A building along the ray has no height information (most buildings in OpenStreetMap have no height recorded).</li>
        <li>There is no building data at all nearby (within about 100 m). Missing data does not mean it is sunny.</li>
        <li>The sun is so low that shadows from buildings beyond the search range (about 200 m) can&apos;t be ruled out.</li>
        <li>The route is long (over 5 km by default), so building data was not fetched.</li>
      </ul>
      <p>
        Shadows from trees, terrain, arcades and pedestrian bridges are mostly not considered yet. When only a building&apos;s floor count is known, we assume 3 m per floor and treat the height as low-confidence.
      </p>

      <h2>4. Estimating &quot;left&quot; and &quot;right&quot; for trains and cars</h2>
      <p>
        We work out the direction of the track or road for each stretch. If the sun is on the right of the direction of travel (30°–150°), the right side is likely to get sun; likewise for the left.
        When the sun is high (60° or more) it rarely shines in through the windows, so we don&apos;t distinguish sides. Lines with many curves are still calculated stretch by stretch.
      </p>
      <p>
        Clouds, buildings along the line, tunnels and seat direction are not considered. For cars, results vary a lot with window glass and tinting, and this is not a forecast of the temperature inside the car.
      </p>

      <h2>5. Weather, UV and heat index</h2>
      <ul>
        <li>
          Temperature, humidity, wind, cloud cover, chance of rain and UV index come from hourly forecasts at several points along the route, using the hour closest to when you pass each point (not the current value at the starting point).
        </li>
        <li>These are numerical weather model values (Open-Meteo), not official Japan Meteorological Agency forecasts.</li>
        <li>
          The heat index (WBGT) is shown only when the Ministry of the Environment has issued a forecast, using the nearest station (within 25 km by default). We never calculate it ourselves from temperature and humidity.
        </li>
        <li>If you depart more than 7 days ahead, we don&apos;t show weather because forecasts are too uncertain (the sun&apos;s position is still calculated).</li>
      </ul>

      <h2>6. Recommendation ranking</h2>
      <p>
        For each priority you choose (travel time, time outdoors, sunlight, etc.), we scale the routes&apos; values from 0 to 1 between the minimum and maximum, then rank them by a weighted total.
        If only some routes are missing data for a measure, those routes are treated as the worst for it, so missing data never gives an advantage.
        Priorities with no data for any route are left out of the ranking, and we tell you so.
      </p>
      <p>
        <strong>Ranks and match scores only compare the routes with each other.</strong> Dangerous heat warnings are shown independently of the ranking, and a high rank does not mean a route is safe.
      </p>
    </>
  );
}
