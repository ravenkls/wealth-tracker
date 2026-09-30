import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  SvgIcon,
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useTable,
  tableFeatures,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnGroupingFeature,
  rowExpandingFeature,
  rowSortingFeature,
  createGroupedRowModel,
  createExpandedRowModel,
  createSortedRowModel,
  functionalUpdate,
} from "@tanstack/react-table";
import type { ExpandedState } from "@tanstack/react-table";
import type { TablePreferences } from "@wealth/domain";
import type { AppData } from "../../lib/data";
import { api } from "../../lib/api";
import { useTableSave } from "./useTableSave";

const features = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  columnGroupingFeature,
  rowExpandingFeature,
  rowSortingFeature,
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortedRowModel: createSortedRowModel(),
});
export interface DataColumn<T> {
  id: string;
  label: string;
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  aggregate?: (rows: T[]) => ReactNode;
  align?: "left" | "right";
  groupable?: boolean;
  sortable?: boolean;
  minWidth?: number;
}
type TableId = "accounts" | "history" | "expenses" | "allocations" | "connections" | "analysis";
const empty: TablePreferences = { columnOrder: [], rowOrder: [], grouping: [], sorting: [] };
export function DataTable<T extends object>({
  id,
  label,
  rows,
  columns,
  rowId,
  data,
  reorder = false,
  disabled = false,
  defaultGrouping = empty.grouping,
  pagination,
}: {
  readonly id: TableId;
  readonly label: string;
  readonly rows: T[];
  readonly columns: DataColumn<T>[];
  readonly rowId: (row: T) => string;
  readonly data: AppData;
  readonly reorder?: boolean;
  readonly disabled?: boolean;
  readonly defaultGrouping?: string[];
  readonly pagination?: {
    pageIndex: number;
    hasNext: boolean;
    loading: boolean;
    onNext: () => void;
    onPrevious: () => void;
    onFirst: () => void;
  };
}) {
  const remote = data.preferences.find((item) => item.id === id);
  const [local, setLocal] = useState<{ version: number; preferences: TablePreferences } | null>(
    null,
  );
  const saved = local && local.version >= (remote?.version ?? 0) ? local : remote;
  const persisted = saved?.preferences ?? { ...empty, grouping: defaultGrouping };
  const preferences = pagination
    ? { ...persisted, grouping: [], sorting: [], rowOrder: [] }
    : persisted;
  const groupingKey = JSON.stringify(preferences.grouping);
  const [expansion, setExpansion] = useState<{ key: string; value: ExpandedState }>({
    key: groupingKey,
    value: true,
  });
  if (expansion.key !== groupingKey) setExpansion({ key: groupingKey, value: true });
  const expanded = expansion.key === groupingKey ? expansion.value : true;
  const persistence = useTableSave();
  const locked = disabled || persistence.disabled;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function update(patch: Partial<TablePreferences>) {
    if (locked) return;
    const next = { ...preferences, ...patch };
    void persistence
      .save(async () => {
        const result = await api.preferences.save.mutate({
          id,
          expectedVersion: saved?.version ?? 0,
          preferences: next,
        });
        setLocal({ version: result.version, preferences: result.data });
      })
      .catch(() => {});
  }
  const ordered = useMemo(() => {
    const ranks = new Map(preferences.rowOrder.map((key, index) => [key, index]));
    return [...rows].sort(
      (a, b) => (ranks.get(rowId(a)) ?? Infinity) - (ranks.get(rowId(b)) ?? Infinity),
    );
  }, [rows, preferences.rowOrder, rowId]);
  const definitions = useMemo(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: column.value,
        header: column.label,
        enableGrouping: !!column.groupable,
        enableSorting: column.sortable !== false,
      })),
    [columns],
  );
  const table = useTable({
    features,
    data: ordered,
    columns: definitions,
    getRowId: rowId,
    state: {
      columnOrder: preferences.columnOrder,
      grouping: preferences.grouping,
      sorting: preferences.sorting,
      expanded,
    },
    onExpandedChange: (updater) =>
      setExpansion({ key: groupingKey, value: functionalUpdate(updater, expanded) }),
    onColumnOrderChange: (updater) =>
      update({ columnOrder: functionalUpdate(updater, preferences.columnOrder) }),
    onGroupingChange: (updater) =>
      update({ grouping: functionalUpdate(updater, preferences.grouping), sorting: [] }),
    onSortingChange: (updater) =>
      update({ sorting: functionalUpdate(updater, preferences.sorting) }),
    groupedColumnMode: false,
    autoResetExpanded: false,
  });
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const columnIds = headers.map((header) => header.column.id);
  const canMoveRows =
    reorder && !preferences.grouping.length && !preferences.sorting.length && !locked;
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", minWidth: 0 }}>
      <Stack direction="row" sx={{ p: 1.5, alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {columns.some((column) => column.groupable) && (
          <TextField
            size="small"
            select
            label="Group by"
            value={preferences.grouping[0] ?? ""}
            disabled={locked}
            onChange={(event) =>
              update({ grouping: event.target.value ? [event.target.value] : [], sorting: [] })
            }
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">None</MenuItem>
            {columns
              .filter((column) => column.groupable)
              .map((column) => (
                <MenuItem key={column.id} value={column.id}>
                  {column.label}
                </MenuItem>
              ))}
          </TextField>
        )}
        {preferences.sorting.length > 0 && (
          <Button size="small" disabled={locked} onClick={() => update({ sorting: [] })}>
            Clear sort
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {persistence.status}
      </Stack>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id || locked) return;
          const source = String(active.id),
            target = String(over.id);
          if (source.startsWith("column:") && target.startsWith("column:")) {
            update({
              columnOrder: arrayMove(
                columnIds,
                columnIds.indexOf(source.slice(7)),
                columnIds.indexOf(target.slice(7)),
              ),
            });
          } else if (canMoveRows && source.startsWith("row:") && target.startsWith("row:")) {
            const ids = ordered.map(rowId);
            const visibleOrder = arrayMove(
              ids,
              ids.indexOf(source.slice(4)),
              ids.indexOf(target.slice(4)),
            );
            update({
              rowOrder: [
                ...visibleOrder,
                ...preferences.rowOrder.filter((key) => !ids.includes(key)),
              ],
            });
          }
        }}
      >
        <TableContainer
          tabIndex={0}
          component="section"
          aria-label={label + " scroll area"}
          sx={{ overflowX: "auto", maxHeight: pagination ? "60vh" : undefined }}
        >
          <Table
            size="small"
            stickyHeader={!!pagination}
            aria-label={label}
            sx={{
              "& td, & th": { px: 1.5, py: 0.6 },
              "& th": { bgcolor: "var(--app-inset)", height: 48, fontSize: 12 },
              "& .MuiTableRow-hover:hover": { bgcolor: "action.hover" },
              "& td": { height: 44 },
              "& tbody tr:last-child td": { borderBottom: 0 },
            }}
          >
            <TableHead>
              <SortableContext
                items={columnIds.map((key) => "column:" + key)}
                strategy={horizontalListSortingStrategy}
              >
                <TableRow>
                  {reorder && <TableCell sx={{ width: 36 }} />}
                  {headers.map((header) => (
                    <DraggableHeader
                      key={header.id}
                      id={"column:" + header.column.id}
                      disabled={locked}
                      align={
                        columns.find((column) => column.id === header.column.id)?.align ?? "left"
                      }
                      minWidth={
                        columns.find((column) => column.id === header.column.id)?.minWidth ?? 0
                      }
                    >
                      {header.column.getCanSort() ? (
                        <TableSortLabel
                          disabled={locked || !header.column.getCanSort()}
                          active={!!header.column.getIsSorted()}
                          direction={header.column.getIsSorted() === "desc" ? "desc" : "asc"}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {columns.find((column) => column.id === header.column.id)?.label}
                        </TableSortLabel>
                      ) : (
                        columns.find((column) => column.id === header.column.id)?.label
                      )}
                    </DraggableHeader>
                  ))}
                </TableRow>
              </SortableContext>
            </TableHead>
            <TableBody>
              <SortableContext
                items={ordered.map((row) => "row:" + rowId(row))}
                strategy={verticalListSortingStrategy}
              >
                {table.getRowModel().rows.map((row) =>
                  row.getIsGrouped() ? (
                    <TableRow key={row.id} sx={{ bgcolor: "action.hover" }}>
                      {reorder && <TableCell />}
                      {row.getVisibleCells().map((cell) => {
                        const column = columns.find((item) => item.id === cell.column.id)!;
                        const labelColumn = headers.find(
                          (header) =>
                            !columns.find((item) => item.id === header.column.id)?.aggregate,
                        )?.column.id;
                        return (
                          <TableCell
                            key={cell.id}
                            align={column.align ?? "left"}
                            sx={{
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {cell.column.id === labelColumn ? (
                              <Button
                                size="small"
                                onClick={row.getToggleExpandedHandler()}
                                aria-expanded={row.getIsExpanded()}
                                startIcon={
                                  <SvgIcon
                                    sx={{
                                      transform: row.getIsExpanded() ? "rotate(90deg)" : undefined,
                                    }}
                                  >
                                    <path
                                      d="m9 6 6 6-6 6"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                    />
                                  </SvgIcon>
                                }
                              >
                                {String(row.getValue(row.groupingColumnId!) ?? "Unassigned")} (
                                {row.getLeafRows().length})
                              </Button>
                            ) : (
                              column.aggregate?.(row.getLeafRows().map((leaf) => leaf.original))
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ) : (
                    <DraggableRow
                      key={row.id}
                      id={"row:" + row.id}
                      enabled={canMoveRows}
                      showHandle={reorder}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const column = columns.find((item) => item.id === cell.column.id)!;
                        return (
                          <TableCell
                            key={cell.id}
                            align={column.align ?? "left"}
                            sx={{
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                              minWidth: column.minWidth,
                            }}
                          >
                            {column.render
                              ? column.render(row.original)
                              : (column.value(row.original) ?? "—")}
                          </TableCell>
                        );
                      })}
                    </DraggableRow>
                  ),
                )}
                {!rows.length && (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length + (reorder ? 1 : 0)}
                      sx={{ py: "24px !important", color: "text.secondary" }}
                    >
                      No entries yet.
                    </TableCell>
                  </TableRow>
                )}
              </SortableContext>
            </TableBody>
          </Table>
        </TableContainer>
      </DndContext>
      {pagination && (
        <Stack
          direction="row"
          sx={{
            p: 1.5,
            gap: 1,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              mr: "auto",
              width: { xs: "100%", sm: "auto" },
              fontSize: 13,
              color: "text.secondary",
            }}
          >
            Page {pagination.pageIndex + 1} · {rows.length} transactions
          </Box>
          <Button
            size="small"
            disabled={pagination.loading || pagination.pageIndex === 0}
            onClick={pagination.onFirst}
          >
            First
          </Button>
          <Button
            size="small"
            disabled={pagination.loading || pagination.pageIndex === 0}
            onClick={pagination.onPrevious}
          >
            Previous
          </Button>
          <Button
            size="small"
            disabled={pagination.loading || !pagination.hasNext}
            onClick={pagination.onNext}
          >
            Next
          </Button>
        </Stack>
      )}
    </Paper>
  );
}
function DraggableHeader({
  id,
  disabled,
  children,
  align,
  minWidth,
}: {
  readonly id: string;
  readonly disabled: boolean;
  readonly align: "left" | "right";
  readonly minWidth: number;
  readonly children: ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({
    id,
    disabled,
  });
  return (
    <TableCell
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      align={align}
      sx={{
        whiteSpace: "nowrap",
        minWidth,
        "& .column-drag": { opacity: 0.45 },
        "&:hover .column-drag, &:focus-within .column-drag": { opacity: 1 },
      }}
    >
      {children}
      <IconButton
        size="small"
        disabled={disabled}
        {...attributes}
        {...listeners}
        className="column-drag"
        aria-label={"Move " + id.slice(7) + " column"}
        sx={{ fontSize: 14, ml: 0.5, cursor: "grab" }}
      >
        <DragHandle />
      </IconButton>
    </TableCell>
  );
}
function DraggableRow({
  id,
  enabled,
  showHandle,
  children,
}: {
  readonly id: string;
  readonly enabled: boolean;
  readonly showHandle: boolean;
  readonly children: ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({
    id,
    disabled: !enabled,
  });
  return (
    <TableRow
      hover
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {showHandle && (
        <TableCell>
          <Tooltip title={enabled ? "Drag to reorder" : "Clear grouping and sorting to reorder"}>
            <span>
              <IconButton
                size="small"
                disabled={!enabled}
                {...attributes}
                {...listeners}
                aria-label="Move row"
                sx={{ fontSize: 16, cursor: "grab" }}
              >
                <DragHandle />
              </IconButton>
            </span>
          </Tooltip>
        </TableCell>
      )}
      {children}
    </TableRow>
  );
}

function DragHandle() {
  return (
    <SvgIcon sx={{ fontSize: 16 }}>
      <path
        d="M5 9h14M5 15h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </SvgIcon>
  );
}
