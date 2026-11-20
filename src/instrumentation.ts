/**
 * サーバー起動時の処理（Next.js の instrumentation）。
 * - 本番では、設定の不足（本番公開の準備状況）をログに出す
 * - サーバーで起きたエラーを、位置情報（URL の検索条件など）を含めずに記録する
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { readinessIssues } = await import("@/lib/config/readiness");
  const issues = readinessIssues();
  if (issues.length === 0) {
    console.info("[hikage-michi] production readiness: OK");
    return;
  }
  for (const i of issues) {
    const line = `[hikage-michi] readiness ${i.level.toUpperCase()} ${i.code}: ${i.message}`;
    if (i.level === "error") console.error(line);
    else console.warn(line);
  }
}

/**
 * サーバーのエラー記録。URL の検索条件（出発地・目的地の座標が入る）や本文は記録しない。
 * 外部のエラー監視サービス（Sentry など）を使う場合は、ここから送る。
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const name = err instanceof Error ? err.name : "unknown";
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const path = request.path.split("?")[0];
  console.error(`[hikage-michi] request error ${request.method} ${path} (${context.routeType} ${context.routePath}) ${name}${digest ? ` digest=${digest}` : ""}`);
}
