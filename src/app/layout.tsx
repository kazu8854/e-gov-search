import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "法令探索AI - e-Gov法令検索",
  description: "自然言語で法令を探索するAIアシスタント",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
