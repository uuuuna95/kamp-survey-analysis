// Design Ref: §3 데이터 흐름 ①~④ — 읽은 결과에서 응답자 정보 열을 빼고, 문항 유형을 추정하고, 문항마다 집계한다.
// Plan SC: SC-2~5, SC-8 — 화면(결과 카드)이 이 결과만 보고 그린다. 화면과 분리해 두어 정답표로 자동 확인한다.
//          Must 4 — 빠진 열은 "문항으로 되돌리기"로 다시 문항이 되고, 문항 유형은 직접 바꿀 수 있다.
//
// 순서 (PRD 7번): ① 사번·부서·문항 파일에 없는 열 빼기 → ② 유형 추정 → ③ 이름 열 빼기 → ④ 집계

import { absorbsEtcOption, aggregateChoice } from './aggregate';
import { inferColumnTypes } from './infer-type';
import type { AnalyzedColumn, TypeInference } from './infer-type';
import type { LoadedSurvey } from './load';
import { looksLikeIdNumber, looksLikeName, removeInfoColumns, removeNameColumns } from './personal';
import type { RemovedColumn } from './personal';
import { buildTextResult } from './split-views';
import type { ChoiceResult, ExcludedColumn, ParticipantColumn, ParticipantRole, Question, QuestionType, TextResult, UnnumberedColumn } from './types';

/** 집단별로 나눠 볼 수 있는 참여자 정보: 부서, 직급 */
export type GroupRole = Extract<ParticipantRole, 'department' | 'rank'>;
export const GROUP_ROLES: readonly GroupRole[] = ['department', 'rank'];

/** 집단 값이 비어 있는 응답자를 묶는 이름 */
export const NO_GROUP_NAME = '(미기재)';

/** 분석 방법에 대한 사용자의 선택 (파일을 올릴 때 고른다) */
export interface AnalysisOptions {
  /** 참여자 정보(B~G열)를 분석 결과에 반영할까: 반영하면 열마다 주관식·서술형 문항 카드가 된다. AI에는 보내지 않는다. 기본은 반영하지 않음 */
  includeParticipants?: boolean;
  /** 객관식 문항을 이 참여자 정보의 집단별로 나눠서 응답 수·비율을 따로 보여 줄 종류 (기본은 없음) */
  groupBy?: readonly GroupRole[];
}

/** 객관식 문항의 집단별 결과 한 종류(부서 또는 직급) */
export interface GroupedChoice {
  role: GroupRole;
  /** 열 제목 (엑셀에 적힌 글, 예: "부서") */
  label: string;
  /** 집단마다 그 집단 응답자만으로 센 결과. 응답자가 많은 집단부터, 값이 비어 있는 집단(미기재)은 맨 뒤 */
  groups: { name: string; result: ChoiceResult }[];
}

/** 문항 하나의 집계 결과. 유형에 따라 모양이 다르다 */
export type QuestionOutcome =
  | { type: 'choice'; result: ChoiceResult; /** 집단별 결과 (고른 경우에만) */ groups?: GroupedChoice[] }
  | { type: 'text'; result: TextResult };

/** 분석에 쓰는 문항 하나: 문항 + 유형 추정 + 집계 결과 */
export interface AnalyzedQuestion {
  question: Question;
  /** 자동으로 추정한 유형 (사용자가 바꿔도 그대로 남는다) */
  inference: TypeInference;
  /** 사용자가 직접 고른 유형. 고르지 않았으면 null */
  userType: QuestionType | null;
  /** 지금 "확인 필요"인가: 자동 판단이 애매했고, 사용자가 아직 유형을 직접 고르지 않았을 때 */
  needsReview: boolean;
  /** 지금 유형으로 집계한 결과 */
  outcome: QuestionOutcome;
  /** 참여자 정보 열(이름·사번·부서·직급·직위·직책)을 문항 카드로 만든 경우 그 종류. 아니면 null. 이 카드는 AI에 보내지 않는다 */
  participant: ParticipantRole | null;
  /** 분석에서 뺐다가 "문항으로 되돌린" 열이면 그 열의 키(RestorableColumn.key). 되돌리기를 다시 취소할 때 쓴다. 아니면 null */
  restoredKey: string | null;
}

