const paths = {
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
  moon: "M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z",
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  accounts: "M3 7h18v13H3z M3 7l3-4h12l3 4 M15 12h6v4h-6z",
  budget: "M4 20V10 M10 20V4 M16 20v-8 M22 20H2",
  analysis: "M4 20V4 M4 20h17 M8 15l4-5 4 2 5-7",
  history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v6l4 2",
  check: "m5 12 4 4L19 6",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 6 M4 12l2 6a7 7 0 0 0 12-1",
  plus: "M12 5v14 M5 12h14",
  chevron: "m9 5 7 7-7 7",
  down: "m7 10 5 5 5-5",
  close: "m6 6 12 12 M6 18 18 6",
  more: "M11 6a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M11 18a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  arrow: "M5 16 16 5 M5 5h11v11",
};
export function Icon({ name, size = 19 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
