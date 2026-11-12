// Design Ref: §5 지키는 것 — AI가 돌려준 해석이 규칙을 지키는지 검사한다. 어기면 한 번 다시 요청하고, 그래도 어기면 쓰지 않는다.
// Plan SC: PRD Must 2 —
//   객관식: 새 숫자 금지 / 2~3문장 / 가장 많이 고른 선택지(이름)와 그 비율을 넣는다
//   주관식·서술형: 의견 3~5개(관점이 적으면 있는 만큼) / 관점 번호는 요청에 있는 것만, 한 관점은 한 의견에만 / 요약에 새 숫자 금지

import { labelText, opinionRange } from './prompt';
import type { ChoiceQuestionInput, QuestionInterpretation, TextQuestionInput } from './types';

/** 글 속의 숫자("47.3", "12")를 모두 뽑는다 */
export function extractNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** 문장 나누기: 점·느낌표·물음표 뒤에 공백이나 끝이 올 때만 (47.3 같은 소수점은 나누지 않는다) */
export function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/[.!?。]+(?=\s|$)/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const MAX_CHOICE_TEXT_LENGTH = 600;
const MAX_SUMMARY_LENGTH = 200;

/** 객관식 해석을 검사한다. 문제가 없으면 null, 있으면 그 이유(AI에게 다시 요청할 때 알려 주는 글)를 돌려준다 */
export function checkChoiceInterpretation(q: ChoiceQuestionInput, text: unknown): string | null {
  if (typeof text !== 'string' || text.trim() === '') return 'text가 비어 있어요';
  if (text.length > MAX_CHOICE_TEXT_LENGTH) return `해석이 너무 길어요(${MAX_CHOICE_TEXT_LENGTH}자 이하)`;

  const sentences = splitSentences(text).length;
  if (sentences < 2 || sentences > 3) return `문장이 ${sentences}개예요. 2~3문장으로 써 주세요`;

  // 입력(보기 이름 속 숫자, 응답 수, 비율)에 있는 숫자만 쓸 수 있다
  const allowed = new Set<number>([
    ...q.rows.flatMap((r) => extractNumbers(r.label)),
    ...q.rows.map((r) => r.count),
    ...q.rows.map((r) => r.percent),
  ]);
  const unknown = extractNumbers(text).filter((n) => !allowed.has(n));
  if (unknown.length > 0) return `<데이터>에 없는 숫자가 있어요(${[...new Set(unknown)].join(', ')})`;

  // 가장 많이 고른 선택지(동률이면 모두 후보)의 이름과 비율이 들어가야 한다
  const top = Math.max(...q.rows.map((r) => r.count));
  if (top > 0) {
    const tops = q.rows.filter((r) => r.count === top);
    const numbers = extractNumbers(text);
    if (!tops.some((r) => numbers.includes(r.percent))) {
      return `가장 많이 고른 선택지의 비율(${tops.map((r) => `${r.percent.toFixed(1)}%`).join(' 또는 ')})이 없어요`;
    }
    if (!tops.some((r) => text.includes(labelText(r.label)))) {
      return `가장 많이 고른 선택지의 이름(${tops.map((r) => `"${labelText(r.label)}"`).join(' 또는 ')})이 없어요`;
    }
  }
  return null;
}

export type OpinionsCheck =
  | { ok: true; opinions: NonNullable<QuestionInterpretation['opinions']> }
  | { ok: false; problem: string };

/** 주관식·서술형 의견을 검사하고, 알려진 항목만 담아 정리해서 돌려준다 */
export function checkTextOpinions(q: TextQuestionInput, raw: unknown): OpinionsCheck {
  const fail = (problem: string): OpinionsCheck => ({ ok: false, problem });
  if (!Array.isArray(raw)) return fail('opinions가 목록이 아니에요');

  const { min, max } = opinionRange(q.views.length);
  if (raw.length < min || raw.length > max) {
    return fail(`의견이 ${raw.length}개예요. ${min === max ? `${max}개` : `${min}~${max}개`}로 써 주세요`);
  }

  const viewIds = new Set(q.views.map((v) => v.id));
  // 요약에는 관점 글에 이미 있는 숫자만 쓸 수 있다 (건수 같은 새 숫자 금지)
  const allowed = new Set(q.views.flatMap((v) => extractNumbers(v.text)));
  const used = new Set<number>();
  const opinions: NonNullable<QuestionInterpretation['opinions']> = [];

  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) return fail('의견의 모양이 틀려요');
    const { summary, viewIds: ids } = item as { summary?: unknown; viewIds?: unknown };
    if (typeof summary !== 'string' || summary.trim() === '') return fail('summary가 비어 있어요');
    if (summary.length > MAX_SUMMARY_LENGTH) return fail(`요약이 너무 길어요(${MAX_SUMMARY_LENGTH}자 이하)`);
    const unknownNumbers = extractNumbers(summary).filter((n) => !allowed.has(n));
    if (unknownNumbers.length > 0) return fail(`요약에 <데이터>에 없는 숫자가 있어요(${[...new Set(unknownNumbers)].join(', ')})`);
    if (!Array.isArray(ids) || ids.length === 0) return fail('viewIds가 비어 있어요');
    for (const id of ids as unknown[]) {
      if (typeof id !== 'number' || !viewIds.has(id)) return fail(`<데이터>에 없는 관점 id가 있어요(${String(id)})`);
      if (used.has(id)) return fail(`관점 id ${id}이(가) 두 의견 이상에 들어 있어요`);
      used.add(id);
    }
    opinions.push({ summary: summary.trim(), viewIds: [...(ids as number[])].sort((a, b) => a - b) });
  }
  return { ok: true, opinions };
}
