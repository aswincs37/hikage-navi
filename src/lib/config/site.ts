import "server-only";

/**
 * 運営者情報（環境変数）。利用規約・プライバシーポリシー・お問い合わせページに表示する。
 * 未設定の項目は「公開前に記入」と表示し、ページ上部に「下書き」の注意を出す。
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export interface SiteInfo {
  /** 公開URL（例: https://hikage-michi.jp）。外部サービスへの User-Agent にも使う */
  url?: string;
  /** 運営者名（個人名または法人名） */
  operatorName?: string;
  /** 問い合わせ用メールアドレス */
  contactEmail?: string;
  /** 問い合わせフォームのURL（メールの代わりに、または併用） */
  contactFormUrl?: string;
  /** 合意管轄裁判所（例: 東京地方裁判所） */
  court?: string;
  /** 専門家による確認が済み、規約・ポリシーを正式版として公開してよいか */
  legalReviewed: boolean;
}

export function getSiteInfo(): SiteInfo {
  return {
    url: env("SITE_URL")?.replace(/\/+$/, ""),
    operatorName: env("SITE_OPERATOR_NAME"),
    contactEmail: env("CONTACT_EMAIL"),
    contactFormUrl: env("CONTACT_FORM_URL"),
    court: env("LEGAL_COURT"),
    legalReviewed: env("LEGAL_REVIEWED") === "true",
  };
}

/** 規約・ポリシーを正式版（「下書き」表示なし）として出せるか */
export function legalPagesFinal(s: SiteInfo = getSiteInfo()): boolean {
  return s.legalReviewed && !!s.operatorName && !!(s.contactEmail || s.contactFormUrl);
}
