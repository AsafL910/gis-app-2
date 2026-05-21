import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0f766e"
    },
    secondary: {
      main: "#c2410c"
    },
    background: {
      default: "#f3efe5",
      paper: "#fffaf2"
    }
  },
  shape: {
    borderRadius: 16
  },
  typography: {
    fontFamily: '"Bahnschrift", "Segoe UI Variable", "Segoe UI", sans-serif',
    h4: {
      fontWeight: 700,
      letterSpacing: "0.03em"
    },
    h6: {
      fontWeight: 700
    },
    button: {
      textTransform: "none",
      fontWeight: 700
    }
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          border: "1px solid rgba(15, 118, 110, 0.10)",
          boxShadow: "0 18px 40px rgba(86, 64, 18, 0.08)"
        }
      }
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: "linear-gradient(180deg, #18352f 0%, #0d1f1c 100%)",
          color: "#f9f4e8"
        }
      }
    }
  }
});
