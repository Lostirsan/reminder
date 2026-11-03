import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["pt", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

// No locale in the URL: the choice lives in a cookie, defaulting to the browser language
// (Portuguese unless the browser prefers English).
export default getRequestConfig(async () => {
  const fromCookie = (await cookies()).get("locale")?.value;
  let locale: AppLocale = "pt";
  if (fromCookie === "pt" || fromCookie === "en") locale = fromCookie;
  else if (/^en\b/i.test((await headers()).get("accept-language") ?? "")) locale = "en";
  return { locale, timeZone: "Europe/Lisbon", messages: (await import(`../messages/${locale}.json`)).default };
});
