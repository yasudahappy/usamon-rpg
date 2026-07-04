import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "うさもんRPG",
  description: "月面を舞台にしたモンスター収集RPG",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
