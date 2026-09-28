import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import { formatMonth } from "@wealth/domain";
import { Icon } from "../components/Icon";
import { overviewFixture } from "./fixture";

export function SnapshotPreview({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="snapshot-title">
      <DialogTitle
        id="snapshot-title"
        sx={{
          px: 3,
          pt: 3,
          pb: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        Record snapshot
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pb: 1 }}>
        <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2.5 }}>
          {formatMonth(overviewFixture.month)}
        </Typography>
        <Alert severity="warning" icon={false} sx={{ mb: 3 }}>
          September already has a snapshot. Recording again will replace it.
        </Alert>
        <Box sx={{ display: "grid", gap: 2.5 }}>
          {overviewFixture.accounts
            .filter((account) => account.category !== "investments")
            .map((account) => (
              <TextField
                key={account.id}
                label={account.name}
                defaultValue={(account.balance / 100).toFixed(2)}
                type="number"
                size="small"
                fullWidth
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">£</InputAdornment> },
                  htmlInput: { step: "0.01", style: { textAlign: "right" } },
                }}
              />
            ))}
        </Box>
        <Typography color="text.secondary" sx={{ fontSize: 12, mt: 2.5 }}>
          Preview only. No balances are saved or fetched.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 2 }}>
        <Button variant="contained" fullWidth onClick={onClose}>
          Close preview
        </Button>
      </DialogActions>
    </Dialog>
  );
}
