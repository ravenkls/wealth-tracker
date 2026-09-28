import { createTheme } from "@mui/material/styles";
export type ThemeMode = "dark" | "light";

function createAppTheme(mode: ThemeMode) {
  const dark = mode === "dark";
  const background = dark ? "#0c0d10" : "#f4f5f7";
  const surface = dark ? "#15171b" : "#ffffff";
  const inset = dark ? "#101216" : "#f8f9fb";
  const text = dark ? "#edf0f6" : "#202631";
  const secondary = dark ? "#a6adb9" : "#5f6877";
  const divider = dark ? "#2b2e35" : "#dce0e7";
  const border = dark ? "#444953" : "#b6beca";
  const primary = dark ? "#9fbaf0" : "#385e9c";
  return createTheme({
    palette: {
      mode,
      primary: { main: primary, contrastText: dark ? "#182338" : "#ffffff" },
      background: { default: background, paper: surface },
      text: { primary: text, secondary },
      divider,
      success: { main: dark ? "#97c4b3" : "#28735a" },
      warning: { main: dark ? "#d6b77e" : "#8a621e" },
      error: { main: dark ? "#ed9a9a" : "#b53943" },
    },
    typography: {
      fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 14,
      body1: { fontSize: 14, lineHeight: 1.4 },
      button: { textTransform: "none", fontWeight: 600 },
      h6: { fontSize: 18, fontWeight: 600, letterSpacing: "-.3px" },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { fontVariantNumeric: "tabular-nums" },
          html: {
            scrollbarGutter: "stable",
            "--app-sidebar": dark ? "#08090b" : "#ffffff",
            "--app-inset": inset,
            "--chart-surface": surface,
            "--chart-text": text,
            "--chart-muted": secondary,
            "--chart-grid": divider,
            "--chart-border": border,
            "--chart-hover": dark ? "#ffffff08" : "#20263108",
            "--chart-total": text,
          },
          "*": {
            scrollbarWidth: "thin",
            scrollbarColor: dark ? "#505660 transparent" : "#aeb7c4 transparent",
          },
          "a:focus-visible, [tabindex]:focus-visible": {
            outline: `2px solid ${primary}`,
            outlineOffset: 3,
          },
          "button:focus-visible": { outline: `2px solid ${primary}`, outlineOffset: 3 },
          "@media (prefers-reduced-motion: reduce)": {
            "*,*::before,*::after": {
              animationDuration: "0.01ms !important",
              transitionDuration: "0.01ms !important",
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 7, minHeight: 40 },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 7,
            padding: "11px 14px",
            marginBottom: 7,
            color: secondary,
            "&.Mui-selected": { backgroundColor: dark ? "#202938" : "#e8eef8", color: primary },
            "&.Mui-selected:hover": { backgroundColor: dark ? "#293549" : "#dce6f6" },
            "&.Mui-disabled": { opacity: 1 },
          },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 32, color: "inherit" } } },
      MuiListItemText: { styleOverrides: { primary: { fontSize: 14, fontWeight: 500 } } },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: inset,
            padding: 4,
            border: `1px solid ${divider}`,
            borderRadius: 7,
            gap: 3,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            border: 0,
            borderRadius: "4px !important",
            padding: "5px 13px",
            fontSize: 11,
            lineHeight: 1.8,
            color: secondary,
            "&.Mui-selected": { backgroundColor: dark ? "#343a45" : "#dce6f6", color: text },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { padding: "14px 0", borderColor: divider },
          head: { fontSize: 11, color: secondary, fontWeight: 400, padding: "0 0 13px" },
          body: { fontSize: 13 },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { height: 7, borderRadius: 3, backgroundColor: dark ? "#2d323b" : "#e1e6ee" },
          bar: { borderRadius: 3 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            border: `1px solid ${border}`,
            borderRadius: 12,
            boxShadow: "0 30px 100px #0008",
            "& > form": {
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
            },
            "@media (max-width: 599px)": {
              margin: 16,
              width: "calc(100% - 32px)",
              maxHeight: "calc(100% - 32px)",
            },
          },
          container: { backdropFilter: "blur(3px)" },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { padding: "24px 24px 16px", flexShrink: 0 } } },
      MuiDialogContent: { styleOverrides: { root: { padding: "8px 24px 24px" } } },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: "16px 24px", borderTop: `1px solid ${divider}`, flexShrink: 0, gap: 8 },
        },
      },
      MuiFormHelperText: { styleOverrides: { root: { marginLeft: 0, lineHeight: 1.5 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { backgroundColor: inset, fontSize: 14, borderRadius: 7 },
          notchedOutline: { borderColor: border },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: 14 } } },
      MuiAlert: { styleOverrides: { root: { fontSize: 13, lineHeight: 1.6, borderRadius: 7 } } },
    },
  });
}

export const themes = { dark: createAppTheme("dark"), light: createAppTheme("light") };
