export const colors = {
  bg: "#090514",
  surface: "#140C27",
  elevated: "#1E143A",
  border: "#2D1B4E",
  borderActive: "#A855F7",
  neon: "#A855F7",
  neonHover: "#C084FC",
  neonSoft: "rgba(168, 85, 247, 0.15)",
  neonGlow: "rgba(168, 85, 247, 0.4)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  textAccent: "#C084FC",
  danger: "#F87171",
  success: "#4ADE80",
  shiftDayBg: "rgba(251, 191, 36, 0.15)",
  shiftDayText: "#FCD34D",
  shiftDayBorder: "rgba(251, 191, 36, 0.4)",
  shiftNightBg: "rgba(56, 189, 248, 0.15)",
  shiftNightText: "#7DD3FC",
  shiftNightBorder: "rgba(56, 189, 248, 0.4)",
  shiftOnCallBg: "rgba(244, 63, 94, 0.15)",
  shiftOnCallText: "#FDA4AF",
  shiftOnCallBorder: "rgba(244, 63, 94, 0.4)",
  shiftOffBg: "rgba(100, 116, 139, 0.15)",
  shiftOffText: "#94A3B8",
  shiftOffBorder: "rgba(100, 116, 139, 0.4)",
} as const;

export const shiftTheme = (t: string) => {
  switch (t) {
    case "day":
      return {
        bg: colors.shiftDayBg,
        text: colors.shiftDayText,
        border: colors.shiftDayBorder,
        label: "Day",
      };
    case "night":
      return {
        bg: colors.shiftNightBg,
        text: colors.shiftNightText,
        border: colors.shiftNightBorder,
        label: "Night",
      };
    case "on_call":
      return {
        bg: colors.shiftOnCallBg,
        text: colors.shiftOnCallText,
        border: colors.shiftOnCallBorder,
        label: "On Call",
      };
    default:
      return {
        bg: colors.shiftOffBg,
        text: colors.shiftOffText,
        border: colors.shiftOffBorder,
        label: "Off",
      };
  }
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};
