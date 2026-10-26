// src/schematic-route.test.ts — the bare-lit drawing classifier: strong nouns suffice, weak nouns need a
// drawing or making verb, and charts, interface deliverables and Word or deck requests stay with their owners.

import { describe, expect, it } from "vitest";
import { classifySchematicRequest } from "./schematic-route.js";

describe("classifySchematicRequest #given/#when/#then", () => {
	it.each([
		"lit 고압 하이드레이트 반응기 루프 P&ID 그려줘",
		"lit draw a two-panel journal figure of the experimental setup",
		"lit isometric cutaway of a stirred autoclave",
		"lit 논문용 실험 장치 모식도 만들어줘",
		"lit draw the PFD for the absorber section",
		"lit 공정 계통도",
		"lit 장비 레이아웃 도면 그려줘",
		"lit 반응기 단면도",
		"lit 공장 배치도 그려줘",
		"lit 공정 흐름도 그려줘",
		"lit draw the plot plan for the tank farm",
		"lit draw a P&ID of the reactor loop",
		"lit draw the P&ID that goes on the dashboard",
		"lit make the equipment layout for the compressor house",
		"lit 오토클레이브 컷어웨이를 모션 영상으로 만들어줘",
		"lit make an interactive html cutaway of the reactor",
	])("draws: %s", (prompt) => {
		expect(classifySchematicRequest(prompt)).toBe(true);
	});

	it.each([
		["lit 도면 검토 보고서 작성해줘", "a document about drawings"],
		["lit 공정도 설명 보고서 작성해줘", "a Word report"],
		["lit 배치도 설명 발표자료 만들어줘", "a deck"],
		["lit 계통도 요약 슬라이드 만들어줘", "a deck"],
		["lit make a report about the P&ID", "a Word report"],
		["lit build a dashboard showing the P&ID of the reactor", "an interface"],
		["lit P&ID 모니터링 대시보드 만들어줘", "an interface"],
		["lit design an isometric hero illustration for the landing page", "a web container"],
		["lit 단면도 데이터로 그래프 그려줘", "a chart"],
		["lit 실험 장치 온도 차트 그려줘", "a chart"],
		["lit plot the P&ID loop pressure graph", "a chart"],
		["lit 도면 번호 체계 정리해줘", "a weak noun with no verb"],
		["lit fix the database schema migration", "no drawing noun"],
		["lit draw a flowchart of the login flow", "a software diagram"],
		["`lit draw a P&ID`", "inside a code span"],
	])("leaves %s alone (%s)", (prompt) => {
		expect(classifySchematicRequest(prompt)).toBe(false);
	});

	it("is deterministic and total over odd input", () => {
		expect(classifySchematicRequest("")).toBe(false);
		expect(classifySchematicRequest("lit draw the PFD")).toBe(classifySchematicRequest("lit draw the PFD"));
	});
});
