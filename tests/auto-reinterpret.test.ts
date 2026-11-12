// Design Ref: §2 ③ / PRD Must 4 — 작업 19: 유형을 바꾸거나 빠진 열을 되돌리면 "그 문항만" 해석을 다시 요청한다.
// 어느 문항을 다시 요청할지는 staleQuestionNos가 정한다. 실행: npm test

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInterpretQuestions, staleQuestionNos } from '../src/lib/ai/client';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import type { Analysis } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';
import type { QuestionType } from '../src/lib/survey/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const survey = loaded.survey;
const base = analyzeSurvey(survey);

/** 해석을 한 번 다 받은 상태: 문항 번호 → 그때의 유형 */
const knownOf = (a: Analysis): Map<number, QuestionType> => new Map(a.questions.map((q) => [q.question.no, q.outcome.type]));
const known = knownOf(base);

describe('작업 19 · 어느 문항을 다시 해석할까 (staleQuestionNos)', () => {
  it('아무것도 바꾸지 않았으면 다시 해석할 문항이 없다', () => {
    expect(staleQuestionNos(base, known)).toEqual([]);
  });

  it('처음(아직 아무것도 요청하지 않음)에는 보낼 수 있는 문항이 모두 해당된다', () => {
    expect(staleQuestionNos(base, new Map())).toEqual(base.questions.map((q) => q.question.no));
  });

  it('유형을 바꾼 문항만 해당되고, 자동 추정으로 되돌려도 그 문항만 해당된다', () => {
    const changed = analyzeSurvey(survey, { 3: 'text' });
    expect(staleQuestionNos(changed, known)).toEqual([3]);
    // 바꾼 유형으로 해석을 받은 뒤 되돌리면, 다시 원래 유형의 해석이 필요하다
    expect(staleQuestionNos(base, knownOf(changed))).toEqual([3]);
  });

  it('여러 문항을 바꾸면 바뀐 문항만 해당된다', () => {
    const changed = analyzeSurvey(survey, { 2: 'text', 5: 'text', 9: 'text' });
    expect(staleQuestionNos(changed, known)).toEqual([2, 5, 9]);
  });

  it('되돌린 열은 새 문항이라 해당되고, 이미 문항인 다른 문항은 해당되지 않는다', () => {
    const keys = base.restorable.map((r) => r.key);
    const restoredNos = base.restorable.map((r) => Number(r.label));
    const after = analyzeSurvey(survey, {}, keys);
    expect(staleQuestionNos(after, known)).toEqual(restoredNos);
  });

  it('되돌린 열을 다시 빼면 그 문항이 없어질 뿐이라 다시 해석할 문항이 없다', () => {
    const key = base.restorable[0].key;
    const withRestored = analyzeSurvey(survey, {}, [key]);
    expect(staleQuestionNos(analyzeSurvey(survey, {}, []), knownOf(withRestored))).toEqual([]);
  });

  it('이미 요청했거나 받은 문항은(실패·불러오는 중 포함) 같은 유형이면 다시 요청하지 않는다', () => {
    // known에는 상태와 상관없이 유형만 들어 있다: 실패한 문항도 사용자가 "다시 시도"를 누르기 전에는 자동으로 되풀이하지 않는다
    expect(staleQuestionNos(base, known)).toEqual([]);
  });

  it('보낼 내용이 없는 문항(보기 줄이 없는 객관식)은 해당되지 않는다', () => {
    const first = base.questions[0];
    if (first.outcome.type !== 'choice') throw new Error('첫 문항은 객관식이어야 해요');
    const empty: Analysis = { ...base, questions: [{ ...first, outcome: { type: 'choice', result: { ...first.outcome.result, rows: [] } } }] };
    expect(staleQuestionNos(empty, new Map())).toEqual([]);
  });
});

describe('작업 19 · 다시 요청하는 내용은 바뀐 문항뿐이고, 바뀐 유형이 반영된다', () => {
  it('유형을 바꿔 다시 요청하면 그 문항 하나만, 바뀐 유형의 내용으로 보낸다', () => {
    const changed = analyzeSurvey(survey, { 3: 'text' });
    const stale = staleQuestionNos(changed, known);
    const sent = buildInterpretQuestions(changed, stale);
    expect(sent.map((q) => [q.no, q.type])).toEqual([[3, 'text']]);
  });

  it('되돌린 열은 되돌린 직후에만 요청 내용에 들어간다', () => {
    const extra = base.restorable[0];
    expect(buildInterpretQuestions(base).map((q) => q.no)).not.toContain(Number(extra.label));
    const after = analyzeSurvey(survey, {}, [extra.key]);
    expect(buildInterpretQuestions(after, staleQuestionNos(after, known)).map((q) => q.no)).toEqual([Number(extra.label)]);
  });

  it('참여자 정보 카드(반영을 고른 경우)는 AI에 보내지 않으므로 다시 해석할 문항에 들어가지 않는다', () => {
    const withParticipants = analyzeSurvey(survey, {}, [], { includeParticipants: true });
    expect(withParticipants.questions.filter((q) => q.participant !== null)).toHaveLength(6);
    expect(staleQuestionNos(withParticipants, known)).toEqual([]);
  });
});
