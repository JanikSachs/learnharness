import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { MessageResponse } from "../components/ai-elements/message.tsx";
import { MaterialsContext } from "../components/materials-context.ts";
import { clampPanelWidth } from "../components/materials-panel.tsx";
import { collectMaterials, extractFromMarkdown, materialId, materialIdFromHref, uniqueMaterials, withMaterialNotes } from "../src/core/materials.ts";
import { toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";

// Synthetic records only.
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const TABLE = "| look at | ask |\n|---|---|\n| imports | values? |";
const assistant = (id: string, t: number, content: unknown[], stopReason = "stop") =>
	({ id, role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "m", stopReason, timestamp: t, usage, content }) as unknown as LhMessage;
const send = (id: string, message: string, t = 1) => ({ type: "toolCall", id, name: "send_to_user", arguments: { message } });
const result = (id: string, callId: string, t: number) =>
	({ id, role: "toolResult", toolCallId: callId, toolName: "send_to_user", content: [{ type: "text", text: "ok" }], isError: false, timestamp: t }) as unknown as LhMessage;
const user = (id: string, t: number) => ({ id, role: "user", content: [{ type: "text", text: "q" }], timestamp: t }) as unknown as LhMessage;

const answerResult = (id: string, callId: string, toolName: string, t: number, extra: Record<string, unknown> = {}) =>
	({ id, role: "toolResult", toolCallId: callId, toolName, content: [{ type: "text", text: "a" }], isError: false, details: { answer: "x" }, timestamp: t, ...extra }) as unknown as LhMessage;
const qcall = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall", id, name, arguments: args });

describe("materials extraction", () => {
	it("finds tables and mermaid fences, titled by the nearest heading", () => {
		const items = extractFromMarkdown(`## The **capstone**\n\nText\n\n${TABLE}\n\n\`\`\`mermaid\ngraph TD\n  a[Start] --> b[End]\n\`\`\``);
		assert.deepEqual(items.map((i) => [i.kind, i.title]), [["table", "The capstone"], ["diagram", "The capstone"]]);
		assert.equal(items[0]!.markdown, TABLE);
	});

	it("falls back to the header row / node labels, and ignores code", () => {
		const items = extractFromMarkdown(`${TABLE}\n\n\`\`\`ts\nconst x = "| a | b |\\n|---|---|";\n| c | d |\n|---|---|\n\`\`\`\n\n\`\`\`mermaid\ngraph TD\n a[One] --> b[Two]\n\`\`\``);
		assert.deepEqual(items.map((i) => [i.kind, i.title]), [["table", "look at | ask"], ["diagram", "One, Two"]]);
	});

	it("numbers the record in order across text and tool calls, skipping failed and plan messages", () => {
		const items = collectMaterials([
			user("u1", 1),
			assistant("a1", 2, [{ type: "text", text: TABLE }, send("c1", `# Second\n${TABLE}`)]),
			assistant("a2", 3, [send("c2", TABLE)], "error"),
			assistant("a3", 4, [{ type: "toolCall", id: "p", name: "plan_init", arguments: { mermaid: "```mermaid\ngraph TD\na-->b\n```" } }]),
			assistant("a4", 5, [{ type: "toolCall", id: "q", name: "quiz", arguments: { question: "q", explanation: TABLE } }]),
			answerResult("r4", "q", "quiz", 6),
		]);
		const t = materialId("table", TABLE);
		assert.deepEqual(items.map((i) => `${i.id}@${i.messageId}:${i.title}`), [`${t}@a1:look at | ask`, `${t}@a1:Second`, `${t}@a4:look at | ask`]);
		assert.equal(uniqueMaterials(items).length, 1, "same content, same id, listed once");
	});

	it("keeps an item's id when other items are added before it", () => {
		const target = "| a | b |\n|---|---|\n| 1 | 2 |";
		const before = collectMaterials([assistant("a1", 1, [{ type: "text", text: target }])]);
		const after = collectMaterials([
			assistant("a0", 0, [{ type: "text", text: `${TABLE}\n\n\`\`\`mermaid\ngraph TD\n a[x]\n\`\`\`` }]),
			assistant("a1", 1, [{ type: "text", text: target }]),
		]);
		assert.equal(after.at(-1)!.id, before[0]!.id);
	});

	it("an edited item no longer resolves rather than pointing elsewhere", () => {
		const old = materialId("table", TABLE);
		const ids = collectMaterials([assistant("a1", 1, [{ type: "text", text: TABLE.replace("values?", "values!") }])]).map((i) => i.id);
		assert.ok(!ids.includes(old));
		assert.match(old, /^t[0-9a-z]{6}$/);
		assert.match(materialId("diagram", "graph TD"), /^d[0-9a-z]{6}$/);
		assert.equal(materialId("table", ` ${TABLE.replace(/\n/g, "\n  ")} `), old, "whitespace-normalised");
	});

	it("parses only material: hrefs with a valid id", () => {
		assert.equal(materialIdFromHref("material:t3f9a2c"), "t3f9a2c");
		assert.equal(materialIdFromHref("material:M27"), null);
		assert.equal(materialIdFromHref("material:x3f9a2c"), null);
		assert.equal(materialIdFromHref("https://x"), null);
	});
});

describe("materials: questions and failures", () => {
	const t = materialId("table", TABLE);
	it("hides a pending explanation until the real answer; the placeholder ack does not count", () => {
		const call = assistant("a1", 1, [qcall("q", "quiz", { question: "q", explanation: TABLE })]);
		assert.equal(collectMaterials([call]).length, 0);
		const ack = answerResult("c_1", "q", "quiz", 2, { details: null });
		assert.equal(collectMaterials([call, ack]).length, 0);
		assert.deepEqual(collectMaterials([call, answerResult("r1", "q", "quiz", 3)]).map((i) => i.id), [t]);
	});

	it("reads only the question field of explain, recall, ask_user_question and probe", () => {
		for (const name of ["explain", "recall", "ask_user_question", "probe"]) {
			const call = assistant("a1", 1, [qcall("q", name, { question: TABLE, correctAnswer: `# X\n${TABLE}\n| p | q |\n|---|---|\n| 1 | 2 |`, rubric: "| r | s |\n|---|---|\n| 1 | 2 |" })]);
			assert.deepEqual(collectMaterials([call]).map((i) => i.id), [t], name);
		}
	});

	it("skips calls whose result errored, keeps the rest of the message", () => {
		const other = "| z | y |\n|---|---|\n| 1 | 2 |";
		const record = [
			assistant("a1", 1, [{ type: "text", text: other }, send("s", TABLE), qcall("q", "explain", { question: TABLE })]),
			{ ...result("r1", "s", 2), isError: true } as unknown as LhMessage,
			answerResult("r2", "q", "explain", 3, { isError: true }),
		];
		assert.deepEqual(collectMaterials(record).map((i) => i.id), [materialId("table", other)]);
	});

	it("groups notes by position when messages have no id", () => {
		const a = (content: unknown[]) => { const m = assistant("", 1, content) as unknown as Record<string, unknown>; delete m.id; return m as unknown as AgentMessage; };
		const other = "| z | y |\n|---|---|\n| 1 | 2 |";
		const out = withMaterialNotes([a([send("c1", TABLE)]), a([send("c2", other)])]) as unknown as { id?: string; role: string; content: unknown }[];
		const notes = out.filter((m) => m.role === "custom");
		assert.deepEqual(notes.map((n) => n.id), ["materials-note-0", "materials-note-1"]);
		assert.ok(String(notes[0]!.content).includes(t) && !String(notes[0]!.content).includes(materialId("table", other)));
		assert.deepEqual(out.map((m) => m.role), ["assistant", "custom", "assistant", "custom"]);
	});
});

describe("material notes on the request path", () => {
	const noteTexts = (messages: AgentMessage[]) => toLlmMessages(messages).map((m) =>
		m.role === "user" && Array.isArray(m.content) && (m.content[0] as { text?: string }).text?.startsWith("[app: materials]") ? "note" : m.role);

	it("places the note after the message's tool results and leaves the record untouched", () => {
		const record = [user("u1", 1), assistant("a1", 2, [send("c1", TABLE)]), result("r1", "c1", 3), user("u2", 4)];
		const before = JSON.stringify(record);
		const annotated = withMaterialNotes(record as unknown as AgentMessage[]);
		assert.deepEqual(noteTexts(annotated), ["user", "assistant", "toolResult", "note", "user"]);
		assert.equal(JSON.stringify(record), before);
		const note = toLlmMessages(annotated)[3]!;
		assert.equal((note.content as { text: string }[])[0]!.text, `[app: materials]\n${materialId("table", TABLE)}: table "look at | ask"`);
		assert.equal(note.timestamp, 3);
	});

	it("waits for a later answer to the message's call", () => {
		const record = [assistant("a1", 2, [{ type: "toolCall", id: "c1", name: "quiz", arguments: { question: TABLE } }]), result("r1", "c1", 9)];
		assert.deepEqual(noteTexts(withMaterialNotes(record as unknown as AgentMessage[])), ["assistant", "toolResult", "note"]);
	});

	it("adds nothing without materials", () => {
		const record = [user("u1", 1), assistant("a1", 2, [{ type: "text", text: "plain" }])];
		assert.equal(withMaterialNotes(record as unknown as AgentMessage[]).length, 2);
	});
});

describe("material links", () => {
	const render = (md: string, has: boolean) => renderMarkup(
		<InteractionLayersProvider>
			<MaterialsContext.Provider value={{ has: () => has, open: () => {} }}>
				<MessageResponse mode="static">{md}</MessageResponse>
			</MaterialsContext.Provider>
		</InteractionLayersProvider>);

	it("renders a known material link as a chip button", () => {
		const html = render("Read it with [the table from last time](material:t3f9a2c):", true);
		assert.match(html, /<button[^>]*data-testid="material-link"[^>]*data-material-id="t3f9a2c"[^>]*>the table from last time<\/button>/);
	});

	it("renders an unknown id as plain text and keeps normal links", () => {
		const html = render("[gone](material:t000000) and [site](https://example.com)", false);
		assert.ok(!html.includes("material-link"));
		assert.ok(html.includes(">gone<"));
		// Ordinary links keep Streamdown's own link rendering (link safety).
		assert.match(html, /data-streamdown="link"[^>]*>site</);
	});

	it("clamps the panel width", () => {
		assert.equal(clampPanelWidth(100, 1000), 288);
		assert.equal(clampPanelWidth(900, 1000), 600);
		assert.equal(clampPanelWidth(400, 1000), 400);
	});
});
