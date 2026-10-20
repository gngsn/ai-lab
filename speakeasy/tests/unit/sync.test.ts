// What the legacy public/js/sync.js did, pinned for the port.
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ supabaseUrl: "https://x.test", supabaseAnonKey: "k" }));
const fake = vi.hoisted(() => {
  const handlers: { event: string; cb: (message: { payload?: unknown }) => void }[] = [];
  const channel = {
    on: vi.fn(
      (_type: string, { event }: { event: string }, cb: (m: { payload?: unknown }) => void) => {
        handlers.push({ event, cb });
        return channel;
      },
    ),
    subscribe: vi.fn(),
    send: vi.fn(async () => "ok"),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  };
  return { handlers, channel, client };
});
vi.mock("../../src/config", () => ({ getConfig: () => config }));
vi.mock("../../src/data/client", () => ({ supabase: fake.client }));

import { createSlideSync } from "../../src/lib/sync";

beforeEach(() => {
  fake.handlers.length = 0;
  vi.clearAllMocks();
  config.supabaseUrl = "https://x.test";
  config.supabaseAnonKey = "k";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("createSlideSync", () => {
  it("returns null without a room", () => {
    expect(createSlideSync(null)).toBeNull();
    expect(createSlideSync("")).toBeNull();
    expect(fake.client.channel).not.toHaveBeenCalled();
  });

  it("returns null, with a warning, when the Supabase settings are missing", () => {
    config.supabaseUrl = "";
    expect(createSlideSync("room")).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      "[sync] SUPABASE_URL / SUPABASE_ANON_KEY not configured",
    );
  });

  it("joins speakeasy-sync-<room> without hearing itself", () => {
    createSlideSync("room-1", () => {});
    expect(fake.client.channel).toHaveBeenCalledWith("speakeasy-sync-room-1", {
      config: { broadcast: { self: false } },
    });
  });

  it("passes slide payloads to onSlideChange and hellos to onHello", () => {
    const onSlide = vi.fn();
    const onHello = vi.fn();
    createSlideSync("r", onSlide, undefined, { onHello });
    expect(fake.handlers.map((h) => h.event)).toEqual(["slide", "hello"]);
    fake.handlers[0]?.cb({ payload: { section_id: "a", index: 2 } });
    fake.handlers[1]?.cb({});
    expect(onSlide).toHaveBeenCalledWith({ section_id: "a", index: 2 });
    expect(onHello).toHaveBeenCalledTimes(1);
  });

  it("listens only for what it was given handlers for", () => {
    createSlideSync("r");
    expect(fake.channel.on).not.toHaveBeenCalled();
    createSlideSync("r", undefined, undefined, { onHello: () => {} });
    expect(fake.handlers.map((h) => h.event)).toEqual(["hello"]);
  });

  it("reports the subscription status", () => {
    const onStatus = vi.fn();
    createSlideSync("r", undefined, onStatus);
    const subscribed = fake.channel.subscribe.mock.calls[0]?.[0] as (
      s: string,
      e?: unknown,
    ) => void;
    subscribed("SUBSCRIBED", undefined);
    subscribed("CHANNEL_ERROR", "boom");
    expect(onStatus).toHaveBeenNthCalledWith(1, "SUBSCRIBED", undefined);
    expect(onStatus).toHaveBeenNthCalledWith(2, "CHANNEL_ERROR", "boom");
  });

  it("broadcasts slides, asks for the state, and removes its channel on close", async () => {
    const sync = createSlideSync("r");
    await sync?.broadcast({ section_id: "b", index: 1 });
    await sync?.requestState();
    expect(fake.channel.send).toHaveBeenNthCalledWith(1, {
      type: "broadcast",
      event: "slide",
      payload: { section_id: "b", index: 1 },
    });
    expect(fake.channel.send).toHaveBeenNthCalledWith(2, {
      type: "broadcast",
      event: "hello",
      payload: {},
    });
    await sync?.close();
    expect(fake.client.removeChannel).toHaveBeenCalledWith(fake.channel);
  });
});
