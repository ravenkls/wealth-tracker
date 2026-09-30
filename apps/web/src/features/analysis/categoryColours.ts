import { alpha } from "@mui/material/styles";
const colours = [
  "#98abd2",
  "#8dbca5",
  "#d4ac7c",
  "#c795b2",
  "#a8bec4",
  "#b3a6ca",
  "#b7bd87",
  "#d99586",
  "#89b7d4",
  "#c6a38e",
  "#a6c39d",
  "#a394cf",
  "#d7a0b1",
  "#7fb7ad",
  "#c3b78a",
  "#9ba9bc",
];
export function categoryColour(id: string | null | undefined) {
  if (!id || id === "uncategorised") return "#7e8795";
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return colours[hash % colours.length]!;
}
export function categoryPillStyles(id: string | null | undefined) {
  const colour = categoryColour(id);
  return {
    bgcolor: alpha(colour, 0.14),
    borderColor: alpha(colour, 0.4),
    color: "text.primary",
    maxWidth: "100%",
    height: 30,
    "&:hover": { bgcolor: alpha(colour, 0.24) },
  };
}
