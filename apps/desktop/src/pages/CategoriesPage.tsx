import { AuthorizationCallout } from "../components/AuthorizationCallout";
import { useMemo, useState } from "react";
import { formatRiskTier, t, translateCategoryFromMetadata, type Locale } from "../lib/i18n";
import { useAppState } from "../state/appState";

interface CategoriesPageProps {
  locale: Locale;
  isProcessElevated: boolean;
  onRunPreparedScan: () => void;
  onRestartAsAdministrator: () => void;
  scanStatus: "idle" | "loading" | "ready" | "error";
  scanError: string | null;
  actionsDisabled: boolean;
  authorizationStatus: "idle" | "loading" | "error";
}

export function CategoriesPage({ locale, isProcessElevated, onRunPreparedScan, onRestartAsAdministrator, scanStatus, scanError, actionsDisabled, authorizationStatus }: CategoriesPageProps): JSX.Element {
  const categories = useAppState((state) => state.categories);
  const latestScan = useAppState((state) => state.latestScan);
  const categoryFilter = useAppState((state) => state.categoryFilter);
  const setCategoryFilter = useAppState((state) => state.setCategoryFilter);
  const preparedCategoryIds = useAppState((state) => state.preparedCategoryIds);
  const setPreparedCategoryIds = useAppState((state) => state.setPreparedCategoryIds);
  const togglePreparedCategoryId = useAppState((state) => state.togglePreparedCategoryId);
  const setActivePage = useAppState((state) => state.setActivePage);
  const setSelectedResultCategoryId = useAppState((state) => state.setSelectedResultCategoryId);
  const setResultsMode = useAppState((state) => state.setResultsMode);
  const setLastListResultsMode = useAppState((state) => state.setLastListResultsMode);
  const [query, setQuery] = useState("");

  const safeDefaultIds = useMemo(() => categories.filter((category) => category.includedInSafeDefaults).map((category) => category.id), [categories]);
  const adminCategoryIds = useMemo(() => categories.filter((category) => category.requiresAdmin).map((category) => category.id), [categories]);
  const preparedCategories = useMemo(() => categories.filter((category) => preparedCategoryIds.includes(category.id)), [categories, preparedCategoryIds]);
  const reviewablePreparedIds = useMemo(() => {
    if (!latestScan) {
      return [];
    }
    return latestScan.categories.filter((category) => preparedCategoryIds.includes(category.categoryId)).map((category) => category.categoryId);
  }, [latestScan, preparedCategoryIds]);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = categories.filter((category) => {
      const matchesFilter = categoryFilter === "all"
        || (categoryFilter === "safe-defaults" && category.includedInSafeDefaults)
        || (categoryFilter === "admin" && category.requiresAdmin);
      const haystack = [
        category.id,
        category.displayName,
        category.description,
        category.categoryGroup,
        category.badgeLabel,
        category.safetyNote,
      ].join(" ").toLowerCase();
      const matchesQuery = normalized.length === 0 || haystack.includes(normalized);
      return matchesFilter && matchesQuery;
    });

    return [...filtered.reduce((groups, category) => {
      const group = groups.get(category.categoryGroup);
      if (group) {
        group.push(category);
      } else {
        groups.set(category.categoryGroup, [category]);
      }
      return groups;
    }, new Map<string, typeof filtered>()).entries()];
  }, [categories, categoryFilter, query]);

  const openPreparedResults = () => {
    if (!latestScan) {
      return;
    }
    const targetCategoryId = reviewablePreparedIds[0] ?? latestScan.categories[0]?.categoryId ?? null;
    if (!targetCategoryId) {
      return;
    }
    setSelectedResultCategoryId(targetCategoryId);
    setLastListResultsMode("prepared");
    setResultsMode("prepared");
    setActivePage("results");
  };

  return (
    <section className="page-shell">
      <div className="panel">
        <h2>{t(locale, "categoriesPageTitle")}</h2>
        <p>{t(locale, "categoriesPageBody")}</p>

        <div className="category-summary-grid">
          <div className="summary-card">
            <span>{t(locale, "categoriesSelectedCount")}</span>
            <strong>{preparedCategoryIds.length}</strong>
          </div>
          <div className="summary-card">
            <span>{t(locale, "categoriesSafeDefaultCount")}</span>
            <strong>{preparedCategories.filter((category) => category.includedInSafeDefaults).length}</strong>
          </div>
          <div className="summary-card">
            <span>{t(locale, "categoriesAdminCount")}</span>
            <strong>{preparedCategories.filter((category) => category.requiresAdmin).length}</strong>
          </div>
        </div>

        <div className="results-toolbar-actions categories-toolbar">
          <input
            className="tree-search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(locale, "categorySearchPlaceholder")}
            type="search"
            value={query}
          />
          <div className="filter-row">
            <button className={categoryFilter === "all" ? "secondary-button filter-button filter-button-active" : "secondary-button filter-button"} disabled={actionsDisabled} onClick={() => setCategoryFilter("all")} type="button">{t(locale, "categoriesFilterAll")}</button>
            <button className={categoryFilter === "safe-defaults" ? "secondary-button filter-button filter-button-active" : "secondary-button filter-button"} disabled={actionsDisabled} onClick={() => setCategoryFilter("safe-defaults")} type="button">{t(locale, "categoriesFilterSafeDefaults")}</button>
            <button className={categoryFilter === "admin" ? "secondary-button filter-button filter-button-active" : "secondary-button filter-button"} disabled={actionsDisabled} onClick={() => setCategoryFilter("admin")} type="button">{t(locale, "categoriesFilterAdmin")}</button>
          </div>
        </div>

        <div className="category-card-actions">
          <button className="chip-button" disabled={preparedCategoryIds.length === 0 || actionsDisabled} onClick={onRunPreparedScan} type="button">{scanStatus === "loading" ? t(locale, "scanning") : t(locale, "scanPreparedSet")}</button>
          <button className="chip-button" disabled={actionsDisabled} onClick={() => setPreparedCategoryIds(safeDefaultIds)} type="button">{t(locale, "categoriesApplySafeDefaults")}</button>
          <button className="chip-button" disabled={actionsDisabled} onClick={() => setPreparedCategoryIds(adminCategoryIds)} type="button">{t(locale, "categoriesApplyAdminPreset")}</button>
          <button className="chip-button" disabled={actionsDisabled} onClick={() => setPreparedCategoryIds([])} type="button">{t(locale, "categoriesClearSelection")}</button>
          <button className="chip-button" disabled={actionsDisabled || !latestScan || reviewablePreparedIds.length === 0} onClick={openPreparedResults} type="button">{t(locale, "categoriesOpenPreparedResults")}</button>
        </div>

        <p className="category-hint">{latestScan && reviewablePreparedIds.length > 0 ? t(locale, "categoriesPreparedSafeScanHint") : t(locale, "categoriesPreparedHint")}</p>
        <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
        {scanError ? <p className="error-copy">{scanError}</p> : null}

        {filteredGroups.length === 0 ? (
          <p>{t(locale, "categoriesEmptyState")}</p>
        ) : (
          <div className="category-groups">
            {filteredGroups.map(([group, groupCategories]) => (
              <section key={group} className="category-group-block">
                <h3>{group}</h3>
                <div className="category-card-grid">
                  {groupCategories.map((category) => {
                    const isPrepared = preparedCategoryIds.includes(category.id);
                    return (
                      <article key={category.id} className={isPrepared ? "category-card category-card-selected" : "category-card"}>
                        <p className="eyebrow">{category.badgeLabel}</p>
                        <h4>{translateCategoryFromMetadata(locale, category)}</h4>
                        <p>{category.description}</p>
                        <p><strong>{t(locale, "riskTierLabel")}:</strong> {formatRiskTier(locale, category.riskTier)}</p>
                        <p><strong>{t(locale, "safetyNoteLabel")}:</strong> {category.safetyNote}</p>
                        <p><strong>{t(locale, "includedInSafeDefaultsLabel")}:</strong> {category.includedInSafeDefaults ? t(locale, "yes") : t(locale, "no")}</p>
                        <p><strong>{t(locale, "adminRequired")}:</strong> {category.requiresAdmin ? t(locale, "yes") : t(locale, "no")}</p>
                        <p><strong>{t(locale, "presetStatusLabel")}:</strong> <span className={isPrepared ? "chip-label" : "chip-label chip-label-inactive"}>{isPrepared ? t(locale, "categoriesPreparedBadge") : t(locale, "categoriesNotPreparedBadge")}</span></p>
                        <div className="category-card-actions">
                          <button className="chip-button" disabled={actionsDisabled} onClick={() => togglePreparedCategoryId(category.id)} type="button">
                            {isPrepared ? t(locale, "categoriesSelectionRemove") : t(locale, "categoriesSelectionAdd")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
