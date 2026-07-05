/**
 * Shared font configuration for GBA-style pixel text.
 * DotGothic16 from Google Fonts + black stroke outline.
 */

/** Primary font family – falls back to monospace if DotGothic16 hasn't loaded */
export const FONT_FAMILY = "'DotGothic16', monospace";

/** Default text stroke style for GBA-like black outline */
export const STROKE_STYLE = {
  stroke: "#000000",
  strokeThickness: 3,
};

/** Thinner stroke for small text (≤10px) */
export const STROKE_THIN = {
  stroke: "#000000",
  strokeThickness: 2,
};

/** Standard white text with stroke – the most common style */
export function gbaStyle(fontSize: string, color = "#ffffff", bold = false): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize,
    color,
    fontFamily: FONT_FAMILY,
    ...(bold ? { fontStyle: "bold" } : {}),
    ...STROKE_STYLE,
  };
}

/** Small text style (≤10px) with thinner stroke */
export function gbaStyleSmall(fontSize: string, color = "#ffffff"): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize,
    color,
    fontFamily: FONT_FAMILY,
    ...STROKE_THIN,
  };
}
