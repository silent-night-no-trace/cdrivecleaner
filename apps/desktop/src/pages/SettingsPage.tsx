import { useEffect, useState } from "react";
import type { Locale } from "../lib/i18n";
import { formatHistoryTimestamp, t } from "../lib/i18n";
import type { ScheduledScanMode, ScheduledScanPlan, ScheduledScanPlanDraft, SettingsMetadata } from "../lib/contracts";
import type { ThemePreference } from "../state/appState";
import { formatBytes } from "../lib/formatBytes";

interface SettingsPageProps {
  locale: Locale;
  themePreference: ThemePreference;
  metadata: SettingsMetadata | null;
  metadataStatus: "loading" | "ready" | "error";
  scheduledScanPlan: ScheduledScanPlan | null;
  scheduledScanStatus: "loading" | "ready" | "saving" | "error";
  scheduledScanError: string | null;
  currentPreparedCategoryIds: string[];
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (themePreference: ThemePreference) => void;
  onSaveScheduledScanPlan: (draft: ScheduledScanPlanDraft) => void;
  onSetScheduledScanEnabled: (enabled: boolean) => void;
  onDeleteScheduledScanPlan: () => void;
}

function settingsValue(locale: Locale, metadataStatus: SettingsPageProps["metadataStatus"], value: string | null): string {
  if (metadataStatus === "loading") {
    return t(locale, "settingsLoadingValue");
  }

  if (!value) {
    return t(locale, "settingsUnavailableValue");
  }

  return value;
}

function scheduleSummary(locale: Locale, plan: ScheduledScanPlan | null): string {
  if (!plan) {
    return t(locale, "scheduledScanNotConfigured");
  }

  return plan.mode === "safeDefaults"
    ? t(locale, "scheduledScanModeSafeDefaults")
    : t(locale, "scheduledScanModePreparedPreset").replace("{count}", String(plan.capturedCategoryIds.length));
}

function scheduleTimestamp(locale: Locale, timestamp: string | null): string {
  return timestamp ? formatHistoryTimestamp(locale, timestamp) : t(locale, "settingsUnavailableValue");
}

function scheduleLastSummary(locale: Locale, plan: ScheduledScanPlan | null): string {
  if (!plan) {
    return t(locale, "scheduledLastSummaryUnavailable");
  }

  if (plan.lastRunAt !== null && plan.lastRunCategoryCount !== null && plan.lastRunEstimatedBytes !== null && plan.lastRunWarnings !== null) {
    return t(locale, "historyScheduledScanSummary")
      .replace("{categories}", String(plan.lastRunCategoryCount))
      .replace("{estimated}", formatBytes(plan.lastRunEstimatedBytes, locale))
      .replace("{warnings}", String(plan.lastRunWarnings));
  }

  return plan.lastRunSummary ?? t(locale, "scheduledLastSummaryEmpty");
}

