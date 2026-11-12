// Design Ref: §3 ⑤ AI 해석 / §5 — 브라우저 쪽: 집계 결과에서 AI에 보낼 내용을 만들고, 서버(/api/interpret)를 부르고, 받은 해석에 건수를 붙인다.
// Plan SC: PRD Must 2 — 응답자 정보 열(사번·부서·이름)은 분석에서 이미 빠진 상태이고, 여기서는 "분석에 남은 문항"만 보낸다.
//          객관식은 집계 숫자만, 주관식·서술형은 나눈 관점 글만 보낸다 (응답자 순번은 보내지 않는다).
//          의견별 건수는 AI가 아니라 여기서 viewIds로 센다 (같은 응답자는 한 번만).
//
// 화면과 분리해 둔 순수한 코드라서 자동 테스트로 확인한다. 이 파일은 브라우저에서 돈다.

import type { AnalyzedQuestion, Analysis } from '../survey/analyze';
import type { Interpretation, QuestionType } from '../survey/types';
import { MAX_LABEL_LENGTH, MAX_QUESTIONS, MAX_TITLE_LENGTH, MAX_VIEW_LENGTH } from './limits';
import type { ErrorBody, InterpretResponse, QuestionInput, QuestionInterpretation } from './types';

/** 비밀번호는 HTTP 머리말로 보내서 영문·숫자·기호만 쓸 수 있다 */
const HEADER_SAFE = /^[\x20-\x7E]*$/;

/** 분석된 문항 하나를 AI 요청 모양으로. 보낼 내용이 없으면(보기 줄이 없음) null */
export function toQuestionInput({ question, outcome }: AnalyzedQuestion): QuestionInput | null {
  const title = question.title.slice(0, MAX_TITLE_LENGTH);
  if (outcome.type === 'choice') {
    const rows = outcome.result.rows.map((r) => ({ label: r.label.slice(0, MAX_LABEL_LENGTH), count: r.count, percent: r.percent }));
    return rows.length === 0 ? null : { no: question.no, type: 'choice', title, rows };
  }
  // respondent(응답자 순번)는 일부러 뺀다
  const views = outcome.result.views.map((v) => ({ id: v.id, text: v.text.slice(0, MAX_VIEW_LENGTH) }));
  return { no: question.no, type: 'text', title, views };
}

/** 분석에 남은 문항들 중 고른 문항(없으면 전부)의 AI 요청 내용. 참여자 정보 열은 보내지 않는다 */
export function buildInterpretQuestions(analysis: Analysis, only?: number[]): QuestionInput[] {
  const result: QuestionInput[] = [];
  for (const item of analysis.questions) {
    if (only && !only.includes(item.question.no)) continue;
    if (item.participant !== null) continue; // 참여자 정보 열(이름·사번 등)은 분석 결과에는 넣어도 AI에는 보내지 않는다
    const input = toQuestionInput(item);
    if (input) result.push(input);
  }
  return result;
}

/**
 * 지금 해석이 필요한데 아직 없는 문항 번호 (작업 19).
 * known은 "이미 해석을 요청했거나 받은 문항 번호 → 그때의 유형"이다. 번호가 없거나 유형이 달라졌으면(유형을 바꿈) 다시 해석할 문항이고,
 * 새로 되돌린 열도 번호가 없어서 여기에 들어온다. 보낼 내용이 없는 문항(보기 줄이 없음)은 뺀다.
 */
export function staleQuestionNos(analysis: Analysis, known: ReadonlyMap<number, QuestionType>): number[] {
  const stale = analysis.questions.filter((a) => known.get(a.question.no) !== a.outcome.type).map((a) => a.question.no);
  return buildInterpretQuestions(analysis, stale).map((q) => q.no);
}

