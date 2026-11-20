import type { Metadata } from "next";
import { StaticPage } from "@/components/StaticPage";
import { getI18n } from "@/lib/i18n/server";
import { legalPagesFinal } from "@/lib/config/site";
import { ContactLinks, OperatorName } from "@/components/SiteDetails";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.nav.privacy };
}

export default async function PrivacyPage() {
  const { m, locale } = await getI18n();
  if (locale === "en") {
    return (
      <StaticPage title={`${m.nav.privacy} policy`} draft={!legalPagesFinal()} updated="November 20, 2026">
        <p>
          <em>This is a translation for convenience. If there is any difference, the Japanese version prevails.</em>
        </p>
        <h2>1. Information we collect</h2>
        <ul>
          <li>The origin, destination, date and time, travel mode and priorities you enter for a search</li>
          <li>Only if you press &quot;Use my location&quot;: the location from your browser (latitude and longitude, rounded to about 1 m)</li>
          <li>Your IP address, to prevent abuse (used for about one minute to count requests; if a shared request counter is used, only a scrambled value is sent, never the address itself, and it is deleted after about a minute)</li>
        </ul>
        <h2>2. How we use it</h2>
        <p>Only to search for routes, estimate sunlight and weather, and prevent abuse of the service.</p>
        <h2>3. Storage</h2>
        <p>
          We do not store your searches or location in a server database. To show the same search quickly (for example, when you share a result link), the server keeps a search result in memory only, for up to 30 minutes; it is never written to disk. Your latest 5 results are saved only in this device&apos;s browser (local storage) so you can open them without a signal. Results searched from your current location are not saved on the device. You can delete them with &ldquo;Clear history&rdquo; on the home page.
          There are no user accounts.
        </p>
        <h2>4. Sharing with third parties</h2>
        <p>To calculate routes, weather and so on, we send the coordinates and times needed for your search to the external services below. Each service&apos;s own privacy policy applies.</p>
        <ul>
          <li>Routing (OSRM, etc.), place search (Geospatial Information Authority of Japan, Nominatim), building data (Overpass API), weather (Open-Meteo), heat index (Ministry of the Environment), base map (GSI map tiles)</li>
        </ul>
        <p>We never send information that identifies you personally (name, email address, etc.).</p>
        <h2>5. Cookies and analytics</h2>
        <p>
          We use one cookie (<code>locale</code>) only to remember your display language. We do not use cookies for tracking, and we do not use analytics tools. If we introduce them, we will update this policy.
        </p>
        <h2>6. Logs</h2>
        <p>Server error logs are designed not to record request contents that include location. However, our hosting provider may keep access logs.</p>
        <h2>7. Contact</h2>
        <p>
          Operator: <OperatorName locale="en" />
          <br />
          Contact: <ContactLinks locale="en" />
        </p>
      </StaticPage>
    );
  }
  return (
    <StaticPage title={`${m.nav.privacy}ポリシー`} draft={!legalPagesFinal()} updated="2026年11月20日">
      <h2>1. 取得する情報</h2>
      <ul>
        <li>検索のために入力された出発地・目的地・日時・移動手段・希望条件</li>
        <li>「現在地を使う」ボタンを押した場合に限り、ブラウザから取得した位置情報（緯度・経度、約1m単位に丸めます）</li>
        <li>不正利用防止のためのIPアドレス（アクセス回数の確認のために約1分間だけ扱います。共有の回数カウンターを使う場合も、IPアドレスはそのままの形では送らず、変換した値を約1分で消去します）</li>
      </ul>
      <h2>2. 利用目的</h2>
      <p>経路の検索、日差し・気象の推定、サービスの不正利用の防止のためにのみ利用します。</p>
      <h2>3. 保存について</h2>
      <p>
        検索内容・位置情報をサーバーのデータベースに保存しません。同じ検索（共有されたリンクなど）をすばやく表示するため、検索結果をサーバーのメモリ上にのみ最大30分間保持します（ディスクには書き込みません）。また、電波が無い場所でも見られるよう、最新5件の検索結果をお使いの端末のブラウザ（ローカルストレージ）にのみ保存します。「現在地」から調べた結果は端末にも保存しません。ホームの「履歴を消す」で削除できます。
        アカウント登録の機能はありません。
      </p>
      <h2>4. 第三者への送信</h2>
      <p>経路・気象などを求めるため、検索に必要な座標・日時を以下の外部サービスへ送信します。各サービスのプライバシーポリシーが適用されます。</p>
      <ul>
        <li>経路検索（OSRM 等）、地名検索（国土地理院・Nominatim）、建物データ（Overpass API）、気象（Open-Meteo）、暑さ指数（環境省）、背景地図（国土地理院の地図タイル）</li>
      </ul>
      <p>個人を特定する情報（氏名・メールアドレス等）は送信しません。</p>
      <h2>5. Cookie・アクセス解析</h2>
      <p>
        表示言語の設定を保存するためだけに、Cookie（<code>locale</code>）を1つ使用します。Cookie によるトラッキングやアクセス解析ツールは使用していません。導入する場合は本ポリシーを改定します。
      </p>
      <h2>6. ログ</h2>
      <p>サーバーのエラーログには、位置情報を含むリクエスト内容を記録しない設計としています。ただし、ホスティング事業者がアクセスログを記録する場合があります。</p>
      <h2>7. お問い合わせ窓口</h2>
      <p>
        運営者: <OperatorName locale="ja" />
        <br />
        連絡先: <ContactLinks locale="ja" />
      </p>
    </StaticPage>
  );
}