/** 사용자가 문항 번호별로 고른 유형 */
export type TypeOverrides = Readonly<Record<number, QuestionType>>;

/** 이 유형을 고를 수 있는가: 보기가 없는 문항은 객관식으로 집계할 수 없다 */
export function canUseType(question: Question, type: QuestionType): boolean {
  return type === 'text' || question.options.length > 0;
}

/**
 * 분석에서 뺀 열 하나 ("문항으로 되돌리기" 목록용).
 * key는 열을 가리키는 값이다: 제목이 숫자인 열은 "col:열번호", 제목이 숫자가 아니거나 중복인 열은 "hdr:순서".
 */
export interface RestorableColumn {
  key: string;
  /** 열 제목 (숫자인 열은 그 번호, 아니면 글) */
  label: string;
  reason: ExcludedColumn['reason'];
  /** 되돌리기 전에 경고를 확인받아야 하는가: 사번·이름으로 판단된 열, 또는 값이 사번·이름처럼 보이는 열 */
  needsWarning: boolean;
  /** 응답이 있는 칸 수 */
  answerCount: number;
}

export interface Analysis {
  /** 응답자 수 (원본의 응답자 줄 수) */
  respondents: number;
  /** 분석에 쓰는 문항 (문항 번호 순). 되돌린 열도 여기에 문항으로 들어간다 */
  questions: AnalyzedQuestion[];
  /** 분석에서 뺀 열 (사번·부서·문항 파일에 없는 번호·이름). 응답도 보관한다. 되돌린 열은 빠진다 */
  removed: RemovedColumn[];
  /** 열 제목이 숫자가 아니라서 문항과 짝지을 수 없었던 열 (응답 보관) */
  unnumbered: UnnumberedColumn[];
  /** "분석에서 뺀 열" 목록에 보여 줄 표시 (열 번호 순, 제목이 숫자가 아닌 열은 맨 뒤). 되돌린 열은 빠진다 */
  excluded: ExcludedColumn[];
  /** 지금 빠져 있는 열을 "문항으로 되돌리기"에 쓰는 모양으로 (excluded와 같은 순서) */
  restorable: RestorableColumn[];
  /** 유형 판단이 애매해서 담당자가 확인해야 하는 문항 수 */
  reviewCount: number;
}

const colKey = (no: number): string => `col:${no}`;
const countAnswers = (answers: (string | null)[]): number => answers.filter((a) => a !== null).length;

/**
 * 되돌리기 전에 경고를 확인받아야 하는가.
 * 사번·이름으로 판단해 뺀 열은 항상. 질문이 없는 열(문항 파일에 없는 번호·숫자가 아닌 열 제목)은 값이 사번·이름처럼 보일 때.
 * (부서 열은 값이 한글 몇 글자라 이름처럼 보이지만, 부서는 경고 대상이 아니다)
 */
function needsRestoreWarning(reason: ExcludedColumn['reason'], answers: (string | null)[]): boolean {
  if (reason === 'id-number' || reason === 'name') return true;
  if (reason === 'not-in-questions' || reason === 'header-not-number') return looksLikeIdNumber(answers) || looksLikeName(answers);
  return false;
}

/** 질문이 없는 열을 되돌릴 때의 문항: 열 제목을 질문으로 쓰는 주관식·서술형 (보기가 없으므로 객관식은 안 된다) */
function textColumnFor(no: number, title: string, answers: (string | null)[], reason: 'restored-column' | 'participant-column' = 'restored-column'): AnalyzedColumn {
  return {
    column: { no, answers },
    question: { no, title, options: [], endsWithTextCue: true },
    inference: { type: 'text', needsReview: false, reason, numericRatio: null },
  };
}

