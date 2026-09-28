export type Month = string & { readonly __format: "YYYY-MM" };

export function month(value: string): Month {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("Month must use YYYY-MM with a valid year and month.");
  }
  return value as Month;
}

export function formatMonth(value: Month): string {
  const [year, monthNumber] = month(value).split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, monthNumber! - 1, 1);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
