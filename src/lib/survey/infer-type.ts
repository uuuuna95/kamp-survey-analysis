// Design Ref: §3 ③ 유형 추정 — 질문 끝 문구 → 보기 번호 응답 90% 이상 → 나머지. 50~90%는 "확인 필요".
// Plan SC: Must 1(유형 추정)·Must 4("확인 필요" 표시)의 바탕. 이름 열 빼기(작업 6의 나머지)는 personal.ts의 removeNameColumns.
//
// 판단 순서
//   ① 질문 끝에 "입력해주세요"·"작성 부탁드립니다" 같은 문구가 있으면 주관식·서술형 (확인 필요 표시 없음)
//   ② 응답한 칸 중 "보기 번호"인 칸의 비율이 90% 이상이면 객관식
//   ③ 50% 이상 90% 미만이면 주관식·서술형으로 보되 "확인 필요", 50% 미만이면 표시 없이 주관식·서술형
//   ④ 응답이 하나도 없으면 보기가 있을 때 객관식, 없으면 주관식·서술형
//   (질문이 없던 열을 "문항으로 되돌린" 경우는 추정하지 않고 항상 주관식·서술형: reason = restored-column)
// "보기 번호인 칸" = 칸 전체가 숫자와 쉼표로만 되어 있고(`1,3`), 그 숫자가 모두 문항 파일의 보기 번호 안에 있는 칸.
// 빈 칸은 비율을 셀 때 뺀다.

import type { Column, Question, QuestionType } from './types';

/** 이 비율(%) 이상이 보기 번호이면 객관식 */
export const CHOICE_RATIO_PERCENT = 90;
/** 이 비율(%) 이상 CHOICE_RATIO_PERCENT 미만이면 "확인 필요" */
export const REVIEW_RATIO_PERCENT = 50;

export type InferenceReason = 'text-cue' | 'choice-ratio' | 'needs-review' | 'low-ratio' | 'no-answers' | 'restored-column' | 'participant-column';

export interface TypeInference {
  type: QuestionType;
  /** 판단이 애매해서 담당자가 확인해야 하는가 */
  needsReview: boolean;
  /** 이렇게 판단한 이유 (화면 안내·테스트용) */
  reason: InferenceReason;
  /** 응답한 칸 중 보기 번호인 칸의 비율 (0~1). 응답이 하나도 없으면 null */
  numericRatio: number | null;
}

/** 유형이 정해진 열: 응답과 문항을 함께 들고 다닌다 */
export interface AnalyzedColumn {
  column: Column;
  question: Question;
  inference: TypeInference;
}

const CHOICE_ANSWER_RE = /^\d+(,\d+)*$/;

/** 이 응답이 "보기 번호"인가: 숫자와 쉼표뿐이고, 숫자가 모두 이 문항의 보기 번호 */
export function isChoiceAnswer(answer: string, optionNos: Set<number>): boolean {
  if (!CHOICE_ANSWER_RE.test(answer)) return false;
  return answer.split(',').every((n) => optionNos.has(Number(n)));
}

/** 문항 하나의 유형을 추정한다 */
export function inferQuestionType(question: Question, answers: (string | null)[]): TypeInference {
  const given = answers.filter((a): a is string => a !== null);
  const optionNos = new Set(question.options.map((o) => o.no));
  const matched = given.filter((a) => isChoiceAnswer(a, optionNos)).length;
  const numericRatio = given.length === 0 ? null : matched / given.length;

  if (question.endsWithTextCue) return { type: 'text', needsReview: false, reason: 'text-cue', numericRatio };

  if (given.length === 0) {
    const type: QuestionType = question.options.length > 0 ? 'choice' : 'text';
    return { type, needsReview: false, reason: 'no-answers', numericRatio: null };
  }

  // 나눗셈 없이 정수로 비교해서 정확히 90%·50%인 경우도 틀리지 않게 한다
  if (matched * 100 >= given.length * CHOICE_RATIO_PERCENT) {
    return { type: 'choice', needsReview: false, reason: 'choice-ratio', numericRatio };
  }
  if (matched * 100 >= given.length * REVIEW_RATIO_PERCENT) {
    return { type: 'text', needsReview: true, reason: 'needs-review', numericRatio };
  }
  return { type: 'text', needsReview: false, reason: 'low-ratio', numericRatio };
}

/**
 * 남은 열마다 문항을 찾아 유형을 추정한다. 파일에 나온 순서를 유지한다.
 * 문항 파일에 없는 번호의 열은 먼저 removeInfoColumns로 빼야 하므로, 여기서는 건너뛴다.
 */
export function inferColumnTypes(columns: Column[], questions: Question[]): AnalyzedColumn[] {
  const byNo = new Map(questions.map((q) => [q.no, q]));
  const result: AnalyzedColumn[] = [];
  for (const column of columns) {
    const question = byNo.get(column.no);
    if (!question) continue;
    result.push({ column, question, inference: inferQuestionType(question, column.answers) });
  }
  return result;
}
