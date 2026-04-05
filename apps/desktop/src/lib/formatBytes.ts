export type FormatLocale = "en" | "zh";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

const localeMap: Record<FormatLocale, string> = {
  en: "en-US",
  zh: "zh-CN",
};

function formatNumber(value: number, locale: FormatLocale, fractionDigits: number): string {
  return new Intl.NumberFormat(localeMap[locale], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatBytes(bytes: number, locale: FormatLocale): string {
  if (bytes >= GB) {
    return `${formatNumber(bytes / GB, locale, 2)} GB`;
  }
  if (bytes >= MB) {
    return `${formatNumber(bytes / MB, locale, 2)} MB`;
  }
  if (bytes >= KB) {
    return `${formatNumber(bytes / KB, locale, 2)} KB`;
  }
  return `${formatNumber(bytes, locale, 0)} B`;
}
