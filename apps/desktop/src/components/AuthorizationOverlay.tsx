import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";

interface AuthorizationOverlayProps {
  locale: Locale;
  visible: boolean;
}

export function AuthorizationOverlay({ locale, visible }: AuthorizationOverlayProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className="authorization-overlay" role="status" aria-live="polite">
      <div className="authorization-overlay-card">
        <span className="authorization-chip">{t(locale, "authorizationModeBadge")}</span>
        <h2>{t(locale, "authorizationModePendingTitle")}</h2>
        <p className="body-copy authorization-copy">{t(locale, "authorizationModePendingBody")}</p>
        <div className="progress-shell authorization-progress-shell" aria-label={t(locale, "authorizationModePendingTitle")}>
          <div className="progress-bar progress-bar-indeterminate" />
        </div>
        <ul className="authorization-list">
          <li>{t(locale, "authorizationModeNextItemPrompt")}</li>
          <li>{t(locale, "authorizationModeNextItemWindow")}</li>
          <li>{t(locale, "authorizationModePendingFallback")}</li>
        </ul>
      </div>
    </div>
  );
}