export function SettingsPage({ locale, themePreference, metadata, metadataStatus, scheduledScanPlan, scheduledScanStatus, scheduledScanError, currentPreparedCategoryIds, onLocaleChange, onThemeChange, onSaveScheduledScanPlan, onSetScheduledScanEnabled, onDeleteScheduledScanPlan }: SettingsPageProps): JSX.Element {
  const [scheduledMode, setScheduledMode] = useState<ScheduledScanMode>(scheduledScanPlan?.mode ?? "safeDefaults");
  const [scheduledTime, setScheduledTime] = useState(scheduledScanPlan?.scheduledTime ?? "08:00");

  useEffect(() => {
    setScheduledMode(scheduledScanPlan?.mode ?? "safeDefaults");
    setScheduledTime(scheduledScanPlan?.scheduledTime ?? "08:00");
  }, [scheduledScanPlan]);

  return (
    <section className="page-shell">
      <div className="panel">
        <h2>{t(locale, "settingsTitle")}</h2>
        <p>{t(locale, "settingsBody")}</p>
        <div className="settings-stack">
          <div className="settings-row">
            <div>
              <span className="settings-label">{t(locale, "themeLabel")}</span>
              <p className="category-hint settings-hint">{t(locale, "themeHint")}</p>
            </div>
            <div className="preference-chip-row">
              <button className={themePreference === "system" ? "lang-button lang-button-active" : "lang-button"} onClick={() => onThemeChange("system")} type="button">
                {t(locale, "themeSystem")}
              </button>
              <button className={themePreference === "light" ? "lang-button lang-button-active" : "lang-button"} onClick={() => onThemeChange("light")} type="button">
                {t(locale, "themeLight")}
              </button>
              <button className={themePreference === "dark" ? "lang-button lang-button-active" : "lang-button"} onClick={() => onThemeChange("dark")} type="button">
                {t(locale, "themeDark")}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-label">{t(locale, "languageLabel")}</span>
            <div className="preference-chip-row">
              <button className={locale === "en" ? "lang-button lang-button-active" : "lang-button"} onClick={() => onLocaleChange("en")} type="button">
                {t(locale, "english")}
              </button>
              <button className={locale === "zh" ? "lang-button lang-button-active" : "lang-button"} onClick={() => onLocaleChange("zh")} type="button">
                {t(locale, "chinese")}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-label">{t(locale, "versionLabel")}</span>
            <span className="settings-value settings-value-mono">{settingsValue(locale, metadataStatus, metadata?.appVersion ?? null)}</span>
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-label">{t(locale, "logLocationLabel")}</span>
              <p className="category-hint settings-hint">{t(locale, "logLocationHint")}</p>
            </div>
            <span className="settings-value settings-value-mono">{settingsValue(locale, metadataStatus, metadata?.logDirectory ?? null)}</span>
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-label">{t(locale, "scheduledScanLabel")}</span>
              <p className="category-hint settings-hint">{t(locale, "scheduledScanHint")}</p>
            </div>
            <div className="settings-schedule-panel">
              <p className="settings-value">{scheduleSummary(locale, scheduledScanPlan)}</p>
              <div className="preference-chip-row">
                <button className={scheduledMode === "safeDefaults" ? "lang-button lang-button-active" : "lang-button"} disabled={scheduledScanStatus === "saving"} onClick={() => setScheduledMode("safeDefaults")} type="button">
                  {t(locale, "scheduledScanModeSafeDefaults")}
                </button>
                <button className={scheduledMode === "preparedPreset" ? "lang-button lang-button-active" : "lang-button"} disabled={scheduledScanStatus === "saving" || currentPreparedCategoryIds.length === 0} onClick={() => setScheduledMode("preparedPreset")} type="button">
                  {t(locale, "scheduledScanModePreparedPreset").replace("{count}", String(currentPreparedCategoryIds.length))}
                </button>
              </div>
              <div className="settings-inline-form">
                <label className="settings-inline-label" htmlFor="scheduled-time-input">{t(locale, "scheduledTimeLabel")}</label>
                <input id="scheduled-time-input" className="tree-search-input settings-time-input" disabled={scheduledScanStatus === "saving"} onChange={(event) => setScheduledTime(event.target.value)} type="time" value={scheduledTime} />
              </div>
              <div className="preference-chip-row">
                <button className="secondary-button" disabled={scheduledScanStatus === "saving" || (scheduledMode === "preparedPreset" && currentPreparedCategoryIds.length === 0)} onClick={() => onSaveScheduledScanPlan({ mode: scheduledMode, scheduledTime, enabled: scheduledScanPlan?.enabled ?? true, capturedCategoryIds: scheduledMode === "preparedPreset" ? currentPreparedCategoryIds : [] })} type="button">
                  {scheduledScanStatus === "saving" ? t(locale, "scheduledScanSaving") : t(locale, scheduledScanPlan ? "scheduledScanUpdateAction" : "scheduledScanCreateAction")}
                </button>
                {scheduledScanPlan ? (
                  <button className="secondary-button" disabled={scheduledScanStatus === "saving"} onClick={() => onSetScheduledScanEnabled(!scheduledScanPlan.enabled)} type="button">
                    {scheduledScanPlan.enabled ? t(locale, "scheduledScanDisableAction") : t(locale, "scheduledScanEnableAction")}
                  </button>
                ) : null}
                {scheduledScanPlan ? (
                  <button className="secondary-button" disabled={scheduledScanStatus === "saving"} onClick={onDeleteScheduledScanPlan} type="button">
                    {t(locale, "scheduledScanDeleteAction")}
                  </button>
                ) : null}
              </div>
              <div className="settings-metadata-grid">
                <div className="summary-card">
                  <span>{t(locale, "scheduledScanLabel")}</span>
                  <strong>{scheduledScanPlan ? (scheduledScanPlan.enabled ? t(locale, "scheduledScanStatusEnabled") : t(locale, "scheduledScanStatusDisabled")) : t(locale, "scheduledScanNotConfiguredStatus")}</strong>
                </div>
                <div className="summary-card">
                  <span>{t(locale, "scheduledNextRunLabel")}</span>
                  <strong>{scheduleTimestamp(locale, scheduledScanPlan?.nextRunAt ?? null)}</strong>
                </div>
                <div className="summary-card">
                  <span>{t(locale, "scheduledLastRunLabel")}</span>
                  <strong>{scheduleTimestamp(locale, scheduledScanPlan?.lastRunAt ?? null)}</strong>
                </div>
                <div className="summary-card settings-summary-card-wide">
                  <span>{t(locale, "scheduledLastSummaryLabel")}</span>
                  <strong>{scheduleLastSummary(locale, scheduledScanPlan)}</strong>
                </div>
              </div>
              {scheduledScanPlan?.requiresAdmin ? <p className="category-hint">{t(locale, "scheduledScanAdminHint")}</p> : null}
              {scheduledScanError ? <p className="error-copy">{scheduledScanError}</p> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
