import { describe, it, expect } from "vitest";
import { toast, type ToastKind } from "@/lib/toast";

describe("toast bus", () => {
  it("calls all subscribed listeners with the same payload", () => {
    const seenA: [string, ToastKind][] = [];
    const seenB: [string, ToastKind][] = [];
    const unsubA = toast.subscribe((m, k) => seenA.push([m, k]));
    const unsubB = toast.subscribe((m, k) => seenB.push([m, k]));

    toast.show("hello", "ok");

    expect(seenA).toEqual([["hello", "ok"]]);
    expect(seenB).toEqual([["hello", "ok"]]);

    unsubA();
    unsubB();
  });

  it("unsubscribe stops further notifications to that listener", () => {
    const seen: [string, ToastKind][] = [];
    const unsub = toast.subscribe((m, k) => seen.push([m, k]));

    toast.show("first", "ok");
    unsub();
    toast.show("second", "err");

    expect(seen).toEqual([["first", "ok"]]);
  });

  it("defaults kind to 'ok' when omitted", () => {
    const seen: [string, ToastKind][] = [];
    const unsub = toast.subscribe((m, k) => seen.push([m, k]));

    toast.show("default kind");
    unsub();

    expect(seen).toEqual([["default kind", "ok"]]);
  });
});