/**
 * 고른 참여자 정보(부서·직급)별로 객관식 문항을 나눠 센다. 집단마다 그 집단 응답자만으로 같은 규칙(DESIGN 3.3)으로 센다.
 * 그 열에 값이 하나도 없으면 그 종류는 만들지 않고, 만들 수 있는 종류가 없으면 groups 자체를 만들지 않는다.
 */
function groupedOrNothing(c: AnalyzedColumn, participants: ParticipantColumn[], groupBy: readonly GroupRole[]): { groups?: GroupedChoice[] } {
  const result: GroupedChoice[] = [];
  // 집단 표는 모두 문항 전체의 보기 줄("기타" 포함)을 그대로 쓴다. 그 집단에 없는 보기는 0건·0.0%
  // 마지막 "기타" 보기를 합칠지는 문항 전체 응답으로 정하고, 모든 집단에 똑같이 쓴다
  const absorbEtc = absorbsEtcOption(c.question, c.column.answers);
  const wholeRows = aggregateChoice(c.question, c.column.answers, absorbEtc).rows;
  const alignRows = (r: ChoiceResult): ChoiceResult => ({
    ...r,
    rows: wholeRows.map((base) => r.rows.find((x) => x.optionNo === base.optionNo) ?? { ...base, count: 0, percent: 0 }),
  });
  for (const role of GROUP_ROLES) {
    if (!groupBy.includes(role)) continue;
    const column = participants.find((p) => p.role === role);
    if (!column || column.answers.every((v) => v === null)) continue;
    const members = new Map<string, (string | null)[]>();
    c.column.answers.forEach((answer, i) => {
      const name = column.answers[i] ?? NO_GROUP_NAME;
      (members.get(name) ?? members.set(name, []).get(name)!).push(answer);
    });
    const groups = [...members.entries()]
      .map(([name, answers]) => ({ name, result: alignRows(aggregateChoice(c.question, answers, absorbEtc)) }))
      .sort((x, y) => {
        if (x.name === NO_GROUP_NAME || y.name === NO_GROUP_NAME) return x.name === NO_GROUP_NAME ? 1 : -1;
        return y.result.respondents - x.result.respondents || x.name.localeCompare(y.name, 'ko');
      });
    result.push({ role, label: column.header, groups });
  }
  return result.length > 0 ? { groups: result } : {};
}

/** 빠진 열 후보 하나: 목록에 보여 줄 표시 + 되돌릴 때 쓸 문항 */
interface Candidate {
  excluded: ExcludedColumn;
  key: string;
  answers: (string | null)[];
  removed: RemovedColumn | null;
  /** 이 열을 되돌리면 만들어지는 문항 (열 번호·열 제목 기준) */
  asQuestion: () => AnalyzedColumn;
}

/**
 * 읽은 결과를 분석한다.
 * @param overrides 사용자가 문항 카드에서 고른 유형 (작업 17)
 * @param restoredKeys 사용자가 "문항으로 되돌리기"를 한 열의 키 (작업 18). 키는 RestorableColumn.key. 빠져 있지 않은 열의 키는 무시한다
 * @param options 참여자 정보 반영·집단별 집계 선택 (파일을 올릴 때 고른다)
 */
