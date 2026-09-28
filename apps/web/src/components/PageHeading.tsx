import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
export function PageHeading({
  title,
  children,
}: {
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        mb: 4,
      }}
    >
      <Typography component="h1" sx={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.6px" }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
