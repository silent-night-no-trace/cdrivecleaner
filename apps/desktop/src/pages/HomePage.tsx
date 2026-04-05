import { AuthorizationCallout } from "../components/AuthorizationCallout";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";

interface HomePageProps {
  locale: Locale;
  isProcessElevated: boolean;
  onQuickScan: () => void;
  onFullScan: () => void;
  onQuickCleanRequest: () => void;
  onRestartAsAdministrator: () => void;
  canQuickClean: boolean;
  scanStatus: "idle" | "loading" | "ready" | "error";
  fullScanStatus: "idle" | "loading" | "ready" | "error";
  cleanStatus: "idle" | "loading" | "ready" | "error";
  scanError: string | null;
  fullScanError: string | null;
  cleanError: string | null;
  actionsDisabled: boolean;
  authorizationStatus: "idle" | "loading" | "error";
}

export function HomePage({ locale, isProcessElevated, onQuickScan, onFullScan, onQuickCleanRequest, onRestartAsAdministrator, canQuickClean, scanStatus, fullScanStatus, cleanStatus, scanError, fullScanError, cleanError, actionsDisabled, authorizationStatus }: HomePageProps): JSX.Element {
  return (
    <section className="page-shell">
      <div className="hero-card">
        <p className="eyebrow">{t(locale, "safeReclaim")}</p>
        <h1>{t(locale, "homeTitle")}</h1>
        <p className="body-copy">{t(locale, "homeBody")}</p>
        <div className="button-row">
          <button className="primary-button" disabled={actionsDisabled} onClick={onQuickScan} type="button">
            {scanStatus === "loading" ? t(locale, "scanning") : t(locale, "quickScan")}
          </button>
          <button className="secondary-button" onClick={onFullScan} disabled={actionsDisabled} type="button">
            {fullScanStatus === "loading" ? t(locale, "fullScanning") : t(locale, "fullScan")}
          </button>
          <button className="secondary-button" disabled={!canQuickClean || actionsDisabled} onClick={onQuickCleanRequest} type="button">
            {cleanStatus === "loading" ? t(locale, "cleaning") : t(locale, "reviewClean")}
          </button>
        </div>
        <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
        {scanError ? <p className="error-copy">{scanError}</p> : null}
        {fullScanError ? <p className="error-copy">{fullScanError}</p> : null}
        {cleanError ? <p className="error-copy">{cleanError}</p> : null}
      </div>
    </section>
  );
}
