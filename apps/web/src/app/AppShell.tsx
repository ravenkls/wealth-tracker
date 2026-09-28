import {
  Avatar,
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { Link, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAppearance } from "./AppearanceProvider";
import { Icon } from "../components/Icon";

const navigation = [
  ["overview", "Overview"],
  ["accounts", "Accounts"],
  ["budget", "Budget"],
  ["history", "History"],
] as const;

interface AppShellProps {
  readonly children: ReactNode;
  readonly preview: boolean;
  readonly onRecord: () => void;
  readonly user?: { name: string; email: string };
  readonly onLogout?: () => void;
}

export function AppShell({ children, preview, onRecord, user, onLogout }: AppShellProps) {
  const location = useLocation();
  const appearance = useAppearance();
  return (
    <>
      <Drawer
        variant="permanent"
        sx={{
          width: { xs: 60, sm: 76, md: 220 },
          "& .MuiDrawer-paper": {
            width: { xs: 60, sm: 76, md: 220 },
            boxSizing: "border-box",
            backgroundColor: "var(--app-sidebar)",
            px: { xs: 1, md: 2.5 },
            py: { xs: 3, md: 4.75 },
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: { xs: 1, md: 1.5 },
            height: 28,
          }}
        >
          <Box
            aria-hidden
            sx={{ display: "flex", alignItems: "end", gap: "3px", height: 24, flexShrink: 0 }}
          >
            {[11, 18, 24].map((height) => (
              <Box
                key={height}
                sx={{ width: 5, height, bgcolor: "primary.main", borderRadius: "2px" }}
              />
            ))}
          </Box>
          <Typography
            sx={{
              fontWeight: 650,
              fontSize: 23,
              letterSpacing: "-.9px",
              display: { xs: "none", md: "block" },
            }}
          >
            Wealth.
          </Typography>
        </Box>
        <List component="nav" aria-label="Main navigation" sx={{ mt: 6, p: 0 }}>
          {navigation.map(([icon, label]) => (
            <ListItemButton
              key={icon}
              component={Link}
              to={icon === "overview" ? "/" : `/${icon}`}
              selected={location.pathname === (icon === "overview" ? "/" : `/${icon}`)}
              disabled={preview && icon !== "overview"}
              aria-current={
                location.pathname === (icon === "overview" ? "/" : `/${icon}`) ? "page" : undefined
              }
              aria-label={label}
              title={label}
              sx={{ justifyContent: { xs: "center", md: "start" }, px: { xs: 1, md: 1.75 } }}
            >
              <ListItemIcon sx={{ minWidth: { xs: 0, md: 32 } }}>
                <Icon name={icon} />
              </ListItemIcon>
              <ListItemText primary={label} sx={{ display: { xs: "none", md: "block" } }} />
            </ListItemButton>
          ))}
        </List>
        <Button
          variant="contained"
          aria-label="Record snapshot"
          onClick={onRecord}
          sx={{ mt: 3, minWidth: 0, gap: 1, px: 1 }}
        >
          <Icon name="plus" />
          <Box
            component="span"
            sx={{ display: { xs: "none", md: "inline" }, whiteSpace: "nowrap", fontSize: 13 }}
          >
            Record snapshot
          </Box>
        </Button>
        <Box sx={{ mt: "auto", pt: 3, pb: 2 }}>
          {user && (
            <Button
              fullWidth
              color="inherit"
              onClick={appearance.toggle}
              disabled={!appearance.ready || appearance.saving}
              aria-label={`Switch to ${appearance.mode === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${appearance.mode === "dark" ? "light" : "dark"} mode`}
              sx={{
                minWidth: 0,
                px: 1,
                gap: 1.5,
                justifyContent: { xs: "center", md: "start" },
                color: "text.secondary",
              }}
            >
              <Icon name={appearance.mode === "dark" ? "sun" : "moon"} />
              <Box component="span" sx={{ display: { xs: "none", md: "inline" }, fontSize: 13 }}>
                {appearance.mode === "dark" ? "Light mode" : "Dark mode"}
              </Box>
            </Button>
          )}
        </Box>
        <Box
          sx={{
            flexDirection: { xs: "column", md: "row" },
            pt: 3,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            justifyContent: { xs: "center", md: "start" },
          }}
        >
          <Avatar
            sx={{
              width: 34,
              height: 34,
              flexShrink: 0,
              fontSize: 11,
              bgcolor: "action.selected",
              color: "text.secondary",
            }}
          >
            {user
              ? user.name.slice(0, 2).toUpperCase()
              : import.meta.env.DEV && preview
                ? "JD"
                : "–"}
          </Avatar>
          {user && (
            <Button
              onClick={onLogout}
              size="small"
              aria-label="Sign out"
              sx={{ display: { xs: "block", md: "none" }, minWidth: 0, fontSize: 10, p: 0 }}
            >
              Exit
            </Button>
          )}
          <Box sx={{ display: { xs: "none", md: "block" }, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, overflowWrap: "anywhere" }}>
              {user?.name ?? (import.meta.env.DEV && preview ? "Jamie Davis" : "Not signed in")}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.5 }}>
              {user ? (
                <Button
                  onClick={onLogout}
                  size="small"
                  sx={{ p: 0, minWidth: 0, minHeight: 20, fontSize: 11 }}
                >
                  Sign out
                </Button>
              ) : import.meta.env.DEV && preview ? (
                "Sample account"
              ) : (
                "Google sign-in"
              )}
            </Typography>
          </Box>
        </Box>
      </Drawer>
      <Box component="main" sx={{ ml: { xs: "60px", sm: "76px", md: "220px" } }}>
        <Box
          sx={{
            mx: "auto",
            maxWidth: 1600,
            px: { xs: 2, sm: 3, lg: 6 },
            py: { xs: 3, lg: 4.75 },
          }}
        >
          {children}
        </Box>
      </Box>
    </>
  );
}
