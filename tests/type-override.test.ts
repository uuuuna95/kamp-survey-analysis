// Design Ref: §3 ③ / §2.1 — 작업 17: 문항 유형을 직접 바꾸면 그 문항의 집계가 바뀐 유형으로 다시 만들어지고,
// "확인 필요"는 직접 고르면 풀린다. 보기가 없는 문항은 객관식으로 바꿀 수 없다. 실행: npm test

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildInterpretQuestions } from '../src/lib/ai/client';
import { aggregateChoice } from '../src/lib/survey/aggregate';
import { analyzeSurvey, canUseType } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';
import { buildTextResult } from '../src/lib/survey/split-views';

async function makeXlsx(rows: unknown[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('시트');
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

// 문항 1: 보기 3개, 응답 10명 중 7명이 보기 번호 → 70% → 주관식으로 보되 "확인 필요"
// 문항 2: 응답이 모두 보기 번호 → 객관식
// 문항 3: 질문 끝에 "입력해주세요" → 주관식·서술형, 보기 없음
const questionRows = [
  [1, '서비스에 만족하십니까?'], [null, '1. 만족'], [null, '2. 보통'], [null, '3. 불만족'],
  [2, '자주 이용하십니까?'], [null, '1. 자주'], [null, '2. 가끔'],
  [3, '의견을 입력해주세요.'],
];
const q1 = ['1', '2', '3', '1', '2', '1', '3', '그냥 그래요', '좋은 편이에요', '아쉬워요'];
const q2 = ['1', '2', '1', '1', '2', '2', '1', '1', '2', '1'];
const q3 = ['빠르고 좋아요', '화면이 어려워요', '검색이 느려요', null, '좋아요. 그리고 편해요', '보통이에요', '개선 바랍니다', '특별한 의견 없음', '자료가 많아요', '디자인이 예뻐요'];
// 새 로데이터 모양: A~G열 참여자 정보 + H열부터 "문항번호N"
const rawRows = [
  ['참여일', '이름', '사번', '부서', '직급', '직위', '직책', '문항번호1', '문항번호2', '문항번호3'],
  ...q1.map((_, i) => [null, null, null, null, null, null, null, q1[i], q2[i], q3[i]]),
];

const loaded = await loadSurvey(await makeXlsx(rawRows), await makeXlsx(questionRows));
if (!loaded.ok) throw new Error(`시험용 파일을 읽지 못했어요: ${loaded.errors.join(' / ')}`);
const survey = loaded.survey;
const base = analyzeSurvey(survey);
const item = (a: typeof base, no: number) => a.questions.find((x) => x.question.no === no)!;

describe('작업 17 · 자동 추정(바꾸기 전)', () => {
  it('문항 1은 주관식·서술형 + 확인 필요, 문항 2는 객관식, 문항 3은 질문 끝 문구로 주관식·서술형', () => {
    expect(item(base, 1).outcome.type).toBe('text');
    expect(item(base, 1).needsReview).toBe(true);
    expect(item(base, 2).outcome.type).toBe('choice');
    expect(item(base, 3).outcome.type).toBe('text');
    expect(base.reviewCount).toBe(1);
    for (const a of base.questions) expect(a.userType).toBeNull();
  });

  it('유형을 고르지 않은 분석(인자 없음 / 빈 목록)은 똑같다', () => {
    expect(analyzeSurvey(survey, {})).toEqual(base);
  });
});

describe('작업 17 · 유형 바꾸기', () => {
  it('"확인 필요" 문항을 객관식으로 바꾸면 그 문항만 객관식 집계로 다시 만들어지고, 확인 필요는 풀린다', () => {
    const a = analyzeSurvey(survey, { 1: 'choice' });
    const changed = item(a, 1);
    expect(changed.userType).toBe('choice');
    expect(changed.needsReview).toBe(false);
    expect(a.reviewCount).toBe(0);
    expect(changed.outcome).toEqual({ type: 'choice', result: aggregateChoice(changed.question, q1) });
    // 보기 번호가 아닌 응답 3건은 "기타"로 센다
    if (changed.outcome.type !== 'choice') throw new Error();
    expect(changed.outcome.result.rows.find((r) => r.optionNo === 'etc')?.count).toBe(3);
    // 다른 문항은 그대로
    expect(item(a, 2)).toEqual(item(base, 2));
    expect(item(a, 3)).toEqual(item(base, 3));
  });

  it('자동 추정과 같은 유형을 직접 골라도 "확인한 것"으로 보아 확인 필요가 풀린다 (집계는 그대로)', () => {
    const a = analyzeSurvey(survey, { 1: 'text' });
    expect(item(a, 1).userType).toBe('text');
    expect(item(a, 1).needsReview).toBe(false);
    expect(item(a, 1).outcome).toEqual(item(base, 1).outcome);
    expect(a.reviewCount).toBe(0);
  });

  it('객관식을 주관식·서술형으로 바꾸면 응답 원문을 관점으로 나눠 다시 만든다', () => {
    const a = analyzeSurvey(survey, { 2: 'text' });
    expect(item(a, 2).outcome).toEqual({ type: 'text', result: buildTextResult(q2) });
    expect(item(a, 2).userType).toBe('text');
    expect(item(a, 2).inference.type).toBe('choice'); // 자동 추정은 그대로 남는다 ("자동 추정으로 되돌리기" 안내용)
  });

  it('보기가 없는 문항은 객관식으로 바꿀 수 없다 — 선택해도 무시하고 자동 추정을 그대로 쓴다', () => {
    const noOptions = item(base, 3).question;
    expect(noOptions.options).toHaveLength(0);
    expect(canUseType(noOptions, 'choice')).toBe(false);
    expect(canUseType(noOptions, 'text')).toBe(true);
    expect(canUseType(item(base, 1).question, 'choice')).toBe(true);
    const a = analyzeSurvey(survey, { 3: 'choice' });
    expect(item(a, 3).userType).toBeNull();
    expect(item(a, 3).outcome.type).toBe('text');
  });

  it('여러 문항을 함께 바꿔도 각자 반영되고, 없는 문항 번호는 무시한다', () => {
    const a = analyzeSurvey(survey, { 1: 'choice', 2: 'text', 99: 'choice' });
    expect([item(a, 1).outcome.type, item(a, 2).outcome.type, item(a, 3).outcome.type]).toEqual(['choice', 'text', 'text']);
    expect(a.questions).toHaveLength(3);
  });

  it('바뀐 유형은 AI에 보내는 내용에도 반영된다 (객관식은 집계 숫자, 주관식은 관점 글)', () => {
    const before = buildInterpretQuestions(analyzeSurvey(survey)).map((q) => [q.no, q.type]);
    expect(before).toEqual([[1, 'text'], [2, 'choice'], [3, 'text']]);
    const after = buildInterpretQuestions(analyzeSurvey(survey, { 1: 'choice', 2: 'text' })).map((q) => [q.no, q.type]);
    expect(after).toEqual([[1, 'choice'], [2, 'text'], [3, 'text']]);
  });
});
