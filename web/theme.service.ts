import { DOCUMENT } from "@angular/common";
import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from "@angular/core";
export type ThemePreference = "light" | "dark" | "system";
const valid = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";
@Injectable({ providedIn: "root" })
export class ThemeService {
  private doc = inject(DOCUMENT);
  private window = this.doc.defaultView;
  private media = this.window?.matchMedia?.("(prefers-color-scheme: dark)");
  private systemDark = signal(this.media?.matches ?? false);
  readonly preference = signal<ThemePreference>(this.read());
  readonly resolved = computed<"light" | "dark">(() =>
    this.preference() === "system"
      ? this.systemDark()
        ? "dark"
        : "light"
      : (this.preference() as "light" | "dark"),
  );
  readonly colors = computed(() =>
    this.resolved() === "dark"
      ? {
          text: "#e7f1ed",
          muted: "#abc1b8",
          line: "#2d443c",
          surface: "#122321",
          area: "#164136",
          palette: [
            "#7fd6bd",
            "#a2be96",
            "#ddbc77",
            "#9fb9e5",
            "#c8abd9",
            "#a8bcb3",
          ],
        }
      : {
          text: "#263c31",
          muted: "#617468",
          line: "#e0e8de",
          surface: "#ffffff",
          area: "#e7f1e6",
          palette: [
            "#17634e",
            "#8ab994",
            "#c5a35c",
            "#728ab6",
            "#ad94ba",
            "#a3aaa5",
          ],
        },
  );
  constructor() {
    const mediaChange = (event: MediaQueryListEvent) => {
      this.systemDark.set(event.matches);
      this.apply();
    };
    const storageChange = (event: StorageEvent) => {
      if (event.key === "patrimonio-theme" || event.key === null) {
        this.preference.set(valid(event.newValue) ? event.newValue : "system");
        this.apply();
      }
    };
    this.media?.addEventListener("change", mediaChange);
    this.window?.addEventListener("storage", storageChange);
    this.apply();
    inject(DestroyRef).onDestroy(() => {
      this.media?.removeEventListener("change", mediaChange);
      this.window?.removeEventListener("storage", storageChange);
    });
  }
  set(value: unknown) {
    if (!valid(value)) return;
    this.preference.set(value);
    try {
      this.window?.localStorage.setItem("patrimonio-theme", value);
    } catch {}
    this.apply();
  }
  private read(): ThemePreference {
    try {
      const value = this.window?.localStorage.getItem("patrimonio-theme");
      return valid(value) ? value : "system";
    } catch {
      return "system";
    }
  }
  private apply() {
    this.doc.documentElement.dataset["theme"] = this.resolved();
  }
}
