// Design Ref: §2 ④ 분석에서 뺀 열 / PRD Must 4 — 작업 18: 빠진 열을 "문항으로 되돌리기".
// 질문이 있는 열(사번·부서·이름처럼 보이는 문항 열)은 그 질문으로, 질문이 없는 열은 열 제목을 질문으로 쓰는 주관식·서술형으로만 되돌아온다.
// (참여자 정보 B~G열은 이 목록이 아니라, 파일을 올릴 때 고르는 "참여자 정보 반영" 선택으로 다룬다 — tests/participants.test.ts)
// 실행: npm test

import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildInterpretQuestions } from '../src/lib/ai/client';
import { analyzeSurvey, canUseType } from '../src/lib/survey/analyze';
import type { Analysis } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';
import type { LoadedSurvey } from '../src/lib/survey/load';
import { buildTextResult } from '../src/lib/survey/split-views';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const INFO = ['참여일', '이름', '사번', '부서', '직급', '직위', '직책'];
const qh = (n: number) => `문항번호${n}`;
const header = (...cols: unknown[]) => [...INFO, ...cols];
const person = (...cells: unknown[]) => [...Array<null>(7).fill(null), ...cells];

const makeXlsx = async (rows: unknown[][]) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('시트');
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
};
async function load(questionRows: unknown[][], rawRows: unknown[][]): Promise<LoadedSurvey> {
  const result = await loadSurvey(await makeXlsx(rawRows), await makeXlsx(questionRows));
  if (!result.ok) throw new Error(result.errors.join(' / '));
  return result.survey;
}
const options = (n: number) => Array.from({ length: n }, (_, i) => [null, `${i + 1}. 보기${i + 1}`]);

// ---------- 예시 파일 ----------
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const survey = loaded.survey;
const base = analyzeSurvey(survey);
const card = (a: Analysis, no: number) => a.questions.find((q) => q.question.no === no);

// ---------- 문항 열 중에 사번·부서·이름처럼 보이는 열이 있는 작은 파일 ----------
// 문항 1: 객관식 / 2: 사번 / 3: 부서 / 4: 이름 / 9: 문항 파일에 없는 열
const ids = ['10001', '10002', '123456', '10004'];
const depts = ['기획처', '영업부', '기획처', '재무실'];
const names = ['김하늘', '이서준', '박지우', '최민서'];
const questionRows = [[1, '만족하십니까?'], ...options(2), [2, '사번을 입력해주세요.'], [3, '소속 부서를 입력해주세요.'], [4, '성함을 입력해주세요.']];
const rawRows = [
  header(qh(1), qh(2), qh(3), qh(4), qh(9)),
  ...ids.map((id, i) => person(String(i % 2 + 1), id, depts[i], names[i], `2026-11-0${i + 1} 10:00`)),
];
const mixed = await load(questionRows, rawRows);
const mixedBase = analyzeSurvey(mixed);
const byReason = (a: Analysis, reason: string) => a.restorable.find((r) => r.reason === reason);

describe('작업 18 · 빠진 열 목록 (restorable)', () => {
  it('예시 파일: 문항 파일에 없는 문항번호21 열 하나만 목록에 있고, 목록은 뺀 열 표시(excluded)와 같은 순서다', () => {
    expect(base.restorable.map((r) => [r.key, r.label, r.reason])).toEqual([['col:21', '21', 'not-in-questions']]);
    expect(base.restorable.map((r) => r.label)).toEqual(base.excluded.map((e) => String(e.no)));
  });

  it('값이 사번·부서·이름처럼 보이는 문항 열은 각각 이유와 함께 목록에 있다 (문항 파일에 질문이 있어도)', () => {
    expect(mixedBase.restorable.map((r) => [r.key, r.reason])).toEqual([
      ['col:2', 'id-number'],
      ['col:3', 'department'],
      ['col:4', 'name'],
      ['col:9', 'not-in-questions'],
    ]);
    expect(mixedBase.questions.map((q) => q.question.no)).toEqual([1]);
  });

  it('사번·이름 열은 경고가 필요하고, 부서·질문 없는 시간 열은 필요 없다', () => {
    expect(byReason(mixedBase, 'id-number')?.needsWarning).toBe(true);
    expect(byReason(mixedBase, 'name')?.needsWarning).toBe(true);
    expect(byReason(mixedBase, 'department')?.needsWarning).toBe(false);
    expect(byReason(mixedBase, 'not-in-questions')?.needsWarning).toBe(false);
  });

  it('응답 값은 목록에 담지 않고, 응답이 있는 칸 수만 담는다', () => {
    for (const r of [...base.restorable, ...mixedBase.restorable]) {
      expect(Object.keys(r).sort()).toEqual(['answerCount', 'key', 'label', 'needsWarning', 'reason']);
      expect(r.answerCount).toBeGreaterThan(0);
    }
  });

  it('되돌리기를 하지 않으면 이전 분석과 같다 (빈 목록 / 없는 키 / 이미 문항인 열의 키는 무시)', () => {
    expect(analyzeSurvey(survey, {}, [])).toEqual(base);
    expect(analyzeSurvey(survey, {}, ['col:1', 'hdr:99', 'col:9999', '아무 글'])).toEqual(base);
    expect(base.questions.every((q) => q.restoredKey === null)).toBe(true);
  });
});

