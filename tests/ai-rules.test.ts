// Design Ref: §10.1 자동 확인 9~12번 — 작업 16: AI 해석 규칙을 "예시 파일 → 브라우저가 만든 요청 → 서버 처리 → (가짜) AI → 화면용 해석"
// 전체 흐름으로 확인한다. 실제 AI는 부르지 않는다. 가짜 AI는 받은 질문 글(프롬프트)을 읽고 답하며, 받은 글을 모두 기록한다. 실행: npm test

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildInterpretQuestions, toCardState } from '../src/lib/ai/client';
import { handleInterpret } from '../src/lib/ai/handler';
import type { HandleResult } from '../src/lib/ai/handler';
import { AI_ATTEMPTS } from '../src/lib/ai/limits';
import { labelText } from '../src/lib/ai/prompt';
import { makeFakeAi } from './helpers/fake-ai';
import type { AiClient, InterpretResponse } from '../src/lib/ai/types';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const analysis = analyzeSurvey(loaded.survey);
const PASSWORD = 'rule-pass';

/** 브라우저가 만든 요청 그대로를 서버 처리 함수에 넣는다 */
async function runThroughServer(ai: AiClient, only?: number[], target: typeof analysis = analysis): Promise<HandleResult> {
  const body = JSON.stringify({ questions: buildInterpretQuestions(target, only) });
  return handleInterpret({ expectedPassword: PASSWORD, password: PASSWORD, contentLength: null, readBody: async () => body, ai });
}

const asResponse = (r: HandleResult) => r.body as InterpretResponse;
const choiceItems = analysis.questions.filter((a) => a.outcome.type === 'choice');
const textItems = analysis.questions.filter((a) => a.outcome.type === 'text');

describe('작업 16 · ⑨ AI로 보내는 내용에 응답자 정보 열이 없다 (SC-8)', () => {
  it('AI가 실제로 받은 글(시스템 규칙 + 문항별 질문) 어디에도 사번·부서·이름·문항에 없는 열의 값이 없다', async () => {
    const { ai, seen } = makeFakeAi('good');
    const result = await runThroughServer(ai);
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(analysis.questions.length); // 문항마다 한 번 (다시 묻기 없음)

    const everything = seen.map((s) => `${s.system}\n${s.prompt}`).join('\n');
    expect(everything).not.toContain('respondent');
    // 참여자 정보(B~G열: 이름·사번·부서·직급·직위·직책)와 분석에서 뺀 열(문항 파일에 없는 열)의 값
    const columns = [
      ...loaded.survey.responses.participants.map((p) => ({ label: p.role, answers: p.answers })),
      ...analysis.removed.map((r) => ({ label: r.reason, answers: r.column.answers })),
    ];
    expect(columns).toHaveLength(7);
    for (const { label, answers } of columns) {
      const values = new Set(answers.filter((a: string | null): a is string => a !== null && a.trim().length >= 3));
      expect(answers.some((a: string | null) => a !== null), `${label} 열에 확인할 값이 있어야 해요`).toBe(true); // (직급처럼 두 글자 값은 응답 글과 겹칠 수 있어 세 글자 이상만 비교한다)
      for (const value of values) expect(everything, `${label} 열의 값 "${value}"`).not.toContain(value);
    }
  });

  it('참여자 정보를 결과에 반영하기로 골라도(이름 등이 문항 카드가 되어도) AI가 받는 글에는 그 값이 없다 — 참여자 카드는 AI에 보내지 않는다', async () => {
    const withParticipants = analyzeSurvey(loaded.survey, {}, [], { includeParticipants: true });
    const { ai, seen } = makeFakeAi('good');
    const result = await runThroughServer(ai, undefined, withParticipants);
    expect(result.status).toBe(200);
    expect(seen).toHaveLength(analysis.questions.length); // 참여자 카드 6개는 요청하지 않았다
    const everything = seen.map((s) => `${s.system}\n${s.prompt}`).join('\n');
    for (const p of loaded.survey.responses.participants) {
      for (const value of new Set(p.answers.filter((a: string | null): a is string => a !== null && a.trim().length >= 3))) {
        expect(everything, `${p.role}: ${value}`).not.toContain(value);
      }
    }
  });

  it('보내는 문항은 분석에 남은 문항뿐이다 (뺀 열은 문항으로 가지 않는다)', async () => {
    const { ai, seen } = makeFakeAi('good');
    await runThroughServer(ai);
    const asked = seen.map((s) => Number(/^문항 (\d+):/.exec(s.prompt)?.[1])).sort((a, b) => a - b);
    expect(asked).toEqual(analysis.questions.map((a) => a.question.no));
  });
});

