export type CachedReport = {
  id: number;
  image_filename: string;
  latitude: number;
  longitude: number;
  pothole_count: number;
  status: string;
  admin_note: string | null;
  created_at: string;
};

let reportDataVersion = 0;
let cachedReports: CachedReport[] | null = null;
let cachedReportsVersion = -1;
let cachedReportImages: Record<number, string> = {};
let cachedActivity: { reportCount: number; potholeCount: number } | null = null;
let cachedActivityVersion = -1;

export function getReportDataVersion(): number {
  return reportDataVersion;
}

export function getCachedReports(): CachedReport[] | null {
  return cachedReports;
}

export function getCachedReportsVersion(): number {
  return cachedReportsVersion;
}

export function setCachedReports(
  reports: CachedReport[],
  version: number
): void {
  cachedReports = reports;
  cachedReportsVersion = version;
  const reportIds = new Set(reports.map((report) => report.id));
  cachedReportImages = Object.fromEntries(
    Object.entries(cachedReportImages).filter(([id]) => reportIds.has(Number(id)))
  );
  cachedActivity = {
    reportCount: reports.length,
    potholeCount: reports.reduce(
      (total, report) => total + report.pothole_count,
      0
    ),
  };
  cachedActivityVersion = version;
}

export function getCachedReportImages(): Record<number, string> {
  return cachedReportImages;
}

export function setCachedReportImages(
  images: Record<number, string>
): void {
  cachedReportImages = { ...cachedReportImages, ...images };
}

export function getCachedActivity():
  | { reportCount: number; potholeCount: number }
  | null {
  return cachedActivity;
}

export function getCachedActivityVersion(): number {
  return cachedActivityVersion;
}

export function setCachedActivity(
  activity: { reportCount: number; potholeCount: number },
  version: number
): void {
  cachedActivity = activity;
  cachedActivityVersion = version;
}

export function clearReportDataCache(): void {
  reportDataVersion += 1;
  cachedReports = null;
  cachedReportsVersion = -1;
  cachedReportImages = {};
  cachedActivity = null;
  cachedActivityVersion = -1;
}

export function invalidateReportData(): void {
  reportDataVersion += 1;
}
