// Design Ref: 로데이터 모양 변경 — A~G열(참여일·이름·사번·부서·직급·직위·직책)은 문항이 아니고, H열부터 "문항번호N"이 문항이다.
// B~G열(참여자 정보)은 사용자가 "분석 결과에 반영할지" 고르고(기본 아니오), 반영해도 AI에는 보내지 않는다.
// 부서·직급을 고르면 객관식 문항을 집단별로 나눠 응답 수·비율을 따로 센다. 정답은 정답표(tests/fixtures/정답표.json)의 groupResults.
// 실행: npm test

import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildInterpretQuestions } from '../src/lib/ai/client';
import { SHEET_CHOICE, SHEET_SUMMARY, SHEET_TEXT, buildWorkbook } from '../src/lib/excel/build-workbook';
import { NO_GROUP_NAME, analyzeSurvey } from '../src/lib/survey/analyze';
import type { Analysis } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

interface ExpectedGroup {
  name: string;
  respondents: number;
  noAnswer: number;
  multiAnswerCount: number;
  totalSelections: number;
  rows: { optionNo: number | 'etc'; label: string; count: number; percent: number }[];
}
interface ExpectedQuestion {
  no: number;
  type: 'choice' | 'text';
  title: string;
  answers?: { text: string }[];
  groupResults?: { department: ExpectedGroup[]; rank: ExpectedGroup[] };
}
const expected = JSON.parse(fixture('정답표.json').toString('utf8')) as {
  questions: ExpectedQuestion[];
  participantColumns: { role: string; header: string; answerCount: number; answers: (string | null)[] }[];
};
const expectedChoices = expected.questions.filter((q) => q.type === 'choice');

const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const survey = loaded.survey;
const base = analyzeSurvey(survey);
const withParticipants = analyzeSurvey(survey, {}, [], { includeParticipants: true });
const grouped = analyzeSurvey(survey, {}, [], { groupBy: ['department', 'rank'] });
const card = (a: Analysis, no: number) => a.questions.find((q) => q.question.no === no)!;

describe('참여자 정보 반영 선택 — 기본은 반영하지 않는다', () => {
  it('고르지 않으면(기본) 참여자 정보 열은 결과에 카드로 나오지 않는다', () => {
    expect(base.questions).toHaveLength(20);
    expect(base.questions.every((q) => q.participant === null)).toBe(true);
    expect(analyzeSurvey(survey, {}, [], { includeParticipants: false })).toEqual(base);
    expect(analyzeSurvey(survey, {}, [], {})).toEqual(base);
  });

  it('반영하기로 하면 B~G열이 열마다 주관식·서술형 문항 카드 6개가 된다 (제목은 열 제목, 번호는 기존 번호 뒤)', () => {
    expect(withParticipants.questions).toHaveLength(26);
    const cards = withParticipants.questions.filter((q) => q.participant !== null);
    expect(cards.map((q) => [q.question.no, q.question.title, q.participant, q.outcome.type])).toEqual([
      [22, '이름', 'name', 'text'],
      [23, '사번', 'id', 'text'],
      [24, '부서', 'department', 'text'],
      [25, '직급', 'rank', 'text'],
      [26, '직위', 'position', 'text'],
      [27, '직책', 'duty', 'text'],
    ]);
    for (const c of cards) {
      expect(c.question.options).toEqual([]); // 보기가 없으니 객관식으로 바꿀 수 없다
      expect(c.needsReview).toBe(false);
      expect(c.restoredKey).toBeNull();
    }
  });

  it('카드의 응답이 참여자 정보와 같고(정답표), 직급의 빈 칸 2명은 무응답이다', () => {
    for (const e of expected.participantColumns) {
      const c = withParticipants.questions.find((q) => q.participant === e.role)!;
      if (c.outcome.type !== 'text') throw new Error();
      expect(c.outcome.result.answers, e.role).toEqual(e.answers.filter((a): a is string => a !== null));
      expect(c.outcome.result.respondents).toBe(40);
      expect(c.outcome.result.noAnswer).toBe(40 - e.answerCount);
    }
    expect(withParticipants.questions.find((q) => q.participant === 'rank')?.outcome.result.noAnswer).toBe(2);
  });

  it('다른 문항 카드는 반영 여부와 상관없이 그대로다', () => {
    for (const q of base.questions) expect(card(withParticipants, q.question.no)).toEqual(q);
  });

  it('AI에는 보내지 않는다 — 요청 내용은 반영하지 않았을 때와 똑같다', () => {
    expect(buildInterpretQuestions(withParticipants)).toEqual(buildInterpretQuestions(base));
    const sentNos = new Set(buildInterpretQuestions(withParticipants).map((q) => q.no));
    for (const q of withParticipants.questions.filter((x) => x.participant !== null)) expect(sentNos.has(q.question.no)).toBe(false);
  });

  it('응답이 하나도 없는 참여자 정보 열은 카드를 만들지 않는다', async () => {
    const makeXlsx = async (rows: unknown[][]) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('시트');
      for (const row of rows) sheet.addRow(row);
      return new Uint8Array(await workbook.xlsx.writeBuffer());
    };
    const raw = [
      ['참여일', '이름', '사번', '부서', '직급', '직위', '직책', '문항번호1'],
      [null, '김하늘', null, '기획처', null, null, null, '1'],
      [null, '이서준', null, '영업부', null, null, null, '2'],
    ];
    const result = await loadSurvey(await makeXlsx(raw), await makeXlsx([[1, '질문'], [null, '1. 예'], [null, '2. 아니오']]));
    if (!result.ok) throw new Error(result.errors.join(' / '));
    const a = analyzeSurvey(result.survey, {}, [], { includeParticipants: true });
    expect(a.questions.filter((q) => q.participant !== null).map((q) => q.participant)).toEqual(['name', 'department']);
  });
});

