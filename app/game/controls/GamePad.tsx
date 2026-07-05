"use client";

import { useCallback } from "react";
import type { Direction } from "../gamepad";

// Initialize global gamepad state early
if (typeof window !== "undefined") {
  (window as any).__gamepad = {
    dpad: null,
    aJust: false,
    bJust: false,
    menuJust: false,
  };
}

export default function GamePad() {
  const setDpad = useCallback((dir: Direction | null) => {
    if (typeof window !== "undefined" && (window as any).__gamepad) {
      (window as any).__gamepad.dpad = dir;
    }
  }, []);

  const pressA = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).__gamepad) {
      (window as any).__gamepad.aJust = true;
    }
  }, []);

  const pressB = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).__gamepad) {
      (window as any).__gamepad.bJust = true;
    }
  }, []);

  const pressMenu = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).__gamepad) {
      (window as any).__gamepad.menuJust = true;
    }
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 20px",
        paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        backgroundColor: "#2a2a3e",
        borderTop: "3px solid #3d3d55",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      } as React.CSSProperties}
      onTouchMove={(e) => e.preventDefault()}
    >
      {/* D-Pad */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <DpadBtn dir="up" label="▲" onPress={setDpad} />
        <div style={{ display: "flex", gap: 2 }}>
          <DpadBtn dir="left" label="◀" onPress={setDpad} />
          <div
            style={{
              width: 52,
              height: 52,
              backgroundColor: "#3d3d55",
              borderRadius: 4,
            }}
          />
          <DpadBtn dir="right" label="▶" onPress={setDpad} />
        </div>
        <DpadBtn dir="down" label="▼" onPress={setDpad} />
      </div>

      {/* MENU */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            padding: "10px 22px",
            fontSize: 13,
            fontFamily: "monospace",
            fontWeight: "bold",
            color: "#aabbcc",
            backgroundColor: "#3d3d55",
            border: "1px solid #555577",
            borderRadius: 20,
            cursor: "pointer",
            touchAction: "manipulation",
            letterSpacing: 2,
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            pressMenu();
          }}
        >
          MENU
        </div>
      </div>

      {/* A & B buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <ActionBtn
          label="B"
          color="#445588"
          onPress={pressB}
          style={{ marginTop: 20 }}
        />
        <ActionBtn
          label="A"
          color="#cc3344"
          onPress={pressA}
          style={{ marginTop: -12 }}
        />
      </div>
    </div>
  );
}

function DpadBtn({
  dir,
  label,
  onPress,
}: {
  dir: Direction;
  label: string;
  onPress: (d: Direction | null) => void;
}) {
  return (
    <div
      style={{
        width: 52,
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#3d3d55",
        borderRadius: 6,
        fontSize: 20,
        color: "#aabbcc",
        cursor: "pointer",
        touchAction: "manipulation",
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress(dir);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        onPress(null);
      }}
      onTouchCancel={(e) => {
        e.preventDefault();
        onPress(null);
      }}
      onMouseDown={() => onPress(dir)}
      onMouseUp={() => onPress(null)}
      onMouseLeave={() => onPress(null)}
    >
      {label}
    </div>
  );
}

function ActionBtn({
  label,
  color,
  onPress,
  style,
}: {
  label: string;
  color: string;
  onPress: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: 60,
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color,
        borderRadius: "50%",
        fontSize: 22,
        fontWeight: "bold",
        fontFamily: "monospace",
        color: "#ffffff",
        cursor: "pointer",
        touchAction: "manipulation",
        boxShadow: "0 3px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
        ...style,
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
    >
      {label}
    </div>
  );
}
