// Design Ref: §10 / PLAN 작업 22 — 성공 기준 SC-1~8을 "예시 파일 → 읽기 → 집계 → (가짜) AI 해석 → 엑셀 파일 → 다시 읽기" 전체 흐름으로 하나씩 점검한다.
// 정답표(tests/fixtures/정답표.json)는 손으로 계산한 값이다. 비교는 화면 값이 아니라 "마지막에 만든 엑셀 파일"에서 읽은 값으로 한다.
// 실제 AI와 실제 브라우저 화면은 쓰지 않는다 (브라우저 확인은 별도). 실행: npm test

import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildInterpretQuestions, doneInterpretations, toCardState } from '../src/lib/ai/client';
import { handleInterpret } from '../src/lib/ai/handler';
import type { InterpretResponse } from '../src/lib/ai/types';
import { SHEET_CHOICE, SHEET_SUMMARY, SHEET_TEXT, buildWorkbook } from '../src/lib/excel/build-workbook';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';
import { splitViews } from '../src/lib/survey/split-views';
import { makeFakeAi } from './helpers/fake-ai';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

interface ExpectedChoice {
  no: number;
  type: 'choice';
  title: string;
  respondents: number;
  noAnswer: number;
  totalSelections: number;
  multiAnswerCount: number;
  rows: { optionNo: number | 'etc'; label: string; count: number; percent: number }[];
}
interface ExpectedText {
  no: number;
  type: 'text';
  title: string;
  respondents: number;
  noAnswer: number;
  answerCount: number;
  totalViews: number;
  answers: { respondent: number; text: string; viewCount: number }[];
}
const expected = JSON.parse(fixture('정답표.json').toString('utf8')) as {
  questions: (ExpectedChoice | ExpectedText)[];
  expectedTypes: Record<string, 'choice' | 'text'>;
  excludedColumns: { no: number; reason: string }[];
  viewCountExamples: { text: string; viewCount: number; why: string }[];
};

// ---------- 전체 흐름을 한 번 돌리고, 시간을 잰다 (SC-1) ----------
const startedAt = performance.now();
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const analysis = analyzeSurvey(loaded.survey);

const { ai, seen } = makeFakeAi('good');
const requestBody = JSON.stringify({ questions: buildInterpretQuestions(analysis) });
const aiResult = await handleInterpret({ expectedPassword: 'p', password: 'p', contentLength: null, readBody: async () => requestBody, ai });
const aiBody = aiResult.body as InterpretResponse;
const items = Object.fromEntries(
  analysis.questions.map((q) => [q.question.no, toCardState(q, aiBody.interpretations[String(q.question.no)], aiBody.failed.includes(q.question.no))]),
);
const interpretations = doneInterpretations(items);

const FAKE_PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const bytes = await buildWorkbook(analysis, { interpretations, renderChart: async () => FAKE_PNG });
const programMs = performance.now() - startedAt;

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
const summarySheet = workbook.getWorksheet(SHEET_SUMMARY)!;
const choiceSheet = workbook.getWorksheet(SHEET_CHOICE)!;
const textSheet = workbook.getWorksheet(SHEET_TEXT)!;

const val = (ws: ExcelJS.Worksheet, r: number, c: number) => {
  const v = ws.getCell(r, c).value;
  return v === null || v === undefined ? null : (v as string | number);
};
const findRow = (ws: ExcelJS.Worksheet, text: string, from = 1): number => {
  for (let r = from; r <= ws.rowCount; r++) if (val(ws, r, 1) === text) return r;
  return -1;
};
const heading = (q: ExpectedChoice | ExpectedText) => `Q${q.no}. ${q.title}`;
const expectedChoices = expected.questions.filter((q): q is ExpectedChoice => q.type === 'choice');
const expectedTexts = expected.questions.filter((q): q is ExpectedText => q.type === 'text');

describe('SC-1 · 문항 20개를 파일 올리기부터 엑셀 만들기까지 5분 이내', () => {
  it('예시(문항 20개·응답자 40명)에서 프로그램이 걸리는 시간은 5분(300초)에 한참 못 미친다', () => {
    expect(analysis.questions).toHaveLength(20);
    expect(analysis.respondents).toBe(40);
    // 사람이 파일을 고르고 버튼을 누르는 시간과 실제 AI가 답하는 시간은 여기에 들어 있지 않다 (AI는 가짜)
    expect(programMs).toBeLessThan(30_000);
  });

  it('AI 해석은 문항 20개를 한 번의 요청으로 보낸다 (사람이 문항마다 누르지 않는다)', () => {
    expect(JSON.parse(requestBody).questions).toHaveLength(20);
    expect(aiResult.status).toBe(200);
    expect(seen).toHaveLength(20); // 가짜 AI 호출은 문항당 1번 (다시 묻기 없음)
  });
});

