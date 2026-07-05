import type { Metadata, Viewport } from "next";

const baseUrl = "https://yasudahappy.github.io/usamon-rpg";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "うさもんの大冒険 〜月面探索編〜",
  description: "月面を舞台にしたモンスター収集RPG。うさもんと一緒に月の砂場を探検しよう！",
  metadataBase: new URL(baseUrl),
  openGraph: {
    title: "うさもんの大冒険 〜月面探索編〜",
    description: "月面を舞台にしたモンスター収集RPG",
    images: [{ url: `${baseUrl}/ogp.jpg`, width: 1024, height: 1024 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "うさもんの大冒険 〜月面探索編〜",
    images: [`${baseUrl}/ogp.jpg`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