describe('집단별 집계 (부서·직급) — 정답표와 같다', () => {
  it('고르지 않으면 집단별 결과가 없다 (반영 여부와는 따로다)', () => {
    for (const a of [base, withParticipants]) {
      for (const q of a.questions) if (q.outcome.type === 'choice') expect(q.outcome.groups).toBeUndefined();
    }
  });

  it('부서별·직급별: 집단 이름·순서, 집단별 응답자 수·무응답·중복응답·응답 건수가 정답표와 같다 (객관식 16문항 전부)', () => {
    expect(expectedChoices).toHaveLength(16);
    for (const q of expectedChoices) {
      const outcome = card(grouped, q.no).outcome;
      if (outcome.type !== 'choice') throw new Error();
      expect(outcome.groups?.map((g) => [g.role, g.label])).toEqual([['department', '부서'], ['rank', '직급']]);
      for (const [index, role] of (['department', 'rank'] as const).entries()) {
        const got = outcome.groups![index].groups;
        const want = q.groupResults![role];
        expect(got.map((g) => g.name), `Q${q.no} ${role} 집단`).toEqual(want.map((g) => g.name));
        got.forEach((g, i) => {
          expect(
            [g.result.respondents, g.result.noAnswer, g.result.multiAnswerCount, g.result.totalSelections],
            `Q${q.no} ${role} ${g.name}`,
          ).toEqual([want[i].respondents, want[i].noAnswer, want[i].multiAnswerCount, want[i].totalSelections]);
        });
      }
    }
  });

  it('집단별 보기별 응답 수·비율이 정답표와 같고, 모든 집단 표가 문항 전체의 보기 줄(기타 포함)을 똑같이 쓴다', () => {
    for (const q of expectedChoices) {
      const outcome = card(grouped, q.no).outcome;
      if (outcome.type !== 'choice') throw new Error();
      for (const [index, role] of (['department', 'rank'] as const).entries()) {
        const want = q.groupResults![role];
        outcome.groups![index].groups.forEach((g, i) => {
          expect(g.result.rows, `Q${q.no} ${role} ${g.name}`).toEqual(want[i].rows);
          expect(g.result.rows.map((r) => r.label)).toEqual(outcome.result.rows.map((r) => r.label));
        });
      }
    }
  });

  it('집단별 비율 합계는 응답이 있는 집단이면 100.0이다 (집단마다 같은 반올림·보정 규칙)', () => {
    let checked = 0;
    for (const q of grouped.questions) {
      if (q.outcome.type !== 'choice') continue;
      for (const g of q.outcome.groups!.flatMap((x) => x.groups)) {
        if (g.result.totalSelections === 0) continue;
        expect(Math.round(g.result.rows.reduce((s, r) => s + r.percent * 10, 0)) / 10, `Q${q.question.no} ${g.name}`).toBe(100);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('집단별 응답자 수를 모두 더하면 전체 응답자 수(40)이고, 값이 빈 응답자는 "(미기재)" 집단으로 맨 뒤에 모인다', () => {
    const first = grouped.questions.find((q) => q.outcome.type === 'choice')!;
    if (first.outcome.type !== 'choice') throw new Error();
    for (const g of first.outcome.groups!) expect(g.groups.reduce((s, x) => s + x.result.respondents, 0)).toBe(40);
    const rank = first.outcome.groups!.find((g) => g.role === 'rank')!;
    expect(rank.groups.at(-1)?.name).toBe(NO_GROUP_NAME);
    expect(rank.groups.at(-1)?.result.respondents).toBe(2); // 빈 칸 1명 + 공백 한 칸 1명
    expect(first.outcome.groups!.find((g) => g.role === 'department')!.groups.some((g) => g.name === NO_GROUP_NAME)).toBe(false);
  });

  it('하나만 골라도 되고(부서만 / 직급만), 문항 전체 결과는 집단을 골라도 달라지지 않는다', () => {
    const onlyDept = analyzeSurvey(survey, {}, [], { groupBy: ['department'] });
    const onlyRank = analyzeSurvey(survey, {}, [], { groupBy: ['rank'] });
    for (const q of expectedChoices) {
      const d = card(onlyDept, q.no).outcome;
      const r = card(onlyRank, q.no).outcome;
      const b = card(base, q.no).outcome;
      if (d.type !== 'choice' || r.type !== 'choice' || b.type !== 'choice') throw new Error();
      expect(d.groups?.map((g) => g.role)).toEqual(['department']);
      expect(r.groups?.map((g) => g.role)).toEqual(['rank']);
      expect(d.result).toEqual(b.result);
      expect(r.result).toEqual(b.result);
    }
  });

  it('주관식·서술형 문항과 참여자 정보 카드에는 집단별 결과가 없다 / 객관식을 주관식으로 바꾸면 집단별 결과도 없어진다', () => {
    const a = analyzeSurvey(survey, { 3: 'text' }, [], { includeParticipants: true, groupBy: ['department', 'rank'] });
    for (const q of a.questions) {
      if (q.outcome.type === 'text') expect('groups' in q.outcome).toBe(false);
    }
    expect(card(a, 3).outcome.type).toBe('text');
    const q4 = card(a, 4).outcome;
    if (q4.type !== 'choice') throw new Error();
    expect(q4.groups).toHaveLength(2);
  });

  it('고른 참여자 정보 열에 값이 하나도 없으면 그 종류는 만들지 않는다', async () => {
    const makeXlsx = async (rows: unknown[][]) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('시트');
      for (const row of rows) sheet.addRow(row);
      return new Uint8Array(await workbook.xlsx.writeBuffer());
    };
    const raw = [
      ['참여일', '이름', '사번', '부서', '직급', '직위', '직책', '문항번호1'],
      [null, '김하늘', null, '기획처', null, null, null, '1'],
      [null, '이서준', null, '기획처', null, null, null, '2'],
      [null, '박지우', null, '영업부', null, null, null, '1'],
    ];
    const result = await loadSurvey(await makeXlsx(raw), await makeXlsx([[1, '질문'], [null, '1. 예'], [null, '2. 아니오']]));
    if (!result.ok) throw new Error(result.errors.join(' / '));
    const a = analyzeSurvey(result.survey, {}, [], { groupBy: ['department', 'rank'] });
    const outcome = a.questions[0].outcome;
    if (outcome.type !== 'choice') throw new Error();
    expect(outcome.groups?.map((g) => g.role)).toEqual(['department']); // 직급 열은 값이 없어서 빠진다
    expect(outcome.groups?.[0].groups.map((g) => [g.name, g.result.respondents, g.result.rows.map((r) => r.count)])).toEqual([
      ['기획처', 2, [1, 1]],
      ['영업부', 1, [1, 0]],
    ]);
    // 직급만 골랐는데 직급 값이 없으면 집단별 결과 자체가 없다
    const onlyRank = analyzeSurvey(result.survey, {}, [], { groupBy: ['rank'] }).questions[0].outcome;
    if (onlyRank.type !== 'choice') throw new Error();
    expect(onlyRank.groups).toBeUndefined();
  });
});

// ---------- 엑셀 ----------
async function build(analysis: Analysis): Promise<ExcelJS.Workbook> {
  const bytes = await buildWorkbook(analysis);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}
const val = (ws: ExcelJS.Worksheet, r: number, c: number) => {
  const v = ws.getCell(r, c).value;
  return v === null || v === undefined ? null : (v as string | number);
};
const findRow = (ws: ExcelJS.Worksheet, text: string, from = 1): number => {
  for (let r = from; r <= ws.rowCount; r++) if (val(ws, r, 1) === text) return r;
  return -1;
};
const allText = (wb: ExcelJS.Workbook): string => {
  const parts: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.value ?? '')))));
  return parts.join('\n');
};

