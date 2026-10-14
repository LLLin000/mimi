// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "../../lib/types";
import { VoiceSettings } from "./VoiceSettings";

const state = vi.hoisted(() => ({
  settings: {} as SettingsSnapshot,
  session: { status: { kind: "idle" } },
  selectProfile: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../lib/store", async original => {
  const store = await original<typeof import("../../lib/store")>();
  state.settings = store.useStore.getState().settings;
  return { useStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
vi.mock("./AudioInputSettings", () => ({ AudioInputSettings: () => null }));
vi.mock("./ProfileLanguageSettings", () => ({ ProfileLanguageSettings: () => null }));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.selectProfile.mockClear();
  state.settings = { ...state.settings, activeProfileId: "ready", targetLanguage: "zh", profiles: [
    { id: "ready", name: "Ready service", provider: "alibabaCloud", credentialState: "present", alibabaRealtimeMode: "disabled" },
    { id: "missing", name: "Missing credentials", provider: "alibabaCloud", credentialState: "missing", alibabaRealtimeMode: "disabled" },
    { id: "unavailable", name: "Unavailable credentials", provider: "alibabaCloud", credentialState: "unavailable", alibabaRealtimeMode: "disabled" },
    { id: "workspace", name: "Missing workspace", provider: "alibabaCloud", credentialState: "present", alibabaRealtimeMode: "liveTranslate", alibabaWorkspaceId: "" },
    { id: "another", name: "Another ready service", provider: "alibabaCloud", credentialState: "present", alibabaRealtimeMode: "disabled" },
  ] };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
  await act(() => host.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
});
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(() => root.render(<VoiceSettings onOpenModels={() => {}} onOpenAppleResources={() => {}} />)); }
function option(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)!;
}

it.each(["Missing credentials", "Unavailable credentials", "Missing workspace"])("keeps %s visible without dispatching a switch", async label => {
  const choice = option(label);
  await act(async () => choice.click());
  expect(state.selectProfile).not.toHaveBeenCalled();
  expect(choice.getAttribute("aria-disabled")).toBe("true");
  expect(document.querySelector('[role="listbox"]')).not.toBeNull();
});

it("keeps a configured service selectable", async () => {
  await act(async () => option("Another ready service").click());
  expect(state.selectProfile).toHaveBeenCalledExactlyOnceWith("another");
});

it("keeps the active selection visible when its credentials become missing", async () => {
  state.settings = { ...state.settings, profiles: state.settings.profiles.map(profile => profile.id === "ready" ? { ...profile, credentialState: "missing" } : profile) };
  await render();
  const active = option("Ready service");
  expect(active.getAttribute("aria-selected")).toBe("true");
  expect(active.getAttribute("aria-disabled")).not.toBe("true");
  expect(state.selectProfile).not.toHaveBeenCalled();
  await act(async () => option("Another ready service").click());
  expect(state.selectProfile).toHaveBeenCalledExactlyOnceWith("another");
});

it("allows a saved configuration after its missing credentials become available", async () => {
  state.settings = { ...state.settings, profiles: state.settings.profiles.map(profile => profile.id === "missing" ? { ...profile, credentialState: "present" } : profile) };
  await render();
  await act(async () => option("Missing credentials").click());
  expect(state.selectProfile).toHaveBeenCalledExactlyOnceWith("missing");
});
