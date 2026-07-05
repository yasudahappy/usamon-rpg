"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("./game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a2040",
        color: "#666",
        fontFamily: "monospace",
        fontSize: "16px",
      }}
    >
      Loading うさもんRPG...
    </div>
  ),
});

export default function Home() {
  return <PhaserGame />;
}
