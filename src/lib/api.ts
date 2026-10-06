const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const defaultApiBaseUrl = "https://roadguard-api-zs99.onrender.com";

export const API_BASE_URL = (
  configuredApiBaseUrl || defaultApiBaseUrl
).replace(/\/+$/, "");

export const API_ENDPOINTS = {
  login: `${API_BASE_URL}/login`,
  register: `${API_BASE_URL}/register`,
  analyze: `${API_BASE_URL}/analyze`,
  reports: `${API_BASE_URL}/reports`,
} as const;

export function authorizationHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const responseExcerpt = responseText.slice(0, 500);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${responseExcerpt || response.statusText || "Empty response"}`
    );
  }

  if (
    !contentType.toLowerCase().includes("application/json") &&
    !contentType.toLowerCase().includes("+json")
  ) {
    throw new Error(
      `Expected a JSON response but received ${contentType || "an unknown content type"} (HTTP ${response.status}). Response: ${responseExcerpt || "Empty response"}`
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      `Invalid JSON response (HTTP ${response.status}). Response: ${responseExcerpt || "Empty response"}`
    );
  }
}