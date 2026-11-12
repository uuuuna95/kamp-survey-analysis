// Design Ref: §3 ④ 집계(주관식·서술형), §3.2 관점 나누기 — 한 답변 안의 서로 다른 관점을 나눈다.
// Plan SC: SC-4(응답 수가 응답자 수와 일치)·SC-5(관점 나누기)
//
// 나누는 규칙 (DESIGN §3.2) — 판단이 애매하면 나누지 않는다
//   ① '.' 뒤에서 나눈다. 숫자 사이의 점(3.5)과 주소(kamp.co.kr)처럼 뒤에 글자·공백이 이어지지 않는 점은 나누지 않는다.
//   ② '그리고', '또한' 뒤에서 나눈다. 띄어 쓴 낱말일 때만 (예: "그리고는"은 나누지 않는다).
//   ③ ','는 앞뒤가 각각 완결된 문장일 때만 나눈다. 완결된 문장 = 끝이 다·요·죠·까이고, 띄어쓰기로 나뉜 낱말이 2개 이상인 덩어리.
//      예: "빠르고, 정확해서 좋다"는 나누지 않고, "답변이 빨리 달린다, 노하우를 배울 수 있다"는 나눈다.
//      낱말이 1개뿐인 덩어리("네", "아니요")는 완결된 문장으로 보지 않는다.
// 나눈 조각에서 앞쪽의 '그리고'·'또한'과 앞뒤의 점·쉼표·공백은 지운다.

import type { TextResult } from './types';

const SEPARATOR = '\u0001';

/** 완결된 문장인가: 끝이 다·요·죠·까이고, 낱말이 2개 이상 */
export function isCompleteSentence(chunk: string): boolean {
  const text = chunk.trim().replace(/[.!?~…\s]+$/u, '');
  if (text.split(/\s+/).filter(Boolean).length < 2) return false;
  return /[다요죠까]$/u.test(text);
}

/** 조각의 앞뒤 점·쉼표·공백을 지운다 */
function clean(piece: string): string {
  return piece.replace(/^[\s,.;:]+|[\s,.;:]+$/gu, '');
}

/** 쉼표를 기준으로, 앞뒤가 모두 완결된 문장일 때만 나눈다 */
function splitByComma(piece: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < piece.length; i++) {
    if (piece[i] !== ',') continue;
    const left = piece.slice(start, i);
    const right = piece.slice(i + 1);
    if (isCompleteSentence(left) && isCompleteSentence(right)) {
      parts.push(left);
      start = i + 1;
    }
  }
  parts.push(piece.slice(start));
  return parts;
}

/** 답변 하나를 관점 여러 개로 나눈다. 비어 있거나 글자가 없는 조각은 버린다 */
export function splitViews(answer: string): string[] {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (text === '') return [];

  const marked = text
    // ① 점: 뒤에 공백·끝·한글이 올 때만 (3.5, kamp.co.kr 안의 점은 그대로 둔다)
    .replace(/\.+(?=\s|$|[가-힣])/gu, SEPARATOR)
    // ② 낱말로 따로 쓴 '그리고'·'또한' 앞에서 나누고, 낱말 자체는 지운다
    // (점 바로 뒤에 공백 없이 붙은 "좋다.그리고"도 찾도록 나눈 표시 뒤도 허용한다)
    .replace(/(^|[\s\u0001])(?:그리고|또한)(?=\s|,|$)/gu, SEPARATOR);

  const views: string[] = [];
  for (const sentence of marked.split(SEPARATOR)) {
    for (const part of splitByComma(sentence)) {
      const view = clean(part);
      if (/[가-힣A-Za-z0-9]/u.test(view)) views.push(view);
    }
  }
  return views;
}

/**
 * 주관식·서술형 문항 하나를 정리한다. answers는 응답자 순서대로의 응답이고 빈 칸은 null.
 * - respondents: 응답자 수(무응답 포함), noAnswer: 빈 칸 수, answers: 응답 원문 목록(빈 칸 제외)
 * - views: 나눈 관점. id는 1부터 차례로 붙이고, respondent는 응답자 순번(1부터, 빈 칸 줄 포함)이다.
 *   respondent는 의견별 건수를 셀 때만 쓰고 AI에는 보내지 않는다.
 */
export function buildTextResult(answers: (string | null)[]): TextResult {
  const result: TextResult = { respondents: answers.length, noAnswer: 0, answers: [], views: [] };
  answers.forEach((answer, index) => {
    if (answer === null) {
      result.noAnswer++;
      return;
    }
    result.answers.push(answer);
    for (const text of splitViews(answer)) {
      result.views.push({ id: result.views.length + 1, text, respondent: index + 1 });
    }
  });
  return result;
}
