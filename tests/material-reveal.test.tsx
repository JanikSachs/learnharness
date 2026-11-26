import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredCard } from "../components/answered-card.tsx";
import { revealMessage } from "../components/citation-source.ts";
import { messageAnchorId } from "../src/core/session-navigation.ts";

// Synthetic records only.
describe("material go-to-message targets", () => {
	it("answered cards render the message anchor id", () => {
		const answer = { kind: "ask", questionText: "Which?", dismissed: true } as never;
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} anchorId={messageAnchorId("m1")} />);
		assert.ok(html.includes(`id="${messageAnchorId("m1")}"`));
	});

	it("a pending question's dock is flashed when no transcript element exists", () => {
		const classes = new Set<string>();
		let scrolled = false;
		const dock = { scrollIntoView: () => { scrolled = true; }, classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } as unknown as HTMLElement;
		const transcript = { ownerDocument: { getElementById: () => null }, querySelectorAll: () => [] } as unknown as HTMLElement;
		Object.assign(globalThis, { window: { setTimeout: () => 0 }, HTMLElement: class {} });
		assert.equal(revealMessage({ transcript, scroll: null, messageId: "m1", pendingDock: dock }), true);
		assert.ok(scrolled && classes.has("lh-source-highlight"));
		assert.equal(revealMessage({ transcript, scroll: null, messageId: "m1" }), false);
	});
});
