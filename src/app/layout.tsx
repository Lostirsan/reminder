import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: { default: t("title"), template: "%s · Pago a Tempo" }, description: t("description") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const t = await getTranslations("footer");
  return (
    <html lang={locale === "pt" ? "pt-PT" : "en"} className={`${geist.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/privacy" className="hover:text-zinc-800 dark:hover:text-zinc-200">{t("privacy")}</Link>
          <span className="mx-2">·</span>
          <span>Pago a Tempo © {new Date().getFullYear()}</span>
        </footer>
      </body>
    </html>
  );
}