describe('SC-2 · 객관식 응답 수·비율이 정답표와 100% 일치 (엑셀 파일에서 읽은 값)', () => {
  it('문항 16개의 보기별 응답 수·비율·합계가 모두 같다', () => {
    expect(expectedChoices).toHaveLength(16);
    for (const q of expectedChoices) {
      const top = findRow(choiceSheet, heading(q));
      expect(top, heading(q)).toBeGreaterThan(0);
      q.rows.forEach((row, i) => {
        const r = top + 3 + i;
        expect([val(choiceSheet, r, 1), val(choiceSheet, r, 2), val(choiceSheet, r, 3)], `Q${q.no} ${row.label}`).toEqual([row.label, row.count, row.percent]);
      });
      const total = top + 3 + q.rows.length;
      expect([val(choiceSheet, total, 1), val(choiceSheet, total, 2)]).toEqual(['합계', q.totalSelections]);
    }
  });

  it('요약 시트의 응답자 수·응답 건수·중복응답 건수·무응답 수도 정답표와 같다', () => {
    for (const q of expectedChoices) {
      const r = findSummaryRow(q.no);
      expect([val(summarySheet, r, 4), val(summarySheet, r, 5), val(summarySheet, r, 6), val(summarySheet, r, 7)]).toEqual([q.respondents, q.totalSelections, q.multiAnswerCount, q.noAnswer]);
    }
  });
});

function findSummaryRow(no: number): number {
  for (let r = 2; r <= summarySheet.rowCount; r++) if (val(summarySheet, r, 1) === no) return r;
  return -1;
}

describe('SC-3 · 객관식 문항의 비율 합계가 100.0%', () => {
  it('엑셀의 보기별 비율 칸을 모두 더하면 100.0이고, 합계 칸도 100.0이다 (16문항 모두)', () => {
    for (const q of expectedChoices) {
      const top = findRow(choiceSheet, heading(q));
      let sum = 0;
      for (let i = 0; i < q.rows.length; i++) sum += val(choiceSheet, top + 3 + i, 3) as number;
      expect(Math.round(sum * 10) / 10, `Q${q.no}`).toBe(100);
      expect(val(choiceSheet, top + 3 + q.rows.length, 3), `Q${q.no} 합계 칸`).toBe(100);
    }
  });
});

describe('SC-4 · 주관식·서술형 응답 수가 정답표와 100% 일치', () => {
  it('응답자 수 − 무응답 = 응답 수 = 엑셀 응답 목록 줄 수 = 정답표 (문항 4개)', () => {
    expect(expectedTexts).toHaveLength(4);
    for (const q of expectedTexts) {
      const r = findSummaryRow(q.no);
      expect([val(summarySheet, r, 4), val(summarySheet, r, 5), val(summarySheet, r, 7)]).toEqual([q.respondents, q.answerCount, q.noAnswer]);
      expect(q.respondents - q.noAnswer).toBe(q.answerCount);

      const top = findRow(textSheet, heading(q));
      let header = -1;
      for (let i = top; i <= textSheet.rowCount; i++) if (val(textSheet, i, 1) === '번호') { header = i; break; }
      expect(val(textSheet, header, 2)).toBe(`응답 목록 (${q.answerCount}건)`);
      // 응답 원문이 순서대로 같다
      q.answers.forEach((answer, i) => expect(val(textSheet, header + 1 + i, 2), `Q${q.no} ${i + 1}번째`).toBe(answer.text));
    }
  });
});

describe('SC-5 · 관점 나누기 ( . / 그리고 / 또한 / 쉼표는 완결된 문장일 때만 )', () => {
  it('정답표의 예시 답변이 정해진 개수로 나뉜다', () => {
    for (const example of expected.viewCountExamples) {
      expect(splitViews(example.text), `${example.text} (${example.why})`).toHaveLength(example.viewCount);
    }
  });

  it('문항마다 나눈 관점 수의 합이 정답표와 같고, 응답 하나하나의 관점 수도 같다', () => {
    for (const q of expectedTexts) {
      const item = analysis.questions.find((a) => a.question.no === q.no)!;
      if (item.outcome.type !== 'text') throw new Error();
      expect(item.outcome.result.views, `Q${q.no} 관점 수`).toHaveLength(q.totalViews);
      for (const answer of q.answers) expect(splitViews(answer.text), answer.text).toHaveLength(answer.viewCount);
    }
  });

  it('나눈 관점이 AI 요청으로 간다 (요약에 반영되는 재료)', () => {
    const sent = buildInterpretQuestions(analysis).filter((q) => q.type === 'text');
    for (const q of expectedTexts) expect(sent.find((s) => s.no === q.no)).toMatchObject({ type: 'text', views: expect.any(Array) });
    for (const q of expectedTexts) {
      const s = sent.find((x) => x.no === q.no);
      expect(s?.type === 'text' && s.views.length).toBe(q.totalViews);
    }
  });
});