/** AI가 돌려준 해석을 화면용으로: 의견마다 viewIds에 해당하는 서로 다른 응답자 수를 세고, 많은 순으로 정렬한다 */
export function toInterpretation(item: AnalyzedQuestion, raw: QuestionInterpretation): Interpretation {
  if (raw.text !== undefined) return { text: raw.text };
  if (!raw.opinions || item.outcome.type !== 'text') return {};
  const respondentOf = new Map(item.outcome.result.views.map((v) => [v.id, v.respondent]));
  const opinions = raw.opinions.map((o) => ({
    summary: o.summary,
    viewIds: o.viewIds,
    count: new Set(o.viewIds.flatMap((id) => (respondentOf.has(id) ? [respondentOf.get(id)] : []))).size,
  }));
  // 건수가 같으면 AI가 준 순서를 지킨다 (정렬은 안정적이다)
  opinions.sort((a, b) => b.count - a.count);
  return { opinions };
}

/** 문항 카드가 보여 줄 AI 해석 상태 */
export type CardAiState = { status: 'loading' } | { status: 'done'; interpretation: Interpretation } | { status: 'failed' };

/** 서버가 준 해석(없거나 실패 목록에 있으면 "해석 없음" = 실패)을 카드 상태로 바꾼다 */
export function toCardState(item: AnalyzedQuestion, raw: QuestionInterpretation | undefined, failed: boolean): CardAiState {
  return raw && !failed ? { status: 'done', interpretation: toInterpretation(item, raw) } : { status: 'failed' };
}

/** 화면에 있는 문항별 상태에서, 해석이 만들어진(완료) 문항의 해석만 모은다 (엑셀에 넣을 해석) */
export function doneInterpretations(items: Readonly<Record<number, CardAiState>>): Record<number, Interpretation> {
  const result: Record<number, Interpretation> = {};
  for (const [no, state] of Object.entries(items)) {
    if (state.status === 'done') result[Number(no)] = state.interpretation;
  }
  return result;
}

export type InterpretOutcome =
  | { ok: true; interpretations: Record<string, QuestionInterpretation>; failed: number[] }
  | { ok: false; message: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const NETWORK_MESSAGE = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';

/**
 * 서버에 해석을 요청한다. 문항이 많으면 한 번에 보낼 수 있는 개수(MAX_QUESTIONS)씩 나눠 보낸다.
 * 비밀번호·서버 설정 문제처럼 요청 전체가 막히면 { ok: false, message }, 일부 문항만 실패하면 failed에 담긴다.
 */
export async function requestInterpretations(
  questions: QuestionInput[],
  password: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<InterpretOutcome> {
  if (!HEADER_SAFE.test(password)) return { ok: false, message: '공유 비밀번호는 영문·숫자·기호만 입력할 수 있어요.' };

  const interpretations: Record<string, QuestionInterpretation> = {};
  const failed: number[] = [];

  for (let start = 0; start < questions.length; start += MAX_QUESTIONS) {
    const chunk = questions.slice(start, start + MAX_QUESTIONS);
    let res: Response;
    try {
      res = await fetchImpl('/api/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-access-password': password },
        body: JSON.stringify({ questions: chunk }),
      });
    } catch {
      return { ok: false, message: NETWORK_MESSAGE };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, message: res.ok ? '서버 응답을 읽지 못했어요.' : `서버에서 오류가 났어요 (${res.status}). 잠시 뒤 다시 시도해 주세요.` };
    }
    if (!res.ok) {
      const message = (body as Partial<ErrorBody>).error?.message;
      return { ok: false, message: typeof message === 'string' && message ? message : `서버에서 오류가 났어요 (${res.status}).` };
    }
    const data = body as Partial<InterpretResponse>;
    if (!data.interpretations || typeof data.interpretations !== 'object') return { ok: false, message: '서버 응답이 올바르지 않아요.' };
    Object.assign(interpretations, data.interpretations);
    if (Array.isArray(data.failed)) failed.push(...data.failed.filter((n): n is number => typeof n === 'number'));
  }
  return { ok: true, interpretations, failed };
}
