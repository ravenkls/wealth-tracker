import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { formatGbp } from "@wealth/domain";
import type { Pence } from "@wealth/domain";
import { Icon } from "../../components/Icon";
import { formatSignedGbp } from "../../lib/money";
import type { AccountBalance } from "./model";

export function AccountBalances({
  accounts,
  excludingPensions,
}: {
  readonly accounts: readonly AccountBalance[];
  readonly excludingPensions: Pence;
}) {
  return (
    <section>
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 550, mb: 2.5 }}>
        Account balances
      </Typography>
      <Table aria-label="Saved account balances">
        <TableHead>
          <TableRow>
            <TableCell>Account</TableCell>
            <TableCell align="right">Balance</TableCell>
            <TableCell align="right" sx={{ display: { xs: "none", sm: "table-cell" } }}>
              Monthly change
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 33,
                      height: 33,
                      borderRadius: "7px",
                      bgcolor: "action.selected",
                      color: account.category === "investments" ? "primary.main" : "text.secondary",
                      flexShrink: 0,
                    }}
                  >
                    <Icon
                      name={
                        account.category === "investments"
                          ? "budget"
                          : account.category === "pensions"
                            ? "history"
                            : "accounts"
                      }
                      size={16}
                    />
                  </Box>
                  <Box>
                    {account.name}
                    <Typography sx={{ fontSize: 11, mt: 0.5 }} color="text.secondary">
                      {account.description}
                    </Typography>
                  </Box>
                </Box>
              </TableCell>
              <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                {formatGbp(account.balance)}
              </TableCell>
              <TableCell
                align="right"
                sx={{
                  display: { xs: "none", sm: "table-cell" },
                  fontSize: 12,
                  color: account.change >= 0 ? "success.main" : "text.secondary",
                }}
              >
                {formatSignedGbp(account.change)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2, fontSize: 12 }}>
        <Typography sx={{ fontSize: 12 }} color="text.secondary">
          Excluding pensions
        </Typography>
        {formatGbp(excludingPensions)}
      </Box>
    </section>
  );
}
