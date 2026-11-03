import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
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
    <html lang={locale === "pt" ? "pt-PT" : "en"} className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-zinc-200 bg-white py-6 text-center text-sm text-zinc-500">
          <Link href="/privacy" className="hover:text-zinc-800">{t("privacy")}</Link>
          <span className="mx-2">·</span>
          <span>Pago a Tempo © {new Date().getFullYear()}</span>
        </footer>
      </body>
    </html>
  );
}
