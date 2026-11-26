import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { RightPanel } from "../components/materials-panel.tsx";

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); dispose = undefined; });

async function fixture() {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	Object.defineProperty(dom.document, "oninput", { configurable: true, value: null });
	const store = new Map<string, string>();
	const win = Object.assign(dom.window, { innerWidth: 1000,
		localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } });
	(dom.window.HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ width: 1000 });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window: win, document: dom.document,
		navigator: { userAgent: "", platform: "" }, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(document.getElementById("root")!);
	const outer: string[] = [];
	dispose = async () => {
		await act(async () => root.unmount());
		for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else Reflect.deleteProperty(globalThis, key); }
	};
	await act(async () => root.render(
		<div onKeyDown={(e) => outer.push(e.key)}>
			<RightPanel tabs={[{ id: "side", label: "Side" }, { id: "materials", label: "Materials" }]} active="side" onSelect={() => {}}>x</RightPanel>
		</div>));
	const key = async (el: Element, k: string, init: Record<string, unknown> = {}) => {
		const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.assign(e, { key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...init });
		await act(async () => { el.dispatchEvent(e); });
		return e;
	};
	return { store, outer, key, sep: () => document.querySelector('[data-testid="right-panel-resize"]')! };
}

test("unmodified Enter/Space stay inside the panel; other keys still bubble", async () => {
	const f = await fixture();
	const tab = document.querySelector('[data-testid="right-panel-tab-materials"]')!;
	await f.key(tab, "Enter"); await f.key(tab, " "); await f.key(tab, "Enter", { ctrlKey: true }); await f.key(tab, "a");
	assert.deepEqual(f.outer, ["Enter", "a"]);
});

test("separator is keyboard resizable and persists like a drag", async () => {
	const f = await fixture();
	const sep = f.sep();
	assert.equal(sep.getAttribute("tabindex"), "0");
	assert.equal(sep.getAttribute("aria-valuemin"), "288");
	assert.equal(sep.getAttribute("aria-valuemax"), "600");
	assert.equal(sep.getAttribute("aria-valuenow"), "352");
	const e = await f.key(sep, "ArrowLeft");
	assert.equal(e.defaultPrevented, true);
	assert.equal(f.sep().getAttribute("aria-valuenow"), "368");
	await f.key(sep, "ArrowRight", { shiftKey: true });
	assert.equal(f.sep().getAttribute("aria-valuenow"), "304");
	assert.equal(f.store.get("lh-right-panel-width"), "304");
	await f.key(sep, "Home"); assert.equal(f.sep().getAttribute("aria-valuenow"), "288");
	await f.key(sep, "ArrowRight"); assert.equal(f.sep().getAttribute("aria-valuenow"), "288");
	await f.key(sep, "End"); assert.equal(f.sep().getAttribute("aria-valuenow"), "600");
	assert.equal(f.store.get("lh-right-panel-width"), "600");
	assert.deepEqual(f.outer, []); // handled keys never reach a live quiz
});
