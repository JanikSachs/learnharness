import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import { formatGap, GAP_MS, isValidTimeZone, timeNoteText, withTimeNotes } from "../src/core/time-notes.ts";
import { activeTimeZone, sanitizeUserSettings } from "../src/core/settings.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";

// Synthetic history only. 2026-11-20T12:00Z = 13:00 Berlin (CET).
const T0 = Date.UTC(2026, 10, 20, 12, 0);
const H = 60 * 60 * 1000;
const ZONE = "Europe/Berlin";

const user = (t: number, text = "u"): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: t });
const result = (t: number, id: string): Message => ({ role: "toolResult", toolCallId: id, toolName: "quiz", content: [{ type: "text", text: "a" }], isError: false, timestamp: t });
const assistant = (t: number, calls: string[] = []): Message => ({
	role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "m", stopReason: calls.length ? "toolUse" : "stop", timestamp: t,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	content: [{ type: "text", text: "a" }, ...calls.map((id) => ({ type: "toolCall" as const, id, name: "quiz", arguments: {} }))],
});
const isNote = (m: Message | undefined) => m?.role === "user" && typeof m.content !== "string" && m.content[0]?.type === "text" && m.content[0].text.startsWith("[app: time]");
const noteText = (m: Message) => (m.content as { text: string }[])[0]!.text;

describe("time notes", () => {
	it("marks the start of a chat after the first message", () => {
		const out = withTimeNotes([user(T0), assistant(T0 + 1000)], ZONE);
		assert.equal(out.length, 3);
		assert.equal(noteText(out[1]!), "[app: time] Fri 2026-11-20 13:00 (Europe/Berlin).\nStart of this chat.");
	});

	it("adds a gap note at the threshold, not below it", () => {
		const at = withTimeNotes([user(T0), assistant(T0), user(T0 + GAP_MS)], ZONE);
		assert.ok(isNote(at.at(-1)));
		assert.match(noteText(at.at(-1)!), /Previous message: Fri 2026-11-20 13:00\.\nGap: 3 hours 0 minutes\./);
		const below = withTimeNotes([user(T0), assistant(T0), user(T0 + GAP_MS - 1)], ZONE);
		assert.equal(below.filter(isNote).length, 1); // start note only
	});

	it("never separates tool calls from their results", () => {
		const late = T0 + 50 * H;
		const out = withTimeNotes([user(T0), assistant(T0, ["a", "b"]), result(late, "a"), result(late, "b"), assistant(late)], ZONE);
		assert.deepEqual(out.map((m) => isNote(m) ? "note" : m.role), ["user", "note", "assistant", "toolResult", "toolResult", "note", "assistant"]);
		// A gap ending on an assistant message waits for the results after it.
		const held = withTimeNotes([user(T0), assistant(T0 + 4 * H, ["c"]), result(T0 + 4 * H, "c")], ZONE);
		assert.deepEqual(held.map((m) => isNote(m) ? "note" : m.role), ["user", "note", "assistant", "toolResult", "note"]);
	});

	it("skips the system message and treats a compaction head as neither start nor reference", () => {
		const system = { role: "system", content: "s", timestamp: T0 } as unknown as Message;
		const head = user(T0 + 10 * H, "summary");
		const out = withTimeNotes([system, head, user(T0), assistant(T0), user(T0 + 4 * H)], ZONE, true);
		assert.deepEqual(out.map((m) => isNote(m) ? "note" : m.role), ["system", "user", "user", "assistant", "user", "note"]);
	});

	it("follows daylight saving in the chosen zone", () => {
		assert.match(timeNoteText(Date.UTC(2026, 6, 1, 12, 0), null, ZONE), /Wed 2026-07-01 14:00/);
	});

	it("formats gaps", () => {
		assert.equal(formatGap(49 * H), "2 days 1 hour");
		assert.equal(formatGap(5 * H + 24 * 60_000), "5 hours 24 minutes");
	});
});

describe("time context settings", () => {
	it("validates zones", () => {
		assert.ok(isValidTimeZone(ZONE));
		assert.ok(!isValidTimeZone("Mars/Base"));
		assert.ok(!isValidTimeZone(""));
	});

	it("is active only when enabled with a valid zone", () => {
		assert.equal(activeTimeZone({ enabled: true, timeZone: ZONE }), ZONE);
		assert.equal(activeTimeZone({ enabled: true }), null);
		assert.equal(activeTimeZone({ enabled: false, timeZone: ZONE }), null);
		assert.equal(activeTimeZone(undefined), null);
	});

	it("drops an invalid stored zone on read", () => {
		const read = sanitizeUserSettings({ version: 1, agent: { timeContext: { enabled: true, timeZone: "Mars/Base" } } });
		assert.deepEqual(read?.agent?.timeContext, { enabled: true });
		assert.equal(activeTimeZone(read?.agent?.timeContext), null);
	});

	it("rejects bad writes and requires a zone when enabling", () => {
		assert.equal(parseAgentSettingsBody({ timeContext: { enabled: true, timeZone: ZONE } }).ok, true);
		assert.equal(parseAgentSettingsBody({ timeContext: { enabled: true } }).ok, false);
		assert.equal(parseAgentSettingsBody({ timeContext: { timeZone: "Mars/Base" } }).ok, false);
		assert.equal(parseAgentSettingsBody({ timeContext: { enabled: "yes" } }).ok, false);
		assert.equal(parseAgentSettingsBody({ timeContext: { enabled: false } }).ok, true);
	});
});