describe('SC-6 · 버튼 1번으로 엑셀, 화면 숫자와 100% 같음', () => {
  it('엑셀의 모든 객관식 숫자가 화면을 그리는 집계 결과와 같다', () => {
    for (const item of analysis.questions) {
      if (item.outcome.type !== 'choice') continue;
      const top = findRow(choiceSheet, `Q${item.question.no}. ${item.question.title}`);
      item.outcome.result.rows.forEach((row, i) => {
        expect([val(choiceSheet, top + 3 + i, 2), val(choiceSheet, top + 3 + i, 3)]).toEqual([row.count, row.percent]);
      });
    }
  });

  it('시트 3개, 차트 그림은 응답이 있는 객관식 문항 16개에 하나씩', () => {
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['문항별 요약', '객관식 결과', '주관식·서술형 결과']);
    expect(choiceSheet.getImages()).toHaveLength(16);
  });
});

describe('SC-7 · 해석: 객관식 문항마다 1개 이상, 주관식·서술형은 주요 의견 3개 이상', () => {
  it('객관식 16문항 모두 해석이 있고 엑셀에 들어 있다', () => {
    expect(aiBody.failed).toEqual([]);
    for (const q of expectedChoices) {
      expect(interpretations[q.no]?.text, `Q${q.no} 해석`).toBeTruthy();
      const top = findRow(choiceSheet, heading(q));
      let found = false;
      for (let r = top; r < top + 12; r++) if (String(val(choiceSheet, r, 1) ?? '').startsWith('AI 해석: ')) found = true;
      expect(found, `Q${q.no} 엑셀 해석 줄`).toBe(true);
    }
  });

  it('주관식·서술형 4문항 모두 주요 의견이 3개 이상(관점이 3개보다 적으면 있는 만큼)이고 엑셀에 들어 있다', () => {
    for (const q of expectedTexts) {
      const opinions = interpretations[q.no]?.opinions ?? [];
      expect(opinions.length, `Q${q.no} 의견 수`).toBeGreaterThanOrEqual(Math.min(3, q.totalViews));
      expect(opinions.length).toBeLessThanOrEqual(5);
      const top = findRow(textSheet, heading(q));
      let first = -1;
      for (let r = top; r < top + 6; r++) if (val(textSheet, r, 1) === '의견 1') first = r;
      expect(first, `Q${q.no} 엑셀 의견`).toBeGreaterThan(0);
      expect(val(textSheet, first, 2)).toBe(opinions[0].summary);
      expect(val(textSheet, first, 3)).toBe(opinions[0].count);
    }
  });
});

describe('SC-8 · 참여자 정보 열(이름·사번·부서·직급·직위·직책)이 AI 전송과 결과 파일에 없다 (반영을 고르지 않았을 때)', () => {
  const distinct = (answers: (string | null)[]) => [...new Set(answers.filter((a): a is string => a !== null && a.trim().length >= 3))];
  const removedValues = [
    ...loaded.survey.responses.participants.flatMap((p) => distinct(p.answers).map((value) => ({ value, reason: p.role }))),
    ...analysis.removed.flatMap(({ column, reason }) => distinct(column.answers).map((value) => ({ value, reason }))),
  ];

  it('뺀 열이 정답표와 같다 (문항 파일에 없는 문항번호21), 참여자 정보 열 6개는 따로 읽어 둔다', () => {
    expect(analysis.excluded.map((e) => ({ no: e.no, reason: e.reason }))).toEqual(expected.excludedColumns);
    expect(loaded.survey.responses.participants).toHaveLength(6);
    expect(removedValues.length).toBeGreaterThan(0);
  });

  it('AI가 받은 글 전체에 그 열의 값이 하나도 없다', () => {
    const everything = seen.map((s) => `${s.system}\n${s.prompt}`).join('\n');
    for (const { value, reason } of removedValues) expect(everything, `${reason}: ${value}`).not.toContain(value);
  });

  it('엑셀 파일 어디에도 그 열의 값이 없다', () => {
    const parts: string[] = [];
    workbook.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.value ?? '')))));
    const text = parts.join('\n');
    for (const { value, reason } of removedValues) expect(text, `${reason}: ${value}`).not.toContain(value);
  });
});

describe('유형 추정(정답표)', () => {
  it('문항 20개의 유형이 정답표와 같다', () => {
    for (const item of analysis.questions) expect(item.outcome.type, `Q${item.question.no}`).toBe(expected.expectedTypes[String(item.question.no)]);
  });
});
