// Design Ref: §3 ② 1차 빼기 + ③ 이름 열 빼기 — 응답자 정보 열을 분석과 AI 전송에서 뺀다.
// Plan SC: SC-8 — 응답자 정보 열이 AI 전송과 결과 파일에 들어가지 않는다.
//
// 빼는 순서 (PRD 7번)
//   ① removeInfoColumns: 사번·부서·문항 파일에 없는 번호의 열을 먼저 뺀다
//   ② infer-type.ts의 inferColumnTypes: 남은 열의 문항 유형을 추정한다
//   ③ removeNameColumns: 주관식·서술형으로 추정된 열 중 이름 열을 뺀다
// 이름은 "주관식으로 추정된 열"이어야 판단할 수 있어서 ②보다 뒤에 온다.

import type { AnalyzedColumn } from './infer-type';
import type { Column, ExcludedColumn, Question } from './types';

/** 1차로 뺄 수 있는 이유 */
export type FirstPassReason = Extract<ExcludedColumn['reason'], 'id-number' | 'department' | 'not-in-questions'>;

/** 빼기로 한 열. 나중에 "문항으로 되돌리기"를 할 수 있도록 응답도 함께 보관한다 */
export interface RemovedColumn {
  column: Column;
  /** 1차 이유 또는 이름(유형 추정 뒤에 빼는 열) */
  reason: FirstPassReason | 'name';
}

export interface FirstPassResult {
  /** 분석에 계속 쓰는 열 (파일에 나온 순서 그대로) */
  kept: Column[];
  /** 뺀 열 (파일에 나온 순서 그대로) */
  removed: RemovedColumn[];
  /** 화면의 "분석에서 뺀 열" 목록에 보여 줄 표시 */
  excluded: ExcludedColumn[];
}

/** 부서 이름의 끝 글자 */
export const DEPARTMENT_SUFFIXES = ['처', '본부', '실', '부', '원'];

const ID_NUMBER_RE = /^\d{5,6}$/;
const NAME_RE = /^[가-힣]{2,5}$/;

const filled = (answers: (string | null)[]): string[] => answers.filter((a): a is string => a !== null);

/** 사번처럼 보이는가: 응답이 하나 이상 있고, 값이 모두 5~6자리 숫자 */
export function looksLikeIdNumber(answers: (string | null)[]): boolean {
  const values = filled(answers);
  return values.length > 0 && values.every((v) => ID_NUMBER_RE.test(v));
}

/** 부서처럼 보이는가: 응답이 하나 이상 있고, 모든 응답의 끝 글자가 처·본부·실·부·원 중 하나 */
export function looksLikeDepartment(answers: (string | null)[]): boolean {
  const values = filled(answers);
  return values.length > 0 && values.every((v) => DEPARTMENT_SUFFIXES.some((suffix) => v.endsWith(suffix)));
}

/** 이름처럼 보이는가: 응답이 하나 이상 있고, 값이 모두 한글 2~5글자 */
export function looksLikeName(answers: (string | null)[]): boolean {
  const values = filled(answers);
  return values.length > 0 && values.every((v) => NAME_RE.test(v));
}

/** 열 하나를 빼야 하면 이유를, 아니면 null을 돌려준다. 문항 파일에 없는 번호가 가장 먼저 걸린다 */
function firstPassReason(column: Column, questionNos: Set<number>): FirstPassReason | null {
  if (!questionNos.has(column.no)) return 'not-in-questions';
  if (looksLikeIdNumber(column.answers)) return 'id-number';
  if (looksLikeDepartment(column.answers)) return 'department';
  return null;
}

/** 원본 열에서 사번·부서·문항 파일에 없는 번호의 열을 먼저 뺀다 */
export function removeInfoColumns(columns: Column[], questions: Question[]): FirstPassResult {
  const questionNos = new Set(questions.map((q) => q.no));
  const result: FirstPassResult = { kept: [], removed: [], excluded: [] };
  for (const column of columns) {
    const reason = firstPassReason(column, questionNos);
    if (reason === null) {
      result.kept.push(column);
    } else {
      result.removed.push({ column, reason });
      result.excluded.push({ no: column.no, reason });
    }
  }
  return result;
}

export interface NamePassResult {
  /** 분석에 계속 쓰는 열 (유형이 정해진 상태, 파일 순서 그대로) */
  kept: AnalyzedColumn[];
  /** 이름으로 보고 뺀 열 (응답도 보관) */
  removed: RemovedColumn[];
  /** "분석에서 뺀 열" 목록에 보여 줄 표시 */
  excluded: ExcludedColumn[];
}

/**
 * 유형이 정해진 열 중 이름 열을 뺀다.
 * 이름은 "주관식·서술형으로 추정된 열 중 모든 응답이 한글 2~5글자인 열"이다. 객관식 열은 빼지 않는다.
 */
export function removeNameColumns(analyzed: AnalyzedColumn[]): NamePassResult {
  const result: NamePassResult = { kept: [], removed: [], excluded: [] };
  for (const item of analyzed) {
    if (item.inference.type === 'text' && looksLikeName(item.column.answers)) {
      result.removed.push({ column: item.column, reason: 'name' });
      result.excluded.push({ no: item.column.no, reason: 'name' });
    } else {
      result.kept.push(item);
    }
  }
  return result;
}