describe('작업 16 · ⑩ 새 숫자가 있으면 버리고 한 번만 다시 묻고, 두 번째도 실패하면 "해석 없음"', () => {
  it('첫 답에 새 숫자가 있어도 두 번째가 맞으면 두 번째를 쓴다 (문항마다 정확히 2번 호출, 다시 물을 때 문제가 알려진다)', async () => {
    const { ai, seen, callsByQuestion } = makeFakeAi('invent-number-once');
    const result = await runThroughServer(ai);
    expect(result.status).toBe(200);
    expect(asResponse(result).failed).toEqual([]);
    for (const item of analysis.questions) expect(callsByQuestion.get(item.question.no)).toBe(AI_ATTEMPTS);
    const retries = seen.filter((s) => s.prompt.includes('앞선 답에 문제가 있었어요'));
    expect(retries).toHaveLength(analysis.questions.length);
    // 최종 해석에는 999가 없다
    expect(JSON.stringify(asResponse(result).interpretations)).not.toContain('999');
  });

  it('두 번 다 새 숫자를 쓰면 그 문항은 해석 없음 — 모든 문항이 그러면 500, 호출은 문항마다 2번까지만', async () => {
    const { ai, callsByQuestion } = makeFakeAi('invent-number');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runThroughServer(ai);
    expect(result.status).toBe(500);
    expect((result.body as { error: { code: string } }).error.code).toBe('AI_FAILED');
    for (const item of analysis.questions) expect(callsByQuestion.get(item.question.no)).toBe(AI_ATTEMPTS);
  });

  it('객관식만 두 번 다 틀리면 200과 failed(객관식 번호들), 화면용 상태는 "실패(해석 없음)"이고 주관식은 정상', async () => {
    const good = makeFakeAi('good').ai;
    const bad = makeFakeAi('invent-number').ai;
    // 객관식 질문은 틀린 AI, 주관식 질문은 맞는 AI가 답한다
    const mixed: AiClient = { complete: (args) => (args.prompt.includes('출력 형식: {"text":') ? bad : good).complete(args) };
    const result = await runThroughServer(mixed);
    const body = asResponse(result);
    expect(result.status).toBe(200);
    expect(body.failed).toEqual(choiceItems.map((a) => a.question.no));

    for (const item of analysis.questions) {
      const state = toCardState(item, body.interpretations[String(item.question.no)], body.failed.includes(item.question.no));
      expect(state.status).toBe(item.outcome.type === 'choice' ? 'failed' : 'done');
    }
  });
});

describe('작업 16 · ⑪ 객관식 2~3문장(가장 많은 선택지와 비율 포함), 주관식·서술형 의견 3~5개', () => {
  it('규칙에 맞는 답은 모두 통과하고, 글에 쓰인 숫자는 모두 요청 데이터에 있던 숫자다', async () => {
    const result = await runThroughServer(makeFakeAi('good').ai);
    const body = asResponse(result);
    expect(body.failed).toEqual([]);

    for (const item of choiceItems) {
      if (item.outcome.type !== 'choice') continue;
      const text = body.interpretations[String(item.question.no)].text as string;
      const sentences = text.split(/(?<=[.!?。]|요)\s+/).filter(Boolean);
      expect(sentences.length, text).toBeGreaterThanOrEqual(2);
      expect(sentences.length, text).toBeLessThanOrEqual(3);

      const rows = item.outcome.result.rows;
      const top = rows.reduce((a, b) => (b.count > a.count ? b : a));
      expect(text).toContain(labelText(top.label));
      expect(text).toContain(top.percent.toFixed(1));

      const allowed = new Set(rows.flatMap((r) => [String(r.count), r.percent.toFixed(1), String(Math.round(r.percent)), ...(labelText(r.label).match(/\d+(?:\.\d+)?/g) ?? [])]));
      for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) expect(allowed.has(n), `"${n}"는 ${item.question.no}번 문항 데이터에 없는 숫자예요`).toBe(true);
    }

    for (const item of textItems) {
      if (item.outcome.type !== 'text') continue;
      const opinions = body.interpretations[String(item.question.no)].opinions ?? [];
      const views = item.outcome.result.views.length;
      if (views === 0) expect(opinions).toHaveLength(0);
      else if (views >= 3) {
        expect(opinions.length).toBeGreaterThanOrEqual(3);
        expect(opinions.length).toBeLessThanOrEqual(5);
      } else expect(opinions.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('작업 16 · ⑫ 의견별 건수 = viewIds에 묶인 서로 다른 응답자 수', () => {
  it('화면에 나오는 건수를 응답자 순번으로 따로 세어 본 값과 비교한다 (한 사람이 두 관점을 말해도 한 번)', async () => {
    const body = asResponse(await runThroughServer(makeFakeAi('good').ai));
    let checkedOpinions = 0;
    let sawSharedRespondent = false;
    for (const item of textItems) {
      if (item.outcome.type !== 'text') continue;
      const state = toCardState(item, body.interpretations[String(item.question.no)], false);
      if (state.status !== 'done') throw new Error('해석이 있어야 해요');
      const byId = new Map(item.outcome.result.views.map((v) => [v.id, v.respondent]));
      for (const opinion of state.interpretation.opinions ?? []) {
        const people = new Set(opinion.viewIds.map((id) => byId.get(id)));
        if (people.size < opinion.viewIds.length) sawSharedRespondent = true;
        expect(opinion.count).toBe(people.size);
        expect(opinion.count).toBeLessThanOrEqual(item.outcome.result.respondents - item.outcome.result.noAnswer);
        checkedOpinions++;
      }
    }
    expect(checkedOpinions).toBeGreaterThan(0);
    expect(sawSharedRespondent, '예시에 한 사람이 여러 관점을 말한 경우가 있어야 이 확인이 의미 있어요').toBe(true);
  });
});

describe('작업 16 · 화면용 상태 (toCardState)', () => {
  const item = analysis.questions[0];
  it('해석이 없거나 실패 목록에 있으면 해석 없음(실패)이고, 있을 때만 완료다', () => {
    expect(toCardState(item, undefined, false)).toEqual({ status: 'failed' });
    expect(toCardState(item, { text: '해석' }, true)).toEqual({ status: 'failed' });
    expect(toCardState(item, { text: '해석' }, false)).toEqual({ status: 'done', interpretation: { text: '해석' } });
  });
});
