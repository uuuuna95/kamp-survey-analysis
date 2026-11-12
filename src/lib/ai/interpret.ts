// Design Ref: §5 — 문항마다 AI에게 묻고, 규칙을 어기면 한 번 다시 묻고, 그래도 안 되면 해석 없이 실패로 돌려준다.
// 동시에 부르는 개수는 제한한다(AI_CONCURRENCY). 요청 내용은 저장하지도, 로그로 남기지도 않는다.

import { checkChoiceInterpretation, checkTextOpinions } from './check';
import { AI_ATTEMPTS, AI_CONCURRENCY } from './limits';
import { SYSTEM_PROMPT, buildChoicePrompt, buildTextPrompt } from './prompt';
import type { AiClient, ChoiceQuestionInput, QuestionInput, QuestionInterpretation, TextQuestionInput } from './types';

/** AI 답에서 JSON을 꺼낸다. 앞뒤에 설명이나 ``` 표시가 붙어 있어도 첫 { 부터 마지막 } 까지를 읽는다 */
export function extractJson(output: string): unknown {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 오류를 로그에 남길 때 쓰는 짧은 설명. 글 내용(요청·응답)은 넣지 않고 종류와 상태 번호만 적는다 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? `${error.name} ${status}` : error.name;
}

/** 보낼 데이터가 없는 문항인가 (응답이 하나도 없는 객관식, 관점이 없는 주관식·서술형) */
export function hasNothingToInterpret(q: QuestionInput): boolean {
  return q.type === 'choice' ? q.rows.every((r) => r.count === 0) : q.views.length === 0;
}

async function askChoice(ai: AiClient, q: ChoiceQuestionInput, problem?: string): Promise<{ value: QuestionInterpretation } | { problem: string }> {
  const parsed = extractJson(await ai.complete({ system: SYSTEM_PROMPT, prompt: buildChoicePrompt(q, problem) }));
  if (parsed === null || typeof parsed !== 'object') return { problem: 'JSON으로 읽을 수 없어요' };
  const text = (parsed as { text?: unknown }).text;
  const issue = checkChoiceInterpretation(q, text);
  return issue ? { problem: issue } : { value: { text: (text as string).trim() } };
}

async function askText(ai: AiClient, q: TextQuestionInput, problem?: string): Promise<{ value: QuestionInterpretation } | { problem: string }> {
  const parsed = extractJson(await ai.complete({ system: SYSTEM_PROMPT, prompt: buildTextPrompt(q, problem) }));
  if (parsed === null || typeof parsed !== 'object') return { problem: 'JSON으로 읽을 수 없어요' };
  const checked = checkTextOpinions(q, (parsed as { opinions?: unknown }).opinions);
  return checked.ok ? { value: { opinions: checked.opinions } } : { problem: checked.problem };
}

/**
 * 문항 하나의 해석을 만든다. 규칙을 어기거나 AI 호출이 실패하면 한 번 더 묻고, 끝내 안 되면 null.
 * 보낼 데이터가 없는 문항은 AI를 부르지 않고 빈 해석({})을 돌려준다.
 */
export async function interpretQuestion(
  ai: AiClient,
  q: QuestionInput,
  onError: (error: unknown) => void = () => {},
): Promise<QuestionInterpretation | null> {
  if (hasNothingToInterpret(q)) return {};
  let problem: string | undefined;
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt++) {
    try {
      const outcome = q.type === 'choice' ? await askChoice(ai, q, problem) : await askText(ai, q, problem);
      if ('value' in outcome) return outcome.value;
      problem = outcome.problem; // 다시 물을 때 무엇이 문제였는지 알려 준다
    } catch (error) {
      onError(error);
      problem = undefined;
    }
  }
  return null;
}

/** 여러 문항을 최대 AI_CONCURRENCY개씩 동시에 처리한다. 결과 순서는 문항 순서와 같다 */
export async function interpretAll(
  ai: AiClient,
  questions: QuestionInput[],
  onError?: (error: unknown) => void,
): Promise<(QuestionInterpretation | null)[]> {
  const results: (QuestionInterpretation | null)[] = new Array(questions.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < questions.length) {
      const index = next++;
      results[index] = await interpretQuestion(ai, questions[index], onError);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, questions.length) }, worker));
  return results;
}
