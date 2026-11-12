// Design Ref: §10.1 자동 확인 — 작업 15: 브라우저에서 AI 요청을 만들고, 서버 응답을 화면용으로 바꾸는 규칙. 실행: npm test
// 서버나 AI를 실제로 부르지 않는다 (가짜 fetch 사용).

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildInterpretQuestions, requestInterpretations, toInterpretation, toQuestionInput } from '../src/lib/ai/client';
import { MAX_QUESTIONS, MAX_TITLE_LENGTH } from '../src/lib/ai/limits';
import type { QuestionInput } from '../src/lib/ai/types';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import type { AnalyzedQuestion } from '../src/lib/survey/analyze';
import { loadSurvey } from '../src/lib/survey/load';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const analysis = analyzeSurvey(loaded.survey);

const textItem = (): AnalyzedQuestion => {
  const item = analysis.questions.find((a) => a.outcome.type === 'text');
  if (!item) throw new Error('주관식 문항이 없어요');
  return item;
};

describe('작업 15 · AI에 보낼 내용 만들기 (buildInterpretQuestions)', () => {
  const questions = buildInterpretQuestions(analysis);

  it('분석에 남은 문항만, 문항 번호 순으로 담는다', () => {
    expect(questions.map((q) => q.no)).toEqual(analysis.questions.map((a) => a.question.no));
    expect(questions.length).toBeGreaterThan(0);
  });

  it('객관식은 보기별 이름·응답 수·비율만, 주관식·서술형은 관점 id와 글만 담는다', () => {
    for (const item of analysis.questions) {
      const sent = questions.find((q) => q.no === item.question.no) as QuestionInput;
      if (item.outcome.type === 'choice') {
        expect(sent.type).toBe('choice');
        expect(sent.type === 'choice' && sent.rows).toEqual(item.outcome.result.rows.map((r) => ({ label: r.label, count: r.count, percent: r.percent })));
      } else {
        expect(sent.type).toBe('text');
        expect(sent.type === 'text' && sent.views).toEqual(item.outcome.result.views.map((v) => ({ id: v.id, text: v.text })));
      }
    }
  });

  it('응답자 순번(respondent)과, 참여자 정보(이름·사번·부서·직급·직위·직책)·분석에서 뺀 열의 응답은 보내는 내용에 없다', () => {
    const body = JSON.stringify({ questions });
    expect(body).not.toContain('respondent');
    const participants = loaded.survey.responses.participants;
    expect(participants).toHaveLength(6);
    for (const p of participants) {
      const values = new Set(p.answers.filter((a: string | null): a is string => a !== null && a.trim().length >= 2));
      expect(values.size, p.role).toBeGreaterThan(0);
      for (const value of values) expect(body, `${p.role} 열의 값 "${value}"`).not.toContain(value);
    }
    for (const r of analysis.removed) {
      for (const value of new Set(r.column.answers.filter((a: string | null): a is string => a !== null && a.trim().length >= 3))) expect(body).not.toContain(value);
    }
  });

  it('참여자 정보를 결과에 반영하기로 해도(문항 카드가 늘어나도) AI에 보내는 내용은 그대로다 — 참여자 정보 카드는 보내지 않는다', () => {
    const withParticipants = analyzeSurvey(loaded.survey, {}, [], { includeParticipants: true });
    expect(withParticipants.questions.length).toBeGreaterThan(analysis.questions.length);
    expect(withParticipants.questions.filter((q) => q.participant !== null)).toHaveLength(6);
    expect(buildInterpretQuestions(withParticipants)).toEqual(buildInterpretQuestions(analysis));
    // 고른 문항으로 요청해도 참여자 정보 카드는 나오지 않는다
    const cardNos = withParticipants.questions.filter((q) => q.participant !== null).map((q) => q.question.no);
    expect(buildInterpretQuestions(withParticipants, cardNos)).toEqual([]);
  });

  it('고른 문항만 만들 수 있다 (다시 시도용)', () => {
    const second = analysis.questions[1].question.no;
    expect(buildInterpretQuestions(analysis, [second]).map((q) => q.no)).toEqual([second]);
    expect(buildInterpretQuestions(analysis, [9999])).toEqual([]);
  });

  it('서버 상한을 넘는 긴 질문은 잘라서 보낸다 (그래야 400으로 막히지 않는다)', () => {
    const item = analysis.questions[0];
    const long: AnalyzedQuestion = { ...item, question: { ...item.question, title: '가'.repeat(MAX_TITLE_LENGTH + 100) } };
    expect(toQuestionInput(long)?.title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it('보기 줄이 없는 객관식은 보내지 않는다', () => {
    const item = analysis.questions.find((a) => a.outcome.type === 'choice') as AnalyzedQuestion;
    if (item.outcome.type !== 'choice') throw new Error();
    const empty: AnalyzedQuestion = { ...item, outcome: { type: 'choice', result: { ...item.outcome.result, rows: [] } } };
    expect(toQuestionInput(empty)).toBeNull();
  });
});

describe('작업 15 · 받은 해석을 화면용으로 (toInterpretation)', () => {
  const item: AnalyzedQuestion = {
    ...textItem(),
    outcome: {
      type: 'text',
      result: {
        respondents: 5,
        noAnswer: 0,
        answers: [],
        // 응답자 1이 관점 둘(1, 2), 응답자 2·3이 각각 하나, 응답자 4가 하나
        views: [
          { id: 1, text: 'a', respondent: 1 },
          { id: 2, text: 'b', respondent: 1 },
          { id: 3, text: 'c', respondent: 2 },
          { id: 4, text: 'd', respondent: 3 },
          { id: 5, text: 'e', respondent: 4 },
        ],
      },
    },
  };

  it('의견별 건수는 viewIds의 서로 다른 응답자 수다 (한 사람이 두 관점을 말해도 1명)', () => {
    const r = toInterpretation(item, { opinions: [{ summary: '한 사람', viewIds: [1, 2] }, { summary: '세 사람', viewIds: [3, 4, 5] }, { summary: '두 사람', viewIds: [1, 3] }] });
    expect(r.opinions?.map((o) => [o.summary, o.count])).toEqual([['세 사람', 3], ['두 사람', 2], ['한 사람', 1]]); // 많은 순
  });

  it('건수가 같으면 AI가 준 순서를 지키고, 모르는 관점 번호는 세지 않는다', () => {
    const r = toInterpretation(item, { opinions: [{ summary: '먼저', viewIds: [3] }, { summary: '나중', viewIds: [4] }, { summary: '없는 번호', viewIds: [99] }] });
    expect(r.opinions?.map((o) => [o.summary, o.count])).toEqual([['먼저', 1], ['나중', 1], ['없는 번호', 0]]);
  });

  it('객관식 해석 글은 그대로 두고, 아무것도 없으면 빈 해석', () => {
    const choice = analysis.questions.find((a) => a.outcome.type === 'choice') as AnalyzedQuestion;
    expect(toInterpretation(choice, { text: '보통이다가 47.3%로 가장 많아요.' })).toEqual({ text: '보통이다가 47.3%로 가장 많아요.' });
    expect(toInterpretation(choice, {})).toEqual({});
  });
});

describe('작업 15 · 서버에 요청하기 (requestInterpretations, 가짜 fetch)', () => {
  const q = (no: number): QuestionInput => ({ no, type: 'choice', title: `질문 ${no}`, rows: [{ label: '1. 예', count: 1, percent: 100 }] });
  const ok = (body: unknown) => Response.json(body);

  it('비밀번호는 머리말로, 문항은 본문으로 보낸다', async () => {
    const fetchMock = vi.fn(async () => ok({ interpretations: { '1': { text: '해석' } }, failed: [] }));
    const result = await requestInterpretations([q(1)], 'pass-1', fetchMock);
    expect(result).toEqual({ ok: true, interpretations: { '1': { text: '해석' } }, failed: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/interpret');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-access-password']).toBe('pass-1');
    expect(JSON.parse(String(init.body))).toEqual({ questions: [q(1)] });
    expect(String(init.body)).not.toContain('pass-1'); // 비밀번호는 본문에 넣지 않는다
  });

  it('일부 문항만 실패하면 failed에 담긴다', async () => {
    const fetchMock = vi.fn(async () => ok({ interpretations: { '1': { text: 'a' } }, failed: [2] }));
    expect(await requestInterpretations([q(1), q(2)], 'p', fetchMock)).toEqual({ ok: true, interpretations: { '1': { text: 'a' } }, failed: [2] });
  });

  it(`문항이 ${MAX_QUESTIONS}개를 넘으면 나눠서 보내고 결과를 합친다`, async () => {
    const many = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => q(i + 1));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const nos = (JSON.parse(String(init.body)) as { questions: { no: number }[] }).questions.map((x) => x.no);
      return ok({ interpretations: Object.fromEntries(nos.map((n) => [String(n), { text: `t${n}` }])), failed: [] });
    });
    const result = await requestInterpretations(many, 'p', fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok && Object.keys(result.interpretations)).toHaveLength(MAX_QUESTIONS + 1);
  });

  it('비밀번호 오류(401)나 서버 설정 오류는 서버가 알려 준 문구를 그대로 돌려준다', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 'UNAUTHORIZED', message: '공유 비밀번호가 맞지 않아요.' } }, { status: 401 }));
    expect(await requestInterpretations([q(1)], 'x', fetchMock)).toEqual({ ok: false, message: '공유 비밀번호가 맞지 않아요.' });
  });

  it('서버에 닿지 않거나 JSON이 아닌 응답이면 알아볼 수 있는 안내를 돌려준다', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r1 = await requestInterpretations([q(1)], 'p', down);
    expect(!r1.ok && r1.message).toContain('연결하지 못했어요');
    const html = vi.fn(async () => new Response('<html>', { status: 502 }));
    const r2 = await requestInterpretations([q(1)], 'p', html);
    expect(!r2.ok && r2.message).toContain('502');
    const odd = vi.fn(async () => ok({ nothing: true }));
    const r3 = await requestInterpretations([q(1)], 'p', odd);
    expect(r3.ok).toBe(false);
  });

  it('머리말에 못 쓰는 글자(한글 등)가 들어간 비밀번호는 보내지 않고 안내한다', async () => {
    const fetchMock = vi.fn();
    const r = await requestInterpretations([q(1)], '비밀번호', fetchMock);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(!r.ok && r.message).toContain('영문');
  });
});