export function analyzeSurvey(
  survey: LoadedSurvey,
  overrides: TypeOverrides = {},
  restoredKeys: readonly string[] = [],
  options: AnalysisOptions = {},
): Analysis {
  const { questions, responses } = survey;
  const restore = new Set(restoredKeys);

  // ① ~ ③: 되돌리기 없이 먼저 빼 본다. 여기서 빠진 열들이 "되돌릴 수 있는 열 후보"다
  const firstPass = removeInfoColumns(responses.columns, questions);
  const typed = inferColumnTypes(firstPass.kept, questions);
  const namePass = removeNameColumns(typed);
  const typedByNo = new Map(typed.map((t) => [t.column.no, t]));
  const maxNo = Math.max(0, ...questions.map((q) => q.no), ...responses.columns.map((c) => c.no));

  const candidates: Candidate[] = [];
  for (const r of firstPass.removed) {
    candidates.push({
      excluded: { no: r.column.no, reason: r.reason },
      key: colKey(r.column.no),
      answers: r.column.answers,
      removed: r,
      asQuestion: () =>
        r.reason === 'not-in-questions'
          ? textColumnFor(r.column.no, `${r.column.no}번 열`, r.column.answers) // 질문이 없다: 열 번호를 질문으로, 주관식만
          : (inferColumnTypes([r.column], questions)[0] as AnalyzedColumn), // 질문이 있다: 보통 열처럼 유형을 추정
    });
  }
  for (const r of namePass.removed) {
    candidates.push({
      excluded: { no: r.column.no, reason: 'name' },
      key: colKey(r.column.no),
      answers: r.column.answers,
      removed: r,
      asQuestion: () => typedByNo.get(r.column.no) as AnalyzedColumn, // 이름으로 보기 전에 이미 유형을 추정해 두었다
    });
  }
  candidates.sort((a, b) => Number(a.excluded.no) - Number(b.excluded.no));
  responses.unnumbered.forEach((u, i) => {
    candidates.push({
      excluded: responses.excluded[i],
      key: `hdr:${i}`,
      answers: u.answers,
      removed: null,
      // 열 제목을 질문으로 쓰는 주관식. 번호는 기존 번호와 겹치지 않게 맨 뒤에 이어서 붙인다
      asQuestion: () => textColumnFor(maxNo + 1 + i, u.header, u.answers),
    });
  });

  const isBack = (c: Candidate) => restore.has(c.key);
  const groupBy = options.groupBy ?? [];
  const toAnalyzed = (c: AnalyzedColumn, restoredKey: string | null, participant: ParticipantRole | null = null): AnalyzedQuestion => {
    // 사용자가 고른 유형이 있고 쓸 수 있으면 그것으로, 아니면 자동 추정으로 집계한다
    const picked = overrides[c.question.no];
    const userType = picked !== undefined && canUseType(c.question, picked) ? picked : null;
    const type = userType ?? c.inference.type;
    return {
      question: c.question,
      inference: c.inference,
      userType,
      needsReview: c.inference.needsReview && userType === null,
      participant,
      restoredKey,
      outcome:
        type === 'choice'
          ? {
              type: 'choice',
              result: aggregateChoice(c.question, c.column.answers),
              ...(participant === null && groupBy.length > 0 ? groupedOrNothing(c, responses.participants, groupBy) : {}),
            }
          : { type: 'text', result: buildTextResult(c.column.answers) },
    };
  };

  // 참여자 정보를 반영하기로 했으면 B~G열(응답이 하나라도 있는 열)을 열 제목이 질문인 주관식·서술형 카드로 만든다. 번호는 기존 번호 뒤에 이어 붙인다
  const participantBase = maxNo + responses.unnumbered.length;
  const participantCards = options.includeParticipants
    ? responses.participants.flatMap((p, i) =>
        p.answers.some((v) => v !== null) ? [toAnalyzed(textColumnFor(participantBase + 1 + i, p.header, p.answers, 'participant-column'), null, p.role)] : [],
      )
    : [];

  // ④ 집계: 남은 열 + 되돌린 열
  const analyzed: AnalyzedQuestion[] = [
    ...namePass.kept.map((c) => toAnalyzed(c, null)),
    ...candidates.filter(isBack).map((c) => toAnalyzed(c.asQuestion(), c.key)),
    ...participantCards,
  ].sort((a, b) => a.question.no - b.question.no);

  const stillOut = candidates.filter((c) => !isBack(c));
  return {
    respondents: responses.respondents,
    questions: analyzed,
    removed: stillOut.flatMap((c) => (c.removed ? [c.removed] : [])),
    unnumbered: responses.unnumbered,
    excluded: stillOut.map((c) => c.excluded),
    restorable: stillOut.map((c) => ({
      key: c.key,
      label: String(c.excluded.no),
      reason: c.excluded.reason,
      needsWarning: needsRestoreWarning(c.excluded.reason, c.answers),
      answerCount: countAnswers(c.answers),
    })),
    reviewCount: analyzed.filter((a) => a.needsReview).length,
  };
}
