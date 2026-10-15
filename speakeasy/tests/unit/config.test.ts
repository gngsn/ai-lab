// P3-1: Vite env first, then the legacy window globals, then empty.
import { describe, expect, it } from "vitest";
import { getConfig } from "../../src/config";

const env = (v: Record<string, string>) => v as unknown as ImportMetaEnv;

describe("getConfig", () => {
  it("prefers the Vite env variables", () => {
    expect(
      getConfig(
        env({
          VITE_SUPABASE_URL: "https://env.example",
          VITE_SUPABASE_ANON_KEY: "env-key",
          VITE_OWNER_PASSPHRASE: "env-pass",
        }),
        {
          SUPABASE_URL: "https://win.example",
          SUPABASE_ANON_KEY: "win-key",
          OWNER_PASSPHRASE: "win-pass",
        },
      ),
    ).toEqual({
      supabaseUrl: "https://env.example",
      supabaseAnonKey: "env-key",
      ownerPassphrase: "env-pass",
    });
  });

  it("falls back to the legacy window globals per value", () => {
    expect(
      getConfig(env({ VITE_SUPABASE_URL: "https://env.example" }), {
        SUPABASE_URL: "https://win.example",
        SUPABASE_ANON_KEY: "win-key",
        OWNER_PASSPHRASE: "win-pass",
      }),
    ).toEqual({
      supabaseUrl: "https://env.example",
      supabaseAnonKey: "win-key",
      ownerPassphrase: "win-pass",
    });
  });

  it("returns empty strings when nothing is set", () => {
    expect(getConfig(env({}), {})).toEqual({
      supabaseUrl: "",
      supabaseAnonKey: "",
      ownerPassphrase: "",
    });
  });

  it("only exposes the three allowed settings (no tokens or API keys)", () => {
    expect(Object.keys(getConfig(env({}), {})).sort()).toEqual([
      "ownerPassphrase",
      "supabaseAnonKey",
      "supabaseUrl",
    ]);
  });
});
