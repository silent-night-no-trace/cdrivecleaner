import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";

interface AuthorizationCalloutProps {
  locale: Locale;
  isProcessElevated: boolean;
  authorizationStatus: "idle" | "loading" | "error";
  actionsDisabled: boolean;
  onRestartAsAdministrator: () => void;
  compact?: boolean;
}

export function AuthorizationCallout({ locale, isProcessElevated, authorizationStatus, actionsDisabled, onRestartAsAdministrator, compact = false }: AuthorizationCalloutProps): JSX.Element {
  if (isProcessElevated) {
    return (
      <section className="authorization-callout authorization-callout-active">
        <div className="authorization-callout-header">
          <span className="authorization-chip">{t(locale, "authorizationModeBadgeActive")}</span>
          <h3>{t(locale, "authorizationModeActiveTitle")}</h3>
        </div>
        <p className="body-copy authorization-copy">{t(locale, "authorizationModeActiveBody")}</p>
      </section>
    );
  }

  return (
    <section className={compact ? "authorization-callout authorization-callout-compact" : "authorization-callout"}>
      <div className="authorization-callout-header">
        <span className="authorization-chip">{t(locale, "authorizationModeBadge")}</span>
        <h3>{t(locale, "authorizationModeCardTitle")}</h3>
      </div>
      <p className="body-copy authorization-copy">{t(locale, "authorizationModeCardBody")}</p>
      <div className={compact ? "authorization-grid authorization-grid-compact" : "authorization-grid"}>
        <div>
          <p className="authorization-section-title">{t(locale, "authorizationModeUnlocksTitle")}</p>
          <ul className="authorization-list">
            <li>{t(locale, "authorizationModeUnlocksItemProtected")}</li>
            <li>{t(locale, "authorizationModeUnlocksItemScan")}</li>
            <li>{t(locale, "authorizationModeUnlocksItemSession")}</li>
          </ul>
        </div>
        <div>
          <p className="authorization-section-title">{t(locale, "authorizationModeNextTitle")}</p>
          <ul className="authorization-list">
            <li>{t(locale, "authorizationModeNextItemPrompt")}</li>
            <li>{t(locale, "authorizationModeNextItemWindow")}</li>
            <li>{t(locale, "authorizationModeNextItemReopen")}</li>
          </ul>
        </div>
      </div>
      <div className="authorization-actions">
        <button className="secondary-button authorization-button" disabled={actionsDisabled} onClick={onRestartAsAdministrator} type="button">
          {authorizationStatus === "loading" ? t(locale, "authorizationModeStarting") : t(locale, "authorizationModeAction")}
        </button>
        <p className="category-hint authorization-hint">{t(locale, "authorizationModeHint")}</p>
      </div>
    </section>
  );
}
