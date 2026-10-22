import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const probeSource = `
pub fn run() {
    for name in [
        "GTK_MODULES",
        "GTK3_MODULES",
        "GDK_BACKEND",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
        "WEBKIT_FORCE_COMPOSITING_MODE",
        "WEBKIT_DISABLE_DMABUF_RENDERER",
    ] {
        match std::env::var_os(name) {
            Some(value) => println!("{}={}", name, value.to_string_lossy()),
            None => println!("{}=<unset>", name),
        }
    }
}
`;

test("Linux entry point applies GTK and rendering defaults before starting Tauri", {
  skip: process.platform !== "linux",
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "codex-switcher-startup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const probe = join(directory, "probe.rs");
  const library = join(directory, "libcodex_switcher_lib.rlib");
  const executable = join(directory, "startup");
  const main = fileURLToPath(new URL("../src-tauri/src/main.rs", import.meta.url));
  writeFileSync(probe, probeSource);

  for (const args of [
    ["--edition=2021", "--crate-type=rlib", "--crate-name=codex_switcher_lib", probe, "-o", library],
    ["--edition=2021", main, "--extern", `codex_switcher_lib=${library}`, "-o", executable],
  ]) {
    const result = spawnSync(process.env.RUSTC ?? "rustc", args, { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  }

  const cases: {
    name: string;
    modules?: string;
    gtk3?: string;
    expectedModules?: string;
    expectedGtk3?: string;
    disableCompositing?: string;
    forceCompositing?: string;
    expectedDisableCompositing?: string;
    disableDmabuf?: string;
    expectedDisableDmabuf?: string;
  }[] = [
    { name: "leaves unset GTK modules unset" },
    {
      name: "preserves an explicit hardware compositing override",
      disableCompositing: "0",
      expectedDisableCompositing: "0",
      expectedDisableDmabuf: "<unset>",
    },
    {
      name: "preserves an explicitly empty compositing override",
      disableCompositing: "",
      expectedDisableCompositing: "",
      expectedDisableDmabuf: "<unset>",
    },
    {
      name: "does not override forced hardware compositing",
      forceCompositing: "1",
      expectedDisableCompositing: "<unset>",
      expectedDisableDmabuf: "<unset>",
    },
    {
      name: "preserves an explicit DMA-BUF renderer override",
      disableDmabuf: "0",
      expectedDisableDmabuf: "0",
    },
    {
      name: "preserves an explicitly empty DMA-BUF override",
      disableDmabuf: "",
      expectedDisableDmabuf: "",
    },
    { name: "preserves explicitly empty values", modules: "", gtk3: "", expectedModules: "", expectedGtk3: "" },
    {
      name: "handles the reported Ubuntu environment",
      modules: "gail:atk-bridge:appmenu-gtk-module",
      expectedModules: "gail:atk-bridge",
    },
    {
      name: "filters GTK3_MODULES independently",
      gtk3: "appmenu-gtk-module:canberra-gtk-module",
      expectedGtk3: "canberra-gtk-module",
    },
    {
      name: "filters both variables before the library starts",
      modules: "appmenu-gtk-module:gail",
      gtk3: "atk-bridge:libappmenu-gtk-module.so",
      expectedModules: "gail",
      expectedGtk3: "atk-bridge",
    },
    {
      name: "removes duplicate and module-only entries",
      modules: "appmenu-gtk-module:appmenu-gtk-module",
      expectedModules: "",
    },
    {
      name: "accepts an absolute library path",
      modules: "gail:/usr/lib/x86_64-linux-gnu/gtk-3.0/modules/libappmenu-gtk-module.so",
      expectedModules: "gail",
    },
    {
      name: "preserves unrelated module names and separators",
      modules: ":gail::my-appmenu-gtk-module:atk-bridge:",
      gtk3: "canberra-gtk-module",
      expectedModules: ":gail::my-appmenu-gtk-module:atk-bridge:",
      expectedGtk3: "canberra-gtk-module",
    },
  ];

  for (const {
    name, modules, gtk3, expectedModules, expectedGtk3,
    disableCompositing, forceCompositing, expectedDisableCompositing = "1",
    disableDmabuf, expectedDisableDmabuf = "1",
  } of cases) {
    await t.test(name, () => {
      const env: Record<string, string | undefined> = { ...process.env, GDK_BACKEND: "wayland" };
      delete env.GTK_MODULES;
      delete env.GTK3_MODULES;
      delete env.WEBKIT_DISABLE_COMPOSITING_MODE;
      delete env.WEBKIT_FORCE_COMPOSITING_MODE;
      delete env.WEBKIT_DISABLE_DMABUF_RENDERER;
      if (modules !== undefined) env.GTK_MODULES = modules;
      if (gtk3 !== undefined) env.GTK3_MODULES = gtk3;
      if (disableCompositing !== undefined) env.WEBKIT_DISABLE_COMPOSITING_MODE = disableCompositing;
      if (forceCompositing !== undefined) env.WEBKIT_FORCE_COMPOSITING_MODE = forceCompositing;
      if (disableDmabuf !== undefined) env.WEBKIT_DISABLE_DMABUF_RENDERER = disableDmabuf;
      const result = spawnSync(executable, [], { env, encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, [
        `GTK_MODULES=${expectedModules ?? "<unset>"}`,
        `GTK3_MODULES=${expectedGtk3 ?? "<unset>"}`,
        "GDK_BACKEND=wayland",
        `WEBKIT_DISABLE_COMPOSITING_MODE=${expectedDisableCompositing}`,
        `WEBKIT_FORCE_COMPOSITING_MODE=${forceCompositing ?? "<unset>"}`,
        `WEBKIT_DISABLE_DMABUF_RENDERER=${expectedDisableDmabuf}`,
        "",
      ].join("\n"));
    });
  }
});
