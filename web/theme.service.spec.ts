import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeService } from "./theme.service";
describe("persistent theme and system preference", () => {
  let listener: (event: MediaQueryListEvent) => void;
  const media = {
    matches: false,
    addEventListener: vi.fn(
      (_name: string, fn: (e: MediaQueryListEvent) => void) => {
        listener = fn;
      },
    ),
    removeEventListener: vi.fn(),
  };
  beforeEach(() => {
    localStorage.clear();
    media.matches = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    TestBed.configureTestingModule({});
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("follows operating system changes until the user selects a theme", () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe("system");
    expect(theme.resolved()).toBe("light");
    listener({ matches: true } as MediaQueryListEvent);
    expect(theme.resolved()).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(theme.colors().surface).toBe("#122321");
    theme.set("light");
    listener({ matches: true } as MediaQueryListEvent);
    expect(theme.resolved()).toBe("light");
    expect(localStorage.getItem("patrimonio-theme")).toBe("light");
    theme.set("system");
    expect(theme.resolved()).toBe("dark");
  });
  it("restores stored selection and synchronizes changes from another tab", () => {
    localStorage.setItem("patrimonio-theme", "dark");
    const theme = TestBed.inject(ThemeService);
    expect(theme.resolved()).toBe("dark");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "patrimonio-theme",
        newValue: "light",
      }),
    );
    expect(theme.resolved()).toBe("light");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "patrimonio-theme",
        newValue: "garbage",
      }),
    );
    expect(theme.preference()).toBe("system");
    theme.set("invalid");
    expect(theme.preference()).toBe("system");
  });
  it("remains usable when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe("system");
    theme.set("dark");
    expect(theme.resolved()).toBe("dark");
  });
});