describe('엑셀 — 집단별 결과와 참여자 정보', () => {
  it('집단별 결과를 고르면 객관식 시트에 부서별·직급별 표가 있고, 숫자가 화면(정답표)과 같다', async () => {
    const ws = (await build(grouped)).getWorksheet(SHEET_CHOICE)!;
    for (const q of expectedChoices.slice(0, 6)) {
      const top = findRow(ws, `Q${q.no}. ${q.title}`);
      for (const [label, role] of [['부서', 'department'], ['직급', 'rank']] as const) {
        let r = findRow(ws, `${label}별 결과`, top);
        expect(r, `Q${q.no} ${label}별 결과`).toBeGreaterThan(top);
        r++;
        for (const g of q.groupResults![role]) {
          expect(val(ws, r, 1)).toBe(`${label}: ${g.name} (응답자 ${g.respondents}명 · 응답 ${g.totalSelections}건)`);
          // 표: 제목 줄, 보기 줄들, 합계 줄
          expect([val(ws, r + 1, 1), val(ws, r + 1, 2), val(ws, r + 1, 3)]).toEqual(['보기', '응답 수', '비율(%)']);
          g.rows.forEach((row, i) => expect([val(ws, r + 2 + i, 1), val(ws, r + 2 + i, 2), val(ws, r + 2 + i, 3)]).toEqual([row.label, row.count, row.percent]));
          const total = r + 2 + g.rows.length;
          expect([val(ws, total, 1), val(ws, total, 2)]).toEqual(['합계', g.totalSelections]);
          r = total + 2; // 합계 줄 + 빈 줄
        }
      }
    }
  });

  it('집단별 결과를 고르지 않으면 엑셀에도 없다', async () => {
    const text = allText(await build(base));
    expect(text).not.toContain('부서별 결과');
    expect(text).not.toContain('직급별 결과');
  });

  it('참여자 정보를 반영하면 주관식·서술형 시트에 열마다 목록이 들어가고 요약 시트에도 나오며, 반영하지 않으면 값이 없다', async () => {
    const wb = await build(withParticipants);
    const text = allText(wb);
    const names = expected.participantColumns.find((c) => c.role === 'name')!.answers.filter((a): a is string => a !== null);
    for (const name of names) expect(text).toContain(name);
    expect(findRow(wb.getWorksheet(SHEET_TEXT)!, 'Q22. 이름')).toBeGreaterThan(0);
    const summary = wb.getWorksheet(SHEET_SUMMARY)!;
    expect([22, 23, 24, 25, 26, 27].map((_, i) => val(summary, 22 + i, 2))).toEqual(['이름', '사번', '부서', '직급', '직위', '직책']);
    // 반영하지 않으면 이름 값이 파일 어디에도 없다
    const without = allText(await build(base));
    for (const name of names) expect(without).not.toContain(name);
  });
});
