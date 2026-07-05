"use client";

import { useEffect, useRef } from "react";
import * as Phaser from "phaser";
import { createGameConfig } from "./config";
import GamePad from "./controls/GamePad";

export default function PhaserGame() {
  const gameRef = useRef<Phaser.Game | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    // Double RAF ensures CSS layout is fully computed before measuring
    let raf1: number;
    let raf2: number;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!containerRef.current || gameRef.current) return;
        const config = createGameConfig(containerRef.current);
        gameRef.current = new Phaser.Game(config);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#1a1a2e",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {/* Game canvas area: top 70% */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          flex: "0 0 70%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1a2040",
          overflow: "hidden",
        }}
      />
      {/* Control pad: bottom 30% */}
      <GamePad />
    </div>
  );
}
