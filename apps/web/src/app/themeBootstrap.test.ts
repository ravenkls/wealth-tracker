import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { themes } from "./theme";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Missing early theme initialization.");

function boot(value: string | null, storageBlocked = false) {
  const root = { dataset: { theme: "" }, style: { colorScheme: "", backgroundColor: "" } };
  let browserColor = "";
  runInNewContext(script!, {
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error("Storage blocked");
        return value;
      },
    },
    document: {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (_name: string, value: string) => {
          browserColor = value;
        },
      }),
    },
  });
  return { root, browserColor };
}

it("sets the light canvas and React's initial theme before the application bundle loads", () => {
  expect(html.indexOf("localStorage.getItem")).toBeLessThan(html.indexOf('type="module"'));
  const { root, browserColor } = boot("light");
  expect(root.dataset.theme).toBe("light");
  expect(root.style.colorScheme).toBe("light");
  expect(root.style.backgroundColor).toBe(themes.light.palette.background.default);
  expect(browserColor).toBe(themes.light.palette.background.default);
});

it.each(["dark", null, "invalid"])("uses dark mode for cached value %s", (value) => {
  const { root } = boot(value);
  expect(root.dataset.theme).toBe("dark");
  expect(root.style.backgroundColor).toBe(themes.dark.palette.background.default);
});

it("still boots when browser storage is blocked", () => {
  expect(boot(null, true).root.dataset.theme).toBe("dark");
});
