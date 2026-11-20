import { getSiteInfo } from "@/lib/config/site";
import type { Locale } from "@/lib/i18n";

/**
 * 運営者情報（環境変数で設定）を表示する部品。未設定なら「公開前に記入」と表示する。
 */

const TODO = { ja: "【公開前に記入】", en: "[To be filled in before launch]" } as const;

export function OperatorName({ locale }: { locale: Locale }) {
  return <>{getSiteInfo().operatorName ?? TODO[locale]}</>;
}

export function Court({ locale }: { locale: Locale }) {
  return <>{getSiteInfo().court ?? TODO[locale]}</>;
}

/** 問い合わせ先（メール・フォーム）。両方あれば両方を表示する */
export function ContactLinks({ locale }: { locale: Locale }) {
  const s = getSiteInfo();
  if (!s.contactEmail && !s.contactFormUrl) return <>{TODO[locale]}</>;
  return (
    <>
      {s.contactFormUrl && (
        <a href={s.contactFormUrl} rel="noreferrer" target="_blank">
          {locale === "en" ? "Contact form" : "お問い合わせフォーム"}
        </a>
      )}
      {s.contactFormUrl && s.contactEmail && (locale === "en" ? " / " : "／")}
      {s.contactEmail && <a href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a>}
    </>
  );
}
