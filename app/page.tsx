"use client";

import dynamic from "next/dynamic";

const PhaserGame = dynamic(() => import("./game/PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0a0f",
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
