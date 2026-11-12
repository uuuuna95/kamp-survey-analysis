// Design Ref: §3 ④ 집계, §3.1 비율 맞추기, §3.3 숫자를 세는 기준 — 객관식 문항 하나를 집계한다.
// Plan SC: SC-2(응답 수·비율이 정답표와 100% 일치)·SC-3(비율 합계 100.0%)
//
// 세는 기준 (DESIGN §3.3)
//   - 응답자 수 = 응답자 줄 수 (무응답인 사람도 포함)
//   - 무응답 = 빈 칸. 비율의 분모에서 뺀다
//   - 칸 전체가 숫자와 쉼표뿐이면(`1,3`) 숫자 하나하나가 선택 1건. 보기에 없는 번호는 "기타" 1건
//   - 그 밖의 칸(글, 숫자와 글이 섞인 칸)은 칸 전체가 "기타" 1건
//   - 중복응답 건수 = 선택이 2건 이상인 응답자 수
//   - 비율 = 선택지별 선택 건수 ÷ 전체 선택 건수 (기타 포함), 소수 첫째 자리

import type { ChoiceResult, Question } from './types';

const NUMBER_LIST_RE = /^\d+(,\d+)*$/;

/**
 * 건수 목록을 비율(%) 목록으로 바꾼다.
 * 소수 첫째 자리로 반올림(0.05는 올림)한 뒤 합이 100.0이 아니면, 건수가 가장 큰 항목에서 차이를 더하거나 뺀다.
 * 건수가 같으면 앞의 항목을 먼저 쓴다. 건수가 모두 0이면 비율도 모두 0이다.
 */
export function calcPercents(counts: number[]): number[] {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return counts.map(() => 0);
  // 정수로만 계산해서 소수 오차 없이 정확히 반올림한다 (퍼센트의 10배 값 = 1000 중 몇 개인지)
  const tenths = counts.map((c) => Math.floor((2 * c * 1000 + total) / (2 * total)));
  const diff = 1000 - tenths.reduce((sum, t) => sum + t, 0);
  if (diff !== 0) {
    let largest = 0;
    counts.forEach((c, i) => {
      if (c > counts[largest]) largest = i;
    });
    tenths[largest] += diff;
  }
  return tenths.map((t) => t / 10);
}

/** 객관식 문항 하나를 집계한다. answers는 응답자 순서대로의 응답이고 빈 칸은 null */
export function aggregateChoice(question: Question, answers: (string | null)[]): ChoiceResult {
  const counts = new Map<number, number>(question.options.map((o) => [o.no, 0]));
  let etc = 0;
  let noAnswer = 0;
  let multiAnswerCount = 0;

  for (const answer of answers) {
    if (answer === null) {
      noAnswer++;
    } else if (NUMBER_LIST_RE.test(answer)) {
      const picks = answer.split(',').map(Number);
      for (const no of picks) {
        const current = counts.get(no);
        if (current === undefined) etc++; // 보기에 없는 번호
        else counts.set(no, current + 1);
      }
      if (picks.length >= 2) multiAnswerCount++;
    } else {
      etc++; // 글, 숫자와 글이 섞인 칸
    }
  }

  const rows = question.options.map((o) => ({
    optionNo: o.no as number | 'etc',
    label: `${o.no}. ${o.label}`,
    count: counts.get(o.no) ?? 0,
    percent: 0,
  }));
  if (etc > 0) rows.push({ optionNo: 'etc', label: '기타', count: etc, percent: 0 });

  const percents = calcPercents(rows.map((r) => r.count));
  rows.forEach((r, i) => {
    r.percent = percents[i];
  });

  return {
    rows,
    respondents: answers.length,
    totalSelections: rows.reduce((sum, r) => sum + r.count, 0),
    multiAnswerCount,
    noAnswer,
  };
}