describe('작업 18 · 질문이 있는 열 되돌리기 (사번·부서·이름처럼 보이는 문항 열)', () => {
  for (const reason of ['id-number', 'department', 'name'] as const) {
    it(`${reason} 열을 되돌리면 그 질문의 문항 카드가 되고, 열은 목록에서 빠진다 (다시 빠지지 않는다)`, () => {
      const target = byReason(mixedBase, reason)!;
      const no = Number(target.label);
      const after = analyzeSurvey(mixed, {}, [target.key]);
      const restored = card(after, no)!;
      expect(restored).toBeDefined();
      expect(restored.restoredKey).toBe(target.key);
      expect(restored.question.title).toBe(mixed.questions.find((q) => q.no === no)!.title);
      expect(after.questions).toHaveLength(mixedBase.questions.length + 1);
      expect(after.restorable.map((r) => r.key)).not.toContain(target.key);
      expect(after.excluded.map((e) => String(e.no))).not.toContain(target.label);
      expect(after.removed.map((r) => r.column.no)).not.toContain(no);
      for (const q of mixedBase.questions) expect(card(after, q.question.no)).toEqual(q); // 다른 문항은 그대로
    });
  }

  it('되돌린 이름 열은 주관식·서술형으로 모든 응답이 집계된다', () => {
    const target = byReason(mixedBase, 'name')!;
    const restored = card(analyzeSurvey(mixed, {}, [target.key]), Number(target.label))!;
    expect(restored.outcome.type).toBe('text');
    if (restored.outcome.type !== 'text') return;
    expect(restored.outcome.result.answers).toEqual(names);
  });

  it('여러 열을 함께 되돌려도 각자 반영되고, 문항 번호 순으로 놓인다', () => {
    const keys = mixedBase.restorable.filter((r) => r.reason !== 'not-in-questions').map((r) => r.key);
    const after = analyzeSurvey(mixed, {}, keys);
    expect(after.questions).toHaveLength(mixedBase.questions.length + keys.length);
    const nos = after.questions.map((q) => q.question.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
  });
});

describe('작업 18 · 질문이 없는 열 되돌리기 — 열 제목을 질문으로 쓰는 주관식·서술형으로만', () => {
  it('문항 파일에 없는 번호의 열: "N번 열"이 질문, 보기 없음, 주관식·서술형, 객관식으로 바꿀 수 없다', () => {
    const target = byReason(base, 'not-in-questions')!;
    const no = Number(target.label);
    const after = analyzeSurvey(survey, {}, [target.key]);
    const restored = card(after, no)!;
    expect(restored.question.title).toBe(`${no}번 열`);
    expect(restored.question.options).toEqual([]);
    expect(restored.outcome.type).toBe('text');
    expect(restored.inference.reason).toBe('restored-column');
    expect(canUseType(restored.question, 'choice')).toBe(false);
    const forced = card(analyzeSurvey(survey, { [no]: 'choice' }, [target.key]), no)!;
    expect(forced.outcome.type).toBe('text');
    expect(forced.userType).toBeNull();
  });

  // H열부터 열 제목이 "문항번호N"이 아닌 열이 있는 작은 파일
  const smallQuestions = [1, 2, 3, 4].flatMap((n) => [[n, `질문 ${n}`], [null, '1. 예'], [null, '2. 아니오']]);
  const smallRaw = [
    header(qh(1), qh(2), qh(3), qh(4), '제출 일시', '', qh(1)),
    person('1', '2', '1', '2', '2026-01-02 10:00', '메모 하나', '2'),
    person('2', '1', '1', '1', '2026-01-03 11:00', null, '1'),
    person('1', '2', null, '1', null, '메모 둘', null),
  ];

  it('열 제목이 문항번호N이 아닌 열·제목이 없는 열·중복 제목 열: 열 제목이 질문이고, 번호는 기존 번호 뒤로 이어진다', async () => {
    const small = await load(smallQuestions, smallRaw);
    const smallBase = analyzeSurvey(small);
    expect(smallBase.restorable.map((r) => [r.key, r.label, r.reason])).toEqual([
      ['hdr:0', '제출 일시', 'header-not-number'],
      ['hdr:1', '13번째 열 (제목 없음)', 'header-not-number'],
      ['hdr:2', '문항번호1 (중복)', 'header-not-number'],
    ]);

    const after = analyzeSurvey(small, {}, ['hdr:0', 'hdr:2']);
    expect(after.questions.map((q) => [q.question.no, q.question.title, q.outcome.type])).toEqual([
      [1, '질문 1', 'choice'],
      [2, '질문 2', 'choice'],
      [3, '질문 3', 'choice'],
      [4, '질문 4', 'choice'],
      [5, '제출 일시', 'text'],
      [7, '문항번호1 (중복)', 'text'],
    ]);
    expect(after.restorable.map((r) => r.key)).toEqual(['hdr:1']);
    const submitted = after.questions[4];
    expect(submitted.restoredKey).toBe('hdr:0');
    if (submitted.outcome.type !== 'text') throw new Error();
    expect(submitted.outcome.result.answers).toEqual(['2026-01-02 10:00', '2026-01-03 11:00']);
    expect(submitted.outcome.result.noAnswer).toBe(1);
  });

  it('질문 없는 열이 사번·이름처럼 보이면(값이 5~6자리 숫자 / 한글 2~5글자) 경고가 필요하다', async () => {
    const raw = [header(qh(1), qh(2), qh(3), qh(4), '사원번호', '담당자'), person('1', '1', '1', '1', '123456', '홍길동'), person('2', '2', '2', '2', '234567', '김철수')];
    const small = await load(smallQuestions, raw);
    expect(analyzeSurvey(small).restorable.map((r) => [r.label, r.needsWarning])).toEqual([['사원번호', true], ['담당자', true]]);
  });
});

describe('작업 18 · 되돌린 열과 다른 기능', () => {
  it('되돌린 열의 응답은 그때부터 AI에 보내는 내용에 들어가고, 되돌리기 전에는 들어가지 않는다', () => {
    const target = byReason(base, 'not-in-questions')!;
    const no = Number(target.label);
    expect(buildInterpretQuestions(base).map((q) => q.no)).not.toContain(no);
    const after = analyzeSurvey(survey, {}, [target.key]);
    const sent = buildInterpretQuestions(after).find((q) => q.no === no);
    expect(sent?.type).toBe('text');
    expect(sent?.title).toBe(`${no}번 열`);
    if (sent?.type !== 'text') throw new Error();
    expect(sent.views.map((v) => v.text)).toEqual(buildTextResult(survey.responses.columns.find((c) => c.no === no)!.answers).views.map((v) => v.text));
  });

  it('유형을 바꾸는 기능과 함께 써도 된다 (보기가 있는 질문의 되돌린 열은 객관식으로도 바꿀 수 있다)', () => {
    const target = byReason(mixedBase, 'id-number')!;
    const no = Number(target.label);
    expect(canUseType(mixed.questions.find((q) => q.no === no)!, 'choice')).toBe(false); // 이 질문에는 보기가 없다
    const after = analyzeSurvey(mixed, { [no]: 'text' }, [target.key]);
    expect(card(after, no)?.userType).toBe('text');
  });

  it('요약의 확인 필요 수와 문항 수는 되돌린 열 기준이다', () => {
    const keys = mixedBase.restorable.map((r) => r.key);
    const all = analyzeSurvey(mixed, {}, keys);
    expect(all.questions).toHaveLength(mixedBase.questions.length + mixedBase.restorable.length);
    expect(all.restorable).toEqual([]);
    expect(all.excluded).toEqual([]);
  });
});
