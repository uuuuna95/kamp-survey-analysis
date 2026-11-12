// Design Ref: §10.1 자동 확인 — 집계 규칙을 정답표(tests/fixtures)와 맞춰 본다. 실행: npm test
// Plan SC: SC-2(응답 수·비율 일치)·SC-3(비율 합계 100.0)·SC-4(주관식·서술형 응답 수)·SC-5(관점 나누기)·SC-8(응답자 정보 열 빼기, 일부)
// 작업 3~8에서 만들었던 임시 확인 스크립트의 내용을 옮겨 온 것이다 (옮긴 뒤 스크립트는 지웠다).
// AI 관련 확인(DESIGN §10.1의 9~12번)은 AI 부분을 만드는 작업 14~16에서 추가한다.

import { readFileSync } from 'node:fs';
import type { Scale } from 'chart.js';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { aggregateChoice, calcPercents } from '../src/lib/survey/aggregate';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import {
  BAR_COLOR,
  ETC_COLOR,
  chartAxisMax,
  chartHeight,
  choiceChartData,
  choiceChartOptions,
  truncateLabel,
  valueLabelPlugin,
} from '../src/lib/survey/chart-config';
import { inferColumnTypes, inferQuestionType, isChoiceAnswer } from '../src/lib/survey/infer-type';
import { checkFileName, loadSurvey } from '../src/lib/survey/load';
import type { LoadedSurvey } from '../src/lib/survey/load';
import { hasTextCue, parseQuestions, parseResponses, readFirstSheetRows } from '../src/lib/survey/parse';
import {
  looksLikeDepartment,
  looksLikeIdNumber,
  looksLikeName,
  removeInfoColumns,
  removeNameColumns,
} from '../src/lib/survey/personal';
import { buildTextResult, isCompleteSentence, splitViews } from '../src/lib/survey/split-views';
import type { Question } from '../src/lib/survey/types';

// ---------- 정답표 (tests/fixtures/정답표.json) ----------
interface ExpectedChoice {
  no: number;
  type: 'choice';
  multi: boolean;
  title: string;
  respondents: number;
  noAnswer: number;
  totalSelections: number;
  multiAnswerCount: number;
  etcCount: number;
  numericAnswerRatio: number;
  rows: { optionNo: number | 'etc'; label: string; count: number; percent: number }[];
}
interface ExpectedText {
  no: number;
  type: 'text';
  title: string;
  respondents: number;
  noAnswer: number;
  answerCount: number;
  totalViews: number;
  answers: { respondent: number; text: string; viewCount: number }[];
}
interface Expected {
  questions: (ExpectedChoice | ExpectedText)[];
  expectedTypes: Record<string, 'choice' | 'text'>;
  excludedColumns: { no: number; reason: string }[];
  participantColumns: { role: string; header: string; answerCount: number; answers: (string | null)[] }[];
  viewCountExamples: { text: string; viewCount: number; why: string }[];
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const expected: Expected = JSON.parse(fixture('정답표.json').toString('utf8'));
const expectedChoice = expected.questions.filter((q): q is ExpectedChoice => q.type === 'choice');
const expectedText = expected.questions.filter((q): q is ExpectedText => q.type === 'text');

// 예시 파일을 읽는 것부터 차례로 돌린 결과 (5 → 6 → 7 → 8번 작업의 순서)
const parsedQuestions = parseQuestions(await readFirstSheetRows(fixture('예시 문항.xlsx')));
const parsedResponses = parseResponses(await readFirstSheetRows(fixture('예시 원본.xlsx')));
const firstPass = removeInfoColumns(parsedResponses.columns, parsedQuestions.questions);
const analyzed = inferColumnTypes(firstPass.kept, parsedQuestions.questions);
const namePass = removeNameColumns(analyzed);
const finalColumns = namePass.kept;

// ---------- 새 로데이터 모양 도우미: A~G열 = 참여일·이름·사번·부서·직급·직위·직책, H열부터 "문항번호N" ----------
const INFO_HEADER_CELLS = ['참여일', '이름', '사번', '부서', '직급', '직위', '직책'];
const qh = (n: number) => `문항번호${n}`;
/** 열 제목 줄: 앞의 7칸은 참여자 정보 제목, 그 뒤가 문항 열 제목 */
const header = (...cols: unknown[]): unknown[] => [...INFO_HEADER_CELLS, ...cols];
/** 응답자 줄: 앞의 7칸은 비워 두고, 그 뒤가 문항 응답 */
const person = (...cells: unknown[]): unknown[] => [...Array<null>(7).fill(null), ...cells];

// ---------- 모양 만들기 도우미 ----------
const makeQuestion = (optionCount: number, endsWithTextCue = false, no = 1): Question => ({
  no,
  title: '질문',
  options: Array.from({ length: optionCount }, (_, i) => ({ no: i + 1, label: `보기${i + 1}` })),
  endsWithTextCue,
});
/** 보기 번호 matched칸 + 글 other칸 + 빈 칸 blank칸 */
const makeAnswers = (matched: number, other: number, blank = 0): (string | null)[] => [
  ...Array<string>(matched).fill('1'),
  ...Array<string>(other).fill('직접 입력한 글'),
  ...Array<null>(blank).fill(null),
];

// =====================================================================
describe('작업 3 · 문항 파일 읽기 (parse.ts)', () => {
  const { questions, warnings } = parsedQuestions;
  const byNo = new Map(questions.map((q) => [q.no, q]));

  it('예시 문항 파일에서 문항 20개를 읽고 알림이 없다', () => {
    expect(questions).toHaveLength(20);
    expect(warnings).toEqual([]);
    expect(questions.map((q) => q.no)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('질문 글이 정답표와 같다 (문항 1~20)', () => {
    for (const eq of expected.questions) expect(byNo.get(eq.no)?.title, `문항 ${eq.no}`).toBe(eq.title);
  });

  it('객관식 보기가 "번호. 내용"으로 정답표와 같다', () => {
    for (const eq of expectedChoice) {
      const got = byNo.get(eq.no)?.options.map((o) => `${o.no}. ${o.label}`);
      const want = eq.rows.filter((r) => r.optionNo !== 'etc').map((r) => r.label);
      expect(got, `문항 ${eq.no}`).toEqual(want);
    }
  });

  it('주관식·서술형 문항(17~20)에는 보기가 없다', () => {
    for (let no = 17; no <= 20; no++) expect(byNo.get(no)?.options, `문항 ${no}`).toEqual([]);
  });

  it('질문 끝 문구가 있는 문항이 기대 유형 text와 일치한다', () => {
    for (const [no, type] of Object.entries(expected.expectedTypes)) {
      expect(byNo.get(Number(no))?.endsWithTextCue, `문항 ${no}`).toBe(type === 'text');
    }
  });

  it('머리글은 건너뛰고, 문항 번호는 "Q3"·"문항 4"·"5."도 읽는다', () => {
    const r = parseQuestions([
      ['문항 번호', '내용'],
      ['Q3', '만족하십니까?'],
      [null, '1. 예'],
      ['문항 4', '의견을 입력해주세요.'],
      ['5.', '이용 빈도는?'],
      [null, '1. 매일'],
    ]);
    expect(r.questions.map((q) => q.no)).toEqual([3, 4, 5]);
    expect(r.warnings).toEqual([]);
  });

  it('보기 번호 표기 "1)", "2.그렇다", "3 보통이다"를 읽는다', () => {
    const r = parseQuestions([[1, '질문'], [null, '1) 매우 그렇다'], [null, '2.그렇다'], [null, '3 보통이다']]);
    expect(r.questions[0].options).toEqual([
      { no: 1, label: '매우 그렇다' },
      { no: 2, label: '그렇다' },
      { no: 3, label: '보통이다' },
    ]);
  });

  it('서식 있는 글·수식 칸도 글로 읽는다', () => {
    const r = parseQuestions([
      [1, { richText: [{ text: '질문 ' }, { text: '내용' }] }],
      [null, { formula: 'x', result: '1. 예' }],
    ]);
    expect(r.questions[0].title).toBe('질문 내용');
    expect(r.questions[0].options).toEqual([{ no: 1, label: '예' }]);
  });

  it('여러 줄로 적힌 질문은 한 질문으로 이어 붙인다', () => {
    const r = parseQuestions([[1, '다음 중'], [null, '해당하는 것을 입력해주세요.']]);
    expect(r.questions[0].title).toBe('다음 중 해당하는 것을 입력해주세요.');
    expect(r.questions[0].endsWithTextCue).toBe(true);
  });

  it('번호 없는 글("10년 이상")을 보기로 착각하지 않고 알려 준다', () => {
    const r = parseQuestions([[1, '근속은?'], [null, '1. 1년 미만'], [null, '10년 이상']]);
    expect(r.questions[0].options).toEqual([{ no: 1, label: '1년 미만' }]);
    expect(r.warnings).toHaveLength(1);
  });

  it('문항 번호가 중복되면 먼저 나온 것만 쓰고 알려 준다', () => {
    const r = parseQuestions([[1, '첫째'], [null, '1. 가'], [1, '둘째'], [null, '1. 나']]);
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].title).toBe('첫째');
    expect(r.questions[0].options).toEqual([{ no: 1, label: '가' }]);
    expect(r.warnings).toHaveLength(1);
    expect(r.duplicateCount).toBe(1);
  });

  it('내용이 없으면 문항 0개', () => {
    expect(parseQuestions([]).questions).toEqual([]);
    expect(parseQuestions([[null, null], ['제목', null]]).questions).toEqual([]);
  });

  it('질문 끝 문구 판단', () => {
    expect(hasTextCue('의견을 입력해주세요.')).toBe(true);
    expect(hasTextCue('의견을 입력해 주세요')).toBe(true);
    expect(hasTextCue('의견을 작성 부탁드립니다. ')).toBe(true);
    expect(hasTextCue('(의견을 입력해주세요)')).toBe(true);
    expect(hasTextCue('입력해주세요라고 안내받으셨습니까?')).toBe(false);
    expect(hasTextCue('만족하십니까?')).toBe(false);
    expect(hasTextCue('')).toBe(false);
  });
});

// =====================================================================
describe('작업 4 · 엑셀 원본 읽기 (parse.ts)', () => {
  const { columns, unnumbered, excluded, respondents, warnings } = parsedResponses;
  const col = (no: number) => columns.find((c) => c.no === no);

  it('응답자 40명, 문항 열 21개(문항번호1~21), 제목이 "문항번호N" 모양이 아닌 열 없음', () => {
    expect(respondents).toBe(40);
    expect(columns.map((c) => c.no)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(unnumbered).toEqual([]);
    expect(excluded).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('모든 열의 응답 칸 수가 응답자 수와 같고, 응답은 글 또는 null이다 (숫자 칸도 글로 바뀐다)', () => {
    for (const c of columns) {
      expect(c.answers, `열 ${c.no}`).toHaveLength(40);
      for (const a of c.answers) expect(a === null || typeof a === 'string', `열 ${c.no}`).toBe(true);
    }
  });

  it('무응답(null) 수가 정답표와 같다 — 빈 칸과 공백만 있는 칸 모두', () => {
    for (const q of expected.questions) {
      expect(col(q.no)?.answers.filter((a) => a === null).length, `문항 ${q.no}`).toBe(q.noAnswer);
    }
  });

  it('객관식: 숫자·쉼표 응답과 기타(글) 수가 정답표와 같다', () => {
    for (const q of expectedChoice) {
      const answers = (col(q.no)?.answers ?? []).filter((a): a is string => a !== null);
      const numeric = answers.filter((a) => /^\d+(,\d+)*$/.test(a));
      expect(answers.length - numeric.length, `문항 ${q.no} 기타`).toBe(q.etcCount);
      expect(numeric.filter((a) => a.includes(',')).length, `문항 ${q.no} 중복응답`).toBe(q.multiAnswerCount);
      const selections = numeric.reduce((s, a) => s + a.split(',').length, 0) + q.etcCount;
      expect(selections, `문항 ${q.no} 전체 선택 건수`).toBe(q.totalSelections);
    }
  });

  it('주관식·서술형: 응답 글이 정답표와 같은 순서로 들어 있다', () => {
    for (const q of expectedText) {
      for (const a of q.answers) expect(col(q.no)?.answers[a.respondent - 1], `문항 ${q.no}, ${a.respondent}번째`).toBe(a.text);
    }
  });

  it('A~G열: 참여일(A)은 쓰지 않고, B~G열은 참여자 정보 열(이름·사번·부서·직급·직위·직책)로 따로 읽어 정답표와 같다', () => {
    expect(parsedResponses.participants.map((p) => [p.role, p.header])).toEqual([
      ['name', '이름'],
      ['id', '사번'],
      ['department', '부서'],
      ['rank', '직급'],
      ['position', '직위'],
      ['duty', '직책'],
    ]);
    for (const e of expected.participantColumns) {
      const got = parsedResponses.participants.find((p) => p.role === e.role);
      expect(got?.answers, e.role).toEqual(e.answers);
    }
  });

  it('사번(숫자 칸)은 글 "10001"처럼 읽고, 직급의 빈 칸·공백 한 칸은 null이다', () => {
    const id = parsedResponses.participants.find((p) => p.role === 'id');
    expect(id?.answers.every((a) => a !== null && /^\d{5,6}$/.test(a))).toBe(true);
    const rank = parsedResponses.participants.find((p) => p.role === 'rank');
    expect(rank?.answers.filter((a) => a === null)).toHaveLength(2);
  });

  it('H열(8번째 열)부터가 문항이다 — 앞의 7칸은 열 제목이 "문항번호1" 모양이어도 문항으로 읽지 않는다', () => {
    const r = parseResponses([['문항번호1', '문항번호2', '문항번호3', '문항번호4', '문항번호5', '문항번호6', '문항번호7', qh(8)], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']]);
    expect(r.columns).toEqual([{ no: 8, answers: ['h'] }]);
    expect(r.participants.map((p) => p.answers)).toEqual([['b'], ['c'], ['d'], ['e'], ['f'], ['g']]);
  });

  it('열 제목은 "문항번호" 뒤의 숫자가 문항 번호이고, 띄어쓰기는 허용한다. 예전 모양(숫자만)·"문항 번호3"은 문항으로 읽지 않는다', () => {
    const r = parseResponses([header('문항번호 3', 5, '문항 번호4', '문항번호7'), person('a', 'b', 'c', 'd')]);
    expect(r.columns.map((c) => c.no)).toEqual([3, 7]);
    expect(r.unnumbered.map((u) => u.header)).toEqual(['5', '문항 번호4']);
  });

  it('A~G열 제목이 예상과 다르면 알려 주되 위치(A~G열)로 읽는다 / 예상과 같으면 알림이 없다', () => {
    const r = parseResponses([['날짜', '성명', '사번', '부서', '직급', '직위', '직책', qh(1)], [null, '김하늘', '10001', '기획처', '대리', '선임', '팀원', '1']]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('A열 "날짜"');
    expect(r.warnings[0]).toContain('B열 "성명"');
    expect(r.participants[0]).toEqual({ role: 'name', header: '성명', answers: ['김하늘'] });
    expect(r.columns).toEqual([{ no: 1, answers: ['1'] }]);
    expect(parseResponses([header(qh(1)), person('1')]).warnings).toEqual([]);
  });

  it('열이 7개 이하(H열이 없음)면 문항 열이 없다', () => {
    const r = parseResponses([INFO_HEADER_CELLS, ['2026-11-01', '김하늘', '10001', '기획처', '대리', '선임', '팀원']]);
    expect(r.columns).toEqual([]);
    expect(r.respondents).toBe(1);
  });

  it('제목이 "문항번호N" 모양이 아닌 열은 응답을 보관한 채 뺀 열로 알려 준다', () => {
    const r = parseResponses([header(qh(1), '비고', qh(2)), person('1', '메모 하나', '3'), person('2', '메모 둘', null)]);
    expect(r.columns.map((c) => c.no)).toEqual([1, 2]);
    expect(r.unnumbered).toEqual([{ header: '비고', answers: ['메모 하나', '메모 둘'] }]);
    expect(r.excluded).toEqual([{ no: '비고', reason: 'header-not-number' }]);
    expect(r.warnings).toHaveLength(1);
  });

  it('열 제목이 중복되면 먼저 나온 열만 문항으로 쓰고 알려 준다', () => {
    const r = parseResponses([header(qh(1), qh(1)), person('a', 'b')]);
    expect(r.columns).toEqual([{ no: 1, answers: ['a'] }]);
    expect(r.unnumbered).toEqual([{ header: '문항번호1 (중복)', answers: ['b'] }]);
    expect(r.warnings).toHaveLength(1);
  });

  it('제목이 비어 있어도 응답이 있으면 뺀 열로 보관하고, 완전히 빈 열은 건너뛴다', () => {
    const r = parseResponses([header(qh(1), null, null), person('a', 'x', null)]);
    expect(r.columns.map((c) => c.no)).toEqual([1]);
    expect(r.unnumbered).toEqual([{ header: '9번째 열 (제목 없음)', answers: ['x'] }]);
  });

  it('공백만 있는 칸은 null, 앞뒤 공백은 지우고, 날짜 칸은 사라지지 않는다', () => {
    const r = parseResponses([header(qh(1), qh(2)), person(' ', ' 1,3 '), person(new Date('2026-11-05T00:00:00Z'), '2')]);
    expect(r.columns[0].answers).toEqual([null, '2026-11-05T00:00:00.000Z']);
    expect(r.columns[1].answers).toEqual(['1,3', '2']);
  });

  it('끝에 붙은 빈 줄은 응답자가 아니고, 중간의 빈 줄은 응답자 1명으로 세며 알려 준다', () => {
    const r = parseResponses([header(qh(1)), person('a'), person(null), person('b'), person(null), person(' ')]);
    expect(r.respondents).toBe(3);
    expect(r.columns[0].answers).toEqual(['a', null, 'b']);
    expect(r.warnings).toHaveLength(1);
  });

  it('열 제목 줄 앞의 빈 줄을 건너뛴다 / 제목이 " 문항번호 2 "·"문항번호02"여도 숫자 2로 읽는다', () => {
    const r = parseResponses([[null, null], [null, null], header(' 문항번호 2 ', '문항번호02'), person('x', 'y')]);
    expect(r.columns.map((c) => c.no)).toEqual([2]);
    expect(r.unnumbered.map((c) => c.header)).toEqual(['문항번호02 (중복)']);
  });

  it('줄마다 칸 수가 달라도 모자란 칸은 무응답으로 채운다', () => {
    const r = parseResponses([header(qh(1), qh(2), qh(3)), person('a'), person('b', 'c', 'd')]);
    expect(r.columns.map((c) => c.answers)).toEqual([['a', 'b'], [null, 'c'], [null, 'd']]);
  });

  it('내용이 없으면 응답자 0명, 열 0개', () => {
    const r = parseResponses([]);
    expect(r.respondents).toBe(0);
    expect(r.columns).toEqual([]);
    expect(parseResponses([[null, null]]).columns).toEqual([]);
  });
});

// =====================================================================
describe('작업 5 · 응답자 정보 열 1차 빼기 (personal.ts)', () => {
  it('예시 파일: 문항 파일에 없는 문항번호21 열만 뺀다 (사번·부서·이름은 A~G열이라 문항 열에 없다)', () => {
    expect(firstPass.excluded).toEqual([{ no: 21, reason: 'not-in-questions' }]);
    expect(firstPass.kept.map((c) => c.no)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('뺀 열이 정답표의 "빠져야 하는 열"과 같고, 설문 문항 1~20은 하나도 빠지지 않는다', () => {
    expect(firstPass.excluded).toEqual(expected.excludedColumns);
    for (let no = 1; no <= 20; no++) expect(firstPass.kept.some((c) => c.no === no), `문항 ${no}`).toBe(true);
  });

  it('뺀 열은 응답을 그대로 보관하고(되돌리기용), 남은 열과 합치면 원본 열 전체이며 순서가 유지된다', () => {
    const removed = new Map(firstPass.removed.map((r) => [r.column.no, r.column]));
    expect(removed.size).toBe(1);
    expect(removed.get(21)?.answers).toEqual(parsedResponses.columns.find((c) => c.no === 21)?.answers);
    const all = [...firstPass.kept, ...firstPass.removed.map((r) => r.column)].map((c) => c.no).sort((a, b) => a - b);
    expect(all).toEqual(parsedResponses.columns.map((c) => c.no));
    const nos = firstPass.kept.map((c) => c.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
    expect(parsedResponses.columns).toHaveLength(21); // 원래 목록은 그대로
  });

  it('사번: 모두 5~6자리 숫자일 때만. 빈 칸은 무시, 응답이 없으면 아님', () => {
    expect(looksLikeIdNumber(['10001', '123456', null])).toBe(true);
    expect(looksLikeIdNumber(['01234'])).toBe(true);
    expect(looksLikeIdNumber(['1234'])).toBe(false); // 4자리
    expect(looksLikeIdNumber(['1234567'])).toBe(false); // 7자리
    expect(looksLikeIdNumber(['10001', '1000a'])).toBe(false);
    expect(looksLikeIdNumber(['12 345'])).toBe(false);
    expect(looksLikeIdNumber(['1', '2,3'])).toBe(false); // 객관식 응답
    expect(looksLikeIdNumber([null, null])).toBe(false);
    expect(looksLikeIdNumber([])).toBe(false);
  });

  it('부서: 모든 응답이 처·본부·실·부·원으로 끝날 때만. 하나라도 다르면 아님', () => {
    expect(looksLikeDepartment(['기획처', '경영지원실', '디지털혁신본부', '영업부', '연구원', null])).toBe(true);
    expect(looksLikeDepartment(['기획처', '인사팀'])).toBe(false);
    expect(looksLikeDepartment(['본부'])).toBe(true);
    expect(looksLikeDepartment(['1', '2,3'])).toBe(false);
    expect(looksLikeDepartment(['좋다', '없음'])).toBe(false);
    expect(looksLikeDepartment([null])).toBe(false);
    expect(looksLikeDepartment([])).toBe(false);
  });

  it('문항 파일에 없는 번호는 내용과 상관없이 먼저 걸린다 (사번처럼 보여도 not-in-questions)', () => {
    const r = removeInfoColumns([{ no: 9, answers: ['10001', '10002'] }], [makeQuestion(1)]);
    expect(r.excluded).toEqual([{ no: 9, reason: 'not-in-questions' }]);
  });

  it('객관식·주관식·중복응답 열은 빼지 않는다', () => {
    const cols = [
      { no: 1, answers: ['1', '3', null, '2,4'] },
      { no: 2, answers: ['검색이 빨라서 좋다.', null, '특별히 없습니다.'] },
      { no: 3, answers: ['회의록', '인사 규정집', '1'] },
      { no: 4, answers: [null, null] },
    ];
    const r = removeInfoColumns(cols, [1, 2, 3, 4].map((no) => makeQuestion(1, false, no)));
    expect(r.removed).toEqual([]);
    expect(r.kept).toHaveLength(4);
  });

  it('사번과 부서가 섞여 있으면 각각 맞는 이유로 뺀다 / 빈 입력이면 아무것도 빼지 않는다', () => {
    const cols = [
      { no: 1, answers: ['1'] },
      { no: 2, answers: ['10001', '10002'] },
      { no: 3, answers: ['기획처', '영업부'] },
    ];
    const r = removeInfoColumns(cols, [1, 2, 3].map((no) => makeQuestion(1, false, no)));
    expect(r.excluded).toEqual([
      { no: 2, reason: 'id-number' },
      { no: 3, reason: 'department' },
    ]);
    expect(removeInfoColumns([], [])).toEqual({ kept: [], removed: [], excluded: [] });
  });
});

// =====================================================================
describe('작업 6 · 문항 유형 추정과 이름 열 빼기 (infer-type.ts, personal.ts)', () => {
  it('문항 유형이 정답표의 기대 유형과 같다 (문항 1~20): 객관식 16개·주관식·서술형 4개', () => {
    expect(analyzed).toHaveLength(20);
    for (const a of analyzed) expect(a.inference.type, `문항 ${a.column.no}`).toBe(expected.expectedTypes[String(a.column.no)]);
    expect(analyzed.filter((a) => a.inference.type === 'choice')).toHaveLength(16);
    expect(analyzed.filter((a) => a.inference.type === 'text')).toHaveLength(4);
  });

  it('질문 끝 문구로 정해진 문항(17~20)의 이유는 text-cue이고 확인 필요가 없다', () => {
    for (const a of analyzed.filter((x) => x.column.no >= 17)) {
      expect(a.inference.reason, `문항 ${a.column.no}`).toBe('text-cue');
      expect(a.inference.needsReview).toBe(false);
    }
  });

  it('객관식의 보기 번호 응답 비율이 정답표와 같다 (기타가 섞인 5·9·12번 포함)', () => {
    for (const q of expectedChoice) {
      const a = analyzed.find((x) => x.column.no === q.no);
      expect(Math.round((a?.inference.numericRatio ?? 0) * 1000) / 1000, `문항 ${q.no}`).toBe(q.numericAnswerRatio);
      expect(a?.inference.reason).toBe('choice-ratio');
      expect(a?.inference.needsReview).toBe(false);
    }
  });

  it('예시 파일의 문항 열 중에는 이름 열이 없어서 문항 1~20이 모두 남고, 1차+이름으로 뺀 열 전체가 정답표와 같다', () => {
    expect(namePass.excluded).toEqual([]);
    expect(finalColumns.map((a) => a.column.no)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const all = [...firstPass.excluded, ...namePass.excluded].sort((a, b) => Number(a.no) - Number(b.no));
    expect(all).toEqual(expected.excludedColumns);
    for (const a of finalColumns) expect(a.inference.type).toBe(expected.expectedTypes[String(a.column.no)]);
  });

  it('90%: 정확히 90%(9/10)는 객관식, 80%는 주관식·서술형 + 확인 필요', () => {
    const r90 = inferQuestionType(makeQuestion(5), makeAnswers(9, 1));
    expect([r90.type, r90.needsReview, r90.reason]).toEqual(['choice', false, 'choice-ratio']);
    const r80 = inferQuestionType(makeQuestion(5), makeAnswers(8, 2));
    expect([r80.type, r80.needsReview, r80.reason]).toEqual(['text', true, 'needs-review']);
  });

  it('50%: 정확히 50%(5/10)는 확인 필요, 40%는 표시 없는 주관식·서술형', () => {
    const r50 = inferQuestionType(makeQuestion(5), makeAnswers(5, 5));
    expect([r50.type, r50.needsReview]).toEqual(['text', true]);
    const r40 = inferQuestionType(makeQuestion(5), makeAnswers(4, 6));
    expect([r40.type, r40.needsReview, r40.reason]).toEqual(['text', false, 'low-ratio']);
  });

  it('90% 판단은 나눗셈 오차 없이 정확하다 (45/50, 27/30, 18/20)', () => {
    for (const [m, o] of [[45, 5], [27, 3], [18, 2]]) expect(inferQuestionType(makeQuestion(5), makeAnswers(m, o)).type).toBe('choice');
    expect(inferQuestionType(makeQuestion(5), makeAnswers(44, 6)).needsReview).toBe(true);
  });

  it('빈 칸은 비율을 셀 때 뺀다 (보기 번호 9칸 + 글 1칸 + 빈 칸 30칸 = 90%)', () => {
    const r = inferQuestionType(makeQuestion(5), makeAnswers(9, 1, 30));
    expect(r.type).toBe('choice');
    expect(r.numericRatio).toBe(0.9);
  });

  it('질문 끝 문구가 있으면 응답이 모두 숫자여도 주관식·서술형, 확인 필요 없음', () => {
    const r = inferQuestionType(makeQuestion(5, true), makeAnswers(10, 0));
    expect([r.type, r.needsReview, r.reason]).toEqual(['text', false, 'text-cue']);
  });

  it('중복응답 "1,3"은 보기 번호 한 칸으로 센다 / 보기에 없는 숫자가 있으면 아니다', () => {
    const opts = new Set([1, 2, 3]);
    expect(isChoiceAnswer('1,3', opts)).toBe(true);
    expect(isChoiceAnswer('2', opts)).toBe(true);
    expect(isChoiceAnswer('1,9', opts)).toBe(false);
    expect(isChoiceAnswer('7', opts)).toBe(false);
    expect(isChoiceAnswer('1, 3', opts)).toBe(false);
    expect(isChoiceAnswer('1,', opts)).toBe(false);
    expect(isChoiceAnswer('보통', opts)).toBe(false);
    expect(inferQuestionType(makeQuestion(3), ['1,3', '2', '1,2,3', '3']).type).toBe('choice');
    expect(inferQuestionType(makeQuestion(3), ['7', '8', '9', '1']).type).toBe('text');
  });

  it('보기가 없는 문항은 응답이 숫자여도 주관식·서술형 (객관식이 될 수 없다)', () => {
    const r = inferQuestionType(makeQuestion(0), makeAnswers(10, 0));
    expect([r.type, r.reason]).toEqual(['text', 'low-ratio']);
  });

  it('응답이 하나도 없으면 보기가 있을 때 객관식, 없으면 주관식·서술형 (문구가 먼저)', () => {
    const withOptions = inferQuestionType(makeQuestion(5), [null, null]);
    expect([withOptions.type, withOptions.reason, withOptions.numericRatio]).toEqual(['choice', 'no-answers', null]);
    expect(inferQuestionType(makeQuestion(0), []).type).toBe('text');
    expect(inferQuestionType(makeQuestion(5, true), [null]).type).toBe('text');
  });

  it('문항 파일에 없는 번호의 열은 유형을 추정하지 않고 건너뛴다', () => {
    const r = inferColumnTypes([{ no: 99, answers: ['1'] }, { no: 1, answers: ['1'] }], [makeQuestion(3)]);
    expect(r.map((a) => a.column.no)).toEqual([1]);
  });

  it('이름: 모두 한글 2~5글자일 때만. 6글자·숫자·공백·영문이 섞이면 아님, 빈 칸은 무시', () => {
    expect(looksLikeName(['김하늘', '남궁민수', '이솔', null])).toBe(true);
    expect(looksLikeName(['황보라온'])).toBe(true);
    expect(looksLikeName(['김하늘', '독고다이어트'])).toBe(false); // 6글자
    expect(looksLikeName(['김하늘', '김 하늘'])).toBe(false);
    expect(looksLikeName(['김하늘', 'Kim'])).toBe(false);
    expect(looksLikeName(['김하늘', '3'])).toBe(false);
    expect(looksLikeName([null, null])).toBe(false);
    expect(looksLikeName([])).toBe(false);
  });

  it('객관식 열은 이름 판단 대상이 아니다 (주관식·서술형으로 추정된 열만)', () => {
    const cols = inferColumnTypes(
      [
        { no: 1, answers: ['김하늘', '이서준'] }, // 보기 번호가 아니고 문구도 없음 → 주관식·서술형
        { no: 2, answers: ['1', '2'] }, // 객관식
      ],
      [makeQuestion(3), makeQuestion(3, false, 2)],
    );
    const r = removeNameColumns(cols);
    expect(r.excluded).toEqual([{ no: 1, reason: 'name' }]);
    expect(r.kept.map((a) => a.column.no)).toEqual([2]);
  });

  it('알려진 한계: 짧은 한글 두세 글자 답("없음"·"좋음")만 있는 주관식 열도 이름으로 빠진다 (되돌리기로 복구)', () => {
    const r = removeNameColumns(inferColumnTypes([{ no: 1, answers: ['없음', '좋음', null, '보통'] }], [makeQuestion(0, true)]));
    expect(r.excluded).toEqual([{ no: 1, reason: 'name' }]);
    expect(r.removed[0].column.answers).toEqual(['없음', '좋음', null, '보통']);
  });

  it('빈 입력이면 아무것도 빼지 않는다', () => {
    expect(removeNameColumns([])).toEqual({ kept: [], removed: [], excluded: [] });
    expect(inferColumnTypes([], [])).toEqual([]);
  });
});

// =====================================================================
describe('작업 7 · 객관식 집계 (aggregate.ts)', () => {
  const results = new Map(
    finalColumns.filter((a) => a.inference.type === 'choice').map((a) => [a.column.no, aggregateChoice(a.question, a.column.answers)]),
  );

  it('집계할 객관식 문항이 16개이고 정답표와 같은 문항이다', () => {
    expect([...results.keys()]).toEqual(expectedChoice.map((q) => q.no));
  });

  it('보기별 줄(번호·내용·응답 수·비율)이 정답표와 한 줄도 다르지 않다 — 16문항 전부 (SC-2)', () => {
    for (const q of expectedChoice) expect(results.get(q.no)?.rows, `문항 ${q.no}`).toEqual(q.rows);
  });

  it('응답자 수·무응답·전체 선택 건수·중복응답 건수가 정답표와 같다 — 16문항 전부', () => {
    for (const q of expectedChoice) {
      const r = results.get(q.no);
      expect(r?.respondents, `문항 ${q.no} 응답자 수`).toBe(q.respondents);
      expect(r?.noAnswer, `문항 ${q.no} 무응답`).toBe(q.noAnswer);
      expect(r?.totalSelections, `문항 ${q.no} 전체 선택 건수`).toBe(q.totalSelections);
      expect(r?.multiAnswerCount, `문항 ${q.no} 중복응답`).toBe(q.multiAnswerCount);
    }
  });

  it('모든 문항의 비율 합계가 정확히 100.0이다 (SC-3)', () => {
    for (const [no, r] of results) {
      expect(Math.round(r.rows.reduce((s, row) => s + row.percent * 10, 0)), `문항 ${no}`).toBe(1000);
    }
  });

  it('기타 줄은 직접 입력이 있는 문항(5·9·12)에만 있다', () => {
    const withEtc = [...results].filter(([, r]) => r.rows.some((row) => row.optionNo === 'etc')).map(([no]) => no);
    expect(withEtc).toEqual([5, 9, 12]);
  });

  it('보정이 작동하는 사례: 문항 1은 합 99.9 → 33.3에서 33.4로, 문항 5는 합 100.1 → 47.4에서 47.3으로', () => {
    expect(results.get(1)?.rows[1].percent).toBe(33.4);
    expect(results.get(5)?.rows[2].percent).toBe(47.3);
  });

  it('비율: 정수 계산으로 반올림 — 1/8 = 12.5, 합이 100.1이면 가장 큰 항목에서 뺀다', () => {
    expect(calcPercents([1, 7])).toEqual([12.5, 87.5]);
    expect(calcPercents([1, 1, 1])).toEqual([33.4, 33.3, 33.3]); // 99.9 → 첫 항목에 +0.1
    expect(calcPercents([1, 1, 1, 1, 1, 1, 1])).toEqual([14.2, 14.3, 14.3, 14.3, 14.3, 14.3, 14.3]); // 100.1 → 첫 항목 -0.1
  });

  it('비율: 건수가 모두 0이면 비율도 모두 0, 한 항목뿐이면 100.0', () => {
    expect(calcPercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(calcPercents([5])).toEqual([100]);
    expect(calcPercents([0, 3, 0])).toEqual([0, 100, 0]);
    expect(calcPercents([])).toEqual([]);
  });

  it('비율: 어떤 건수 조합이든 합이 정확히 100.0이고 음수가 없다 (1~8항목, 수천 가지)', () => {
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647); // 곱셈 결과가 정확히 표현되는 범위의 간단한 난수
    for (let t = 0; t < 3000; t++) {
      const n = (next() % 8) + 1;
      const counts = Array.from({ length: n }, () => next() % 40);
      if (counts.every((c) => c === 0)) continue;
      const p = calcPercents(counts);
      expect(Math.round(p.reduce((s, x) => s + x * 10, 0)), JSON.stringify(counts)).toBe(1000);
      expect(p.every((x) => x >= 0), JSON.stringify(counts)).toBe(true);
      counts.forEach((c, i) => {
        if (c === 0) expect(p[i]).toBe(0); // 0건 항목은 0.0%
      });
    }
  });

  const countsOf = (r: ReturnType<typeof aggregateChoice>) => Object.fromEntries(r.rows.map((row) => [row.optionNo, row.count]));

  it('중복응답 "1,3"은 선택 2건이고 중복응답 건수는 2개 이상 고른 응답자 수', () => {
    const r = aggregateChoice(makeQuestion(3), ['1,3', '2', '1,2,3', '3', null]);
    expect(countsOf(r)).toEqual({ 1: 2, 2: 2, 3: 3 });
    expect([r.totalSelections, r.multiAnswerCount, r.respondents, r.noAnswer]).toEqual([7, 2, 5, 1]);
  });

  it('글은 칸 전체가 "기타" 1건, 글 안에 쉼표가 있어도 1건. 기타 글은 중복응답이 아니다', () => {
    const r = aggregateChoice(makeQuestion(3), ['1', '회의록, 규정집', '직접 입력', '1,직접 입력']);
    expect(countsOf(r)).toEqual({ 1: 1, 2: 0, 3: 0, etc: 3 });
    expect(r.multiAnswerCount).toBe(0);
  });

  it('보기에 없는 번호는 "기타"로 센다 — 단독 "9"도, "1,9"의 9도', () => {
    const r = aggregateChoice(makeQuestion(3), ['9', '1,9', '2']);
    expect(countsOf(r)).toEqual({ 1: 1, 2: 1, 3: 0, etc: 2 });
    expect([r.multiAnswerCount, r.totalSelections]).toEqual([1, 4]); // "1,9"는 선택 2건
  });

  it('쉼표 뒤 공백("1, 3")은 숫자 목록이 아니므로 기타 1건 — 정답 데이터에는 공백이 없다', () => {
    expect(countsOf(aggregateChoice(makeQuestion(3), ['1, 3']))).toEqual({ 1: 0, 2: 0, 3: 0, etc: 1 });
  });

  it('무응답은 비율의 분모에서 빠지고, 응답자 수에는 들어간다', () => {
    const r = aggregateChoice(makeQuestion(2), ['1', '2', null, null]);
    expect([r.respondents, r.noAnswer, r.totalSelections]).toEqual([4, 2, 2]);
    expect(r.rows.map((row) => row.percent)).toEqual([50, 50]);
  });

  it('기타 줄은 있을 때만 생기고, 0건 보기도 줄은 남는다 (비율 0.0)', () => {
    const r = aggregateChoice(makeQuestion(3), ['1', '1']);
    expect(r.rows.map((row) => [row.optionNo, row.count, row.percent])).toEqual([[1, 2, 100], [2, 0, 0], [3, 0, 0]]);
    expect(r.rows.some((row) => row.optionNo === 'etc')).toBe(false);
  });

  it('응답이 하나도 없으면 모든 건수·비율이 0이고, 집계가 원래 응답 목록을 바꾸지 않는다', () => {
    const r = aggregateChoice(makeQuestion(2), [null, null, null]);
    expect([r.totalSelections, r.noAnswer]).toEqual([0, 3]);
    expect(r.rows.every((row) => row.count === 0 && row.percent === 0)).toBe(true);
    expect(aggregateChoice(makeQuestion(2), []).respondents).toBe(0);
    const answers = ['1,3', null, '2'];
    aggregateChoice(makeQuestion(3), answers);
    expect(answers).toEqual(['1,3', null, '2']);
  });
});

// =====================================================================
describe('작업 8 · 주관식·서술형 정리 (split-views.ts)', () => {
  const results = new Map(
    finalColumns.filter((a) => a.inference.type === 'text').map((a) => [a.column.no, buildTextResult(a.column.answers)]),
  );

  it('정리할 주관식·서술형 문항이 4개(17~20)이고 정답표와 같다', () => {
    expect([...results.keys()]).toEqual(expectedText.map((q) => q.no));
  });

  it('응답자 수·무응답·응답 수가 정답표와 같다 (응답 수 = 응답자 수 − 무응답, SC-4)', () => {
    for (const q of expectedText) {
      const r = results.get(q.no);
      expect(r?.respondents, `문항 ${q.no}`).toBe(q.respondents);
      expect(r?.noAnswer, `문항 ${q.no}`).toBe(q.noAnswer);
      expect(r?.answers.length, `문항 ${q.no}`).toBe(q.answerCount);
      expect((r?.respondents ?? 0) - (r?.noAnswer ?? 0)).toBe(r?.answers.length);
    }
  });

  it('응답 원문 목록이 정답표와 같은 순서·같은 글이다', () => {
    for (const q of expectedText) {
      expect(results.get(q.no)?.answers, `문항 ${q.no}`).toEqual(q.answers.map((a) => a.text));
    }
  });

  it('답변마다 나눈 관점 수가 손으로 센 값과 같다 — 4문항의 모든 답변 (SC-5)', () => {
    for (const q of expectedText) {
      for (const a of q.answers) expect(splitViews(a.text).length, `문항 ${q.no}, ${a.respondent}번째: ${a.text}`).toBe(a.viewCount);
    }
  });

  it('문항별 관점 합계가 정답표와 같고, 관점마다 응답자 순번이 맞고, id가 1부터 차례로 붙는다', () => {
    for (const q of expectedText) {
      const r = results.get(q.no);
      expect(r?.views.length, `문항 ${q.no}`).toBe(q.totalViews);
      const perRespondent = new Map<number, number>();
      for (const v of r?.views ?? []) perRespondent.set(v.respondent, (perRespondent.get(v.respondent) ?? 0) + 1);
      for (const a of q.answers) expect(perRespondent.get(a.respondent), `문항 ${q.no}, ${a.respondent}번째`).toBe(a.viewCount);
      expect(perRespondent.size).toBe(q.answerCount); // 무응답 줄에는 관점이 없다
      expect(r?.views.map((v) => v.id)).toEqual(r?.views.map((_, i) => i + 1));
    }
  });

  it('정답표의 "관점 수 예시" 5개가 모두 맞다', () => {
    for (const e of expected.viewCountExamples) expect(splitViews(e.text).length, e.text).toBe(e.viewCount);
  });

  it('마침표·"그리고"·"또한" 뒤에서 나누고, 접속어와 앞뒤 점·쉼표는 지운다', () => {
    expect(splitViews('교육 자료가 한곳에 모여 있어서 좋다. 그리고 최신 공지를 바로 확인할 수 있다.')).toEqual([
      '교육 자료가 한곳에 모여 있어서 좋다',
      '최신 공지를 바로 확인할 수 있다',
    ]);
    expect(splitViews('업무 매뉴얼을 쉽게 찾을 수 있고 또한 교육 신청도 간편하다.')).toEqual([
      '업무 매뉴얼을 쉽게 찾을 수 있고',
      '교육 신청도 간편하다',
    ]);
    expect(splitViews('게시판이 정리되어 있다. 그리고 검색 필터가 다양하다. 또한 미리보기가 좋다.')).toEqual([
      '게시판이 정리되어 있다',
      '검색 필터가 다양하다',
      '미리보기가 좋다',
    ]);
  });

  it('쉼표: 앞뒤가 모두 완결된 문장일 때만 나눈다', () => {
    expect(splitViews('빠르고, 정확해서 좋다.')).toEqual(['빠르고, 정확해서 좋다']);
    expect(splitViews('질문을 올리면 답변이 빨리 달린다, 동료들의 노하우를 배울 수 있다.')).toEqual([
      '질문을 올리면 답변이 빨리 달린다',
      '동료들의 노하우를 배울 수 있다',
    ]);
    expect(splitViews('음성 검색, 번역 기능이 있으면 좋겠다.')).toEqual(['음성 검색, 번역 기능이 있으면 좋겠다']);
    expect(splitViews('메뉴 위치가 자주 바뀌어서 헷갈리고, 도움말이 부족하다.')).toEqual(['메뉴 위치가 자주 바뀌어서 헷갈리고, 도움말이 부족하다']);
  });

  it('쉼표가 여러 개여도 앞뒤가 완결될 때만 나눈다', () => {
    expect(splitViews('속도가 빠르다, 화면이 보기 좋고, 검색도 정확하다')).toEqual(['속도가 빠르다', '화면이 보기 좋고, 검색도 정확하다']);
    expect(splitViews('속도가 빠르고, 화면이 보기 좋다, 검색도 정확하다')).toEqual(['속도가 빠르고, 화면이 보기 좋다', '검색도 정확하다']);
  });

  it('낱말이 하나뿐인 덩어리는 완결된 문장으로 보지 않는다 ("네, 맞아요"·"아니요, 없어요")', () => {
    expect(splitViews('네, 맞아요')).toEqual(['네, 맞아요']);
    expect(splitViews('아니요, 없어요')).toEqual(['아니요, 없어요']);
    expect(isCompleteSentence('특별히 없습니다')).toBe(true);
    expect(isCompleteSentence('없습니다')).toBe(false);
    expect(isCompleteSentence('빠르고')).toBe(false);
    expect(isCompleteSentence('화면이 깔끔하고')).toBe(false);
    expect(isCompleteSentence('다시 해 주세요.')).toBe(true);
  });

  it('소수점(3.5)·주소(kamp.co.kr) 안의 점은 나누지 않는다', () => {
    expect(splitViews('평점은 3.5점으로 평가한다')).toEqual(['평점은 3.5점으로 평가한다']);
    expect(splitViews('kamp.co.kr에서 확인한다')).toEqual(['kamp.co.kr에서 확인한다']);
  });

  it('점 뒤에 공백이 없어도 한글이 이어지면 나눈다 / 말줄임표(...)도 한 번만 나눈다', () => {
    expect(splitViews('좋다.그리고 빠르다')).toEqual(['좋다', '빠르다']);
    expect(splitViews('글쎄... 잘 모르겠다')).toEqual(['글쎄', '잘 모르겠다']);
  });

  it('"그리고"·"또한"이 낱말의 일부이면 나누지 않는다', () => {
    expect(splitViews('그리고는 말했다')).toEqual(['그리고는 말했다']);
    expect(splitViews('또한번 해 보겠다')).toEqual(['또한번 해 보겠다']);
  });

  it('접속어만 있거나 글자가 없는 조각은 버린다 / 빈 응답은 관점 0개', () => {
    expect(splitViews('빠르다. 그리고')).toEqual(['빠르다']);
    for (const empty of ['...', '그리고', '   ', '', ', ,']) expect(splitViews(empty), `"${empty}"`).toEqual([]);
  });

  it('줄바꿈과 여러 칸 공백은 한 칸 공백으로 바꿔서 나눈다', () => {
    expect(splitViews('좋다.\n그리고  빠르다')).toEqual(['좋다', '빠르다']);
    expect(splitViews('속도가\n빠르고   정확하다')).toEqual(['속도가 빠르고 정확하다']);
  });

  it('마침표가 없는 한 문장·한 단어는 관점 1개', () => {
    expect(splitViews('다크 모드')).toEqual(['다크 모드']);
    expect(splitViews('없음')).toEqual(['없음']);
    expect(splitViews('특별히 없습니다.')).toEqual(['특별히 없습니다']);
  });

  it('빈 칸은 무응답으로 세고 관점이 없다. 응답자 순번은 빈 칸 줄도 센다', () => {
    const r = buildTextResult(['좋다. 그리고 빠르다', null, '없음', null, '편하다']);
    expect([r.respondents, r.noAnswer]).toEqual([5, 2]);
    expect(r.answers).toEqual(['좋다. 그리고 빠르다', '없음', '편하다']);
    expect(r.views).toEqual([
      { id: 1, text: '좋다', respondent: 1 },
      { id: 2, text: '빠르다', respondent: 1 },
      { id: 3, text: '없음', respondent: 3 },
      { id: 4, text: '편하다', respondent: 5 },
    ]);
  });

  it('글자 없는 응답("...")도 응답 1건으로 세지만 관점은 없다 / 응답이 없으면 모두 0이고 원래 목록을 바꾸지 않는다', () => {
    const r = buildTextResult(['...', '좋다']);
    expect(r.answers).toHaveLength(2);
    expect(r.views).toEqual([{ id: 1, text: '좋다', respondent: 2 }]);
    expect(buildTextResult([])).toEqual({ respondents: 0, noAnswer: 0, answers: [], views: [] });
    const input = ['좋다', null];
    buildTextResult(input);
    expect(input).toEqual(['좋다', null]);
  });
});

// =====================================================================
describe('작업 10 · 올린 파일 읽기와 확인 (load.ts)', () => {
  /** 줄 목록으로 작은 엑셀 파일(바이트)을 만든다 */
  const makeXlsx = async (rows: unknown[][]): Promise<Uint8Array> => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('시트');
    for (const row of rows) sheet.addRow(row);
    return new Uint8Array(await workbook.xlsx.writeBuffer());
  };
  const goodQuestions = [[1, '만족하십니까?'], [null, '1. 예'], [null, '2. 아니오'], [2, '의견을 입력해주세요.']];
  const goodRaw = [header(qh(1), qh(2)), person('1', '좋다'), person('2', null)];

  it('예시 두 파일을 읽으면 문항 20개·응답자 40명이고, 문항 파일에 없는 열 21번만 알려 준다', async () => {
    const result = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.survey.questions).toHaveLength(20);
    expect(result.survey.responses.respondents).toBe(40);
    expect(result.survey.responses.columns).toHaveLength(21);
    expect(result.survey.responses.participants).toHaveLength(6);
    expect(result.survey.notes).toEqual(['엑셀 원본에는 있지만 문항 파일에는 없는 열: 21번. 분석에서 빼요.']);
  });

  it('작은 파일도 읽는다 (정상)', async () => {
    const result = await loadSurvey(await makeXlsx(goodRaw), await makeXlsx(goodQuestions));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.survey.notes).toEqual([]);
  });

  it('엑셀이 아닌 파일이면 어느 파일인지 알려 준다 — 한쪽만, 양쪽 모두', async () => {
    const notExcel = new TextEncoder().encode('이건 엑셀 파일이 아니에요');
    const onlyQuestion = await loadSurvey(await makeXlsx(goodRaw), notExcel);
    expect(onlyQuestion.ok).toBe(false);
    if (!onlyQuestion.ok) {
      expect(onlyQuestion.errors).toHaveLength(1);
      expect(onlyQuestion.errors[0]).toContain('설문 문항 파일');
    }
    const both = await loadSurvey(notExcel, notExcel);
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.errors.map((e) => e.slice(0, 5))).toEqual(['설문 문항', '엑셀 원본']);
  });

  it('문항 파일에서 문항을 하나도 못 찾으면 분석을 막는다 (모든 열이 빠지는 일을 막는다)', async () => {
    const result = await loadSurvey(await makeXlsx(goodRaw), await makeXlsx([['제목만 있어요'], [null, null]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('문항 번호와 질문을 찾지 못했어요');
  });

  it('원본에서 응답을 못 찾으면 분석을 막는다 — 열 제목만 있거나 완전히 빈 파일', async () => {
    for (const rows of [[header(qh(1), qh(2))], []]) {
      const result = await loadSurvey(await makeXlsx(rows), await makeXlsx(goodQuestions));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('응답을 찾지 못했어요');
    }
  });

  it('두 파일의 문항과 열 번호가 하나도 겹치지 않으면 분석을 막는다', async () => {
    const result = await loadSurvey(await makeXlsx([header(qh(7), qh(8)), person('a', 'b')]), await makeXlsx(goodQuestions));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('문항 번호가 하나도 맞지 않아요');
  });

  it('한쪽에만 있는 문항·열은 알림으로 알려 주고 분석은 계속한다', async () => {
    const questions = [[1, 'a'], [2, 'b'], [3, 'c']];
    const raw = [header(qh(1), qh(3), qh(9)), person('x', 'y', 'z')];
    const result = await loadSurvey(await makeXlsx(raw), await makeXlsx(questions));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.survey.notes).toEqual([
      '문항 파일에는 있지만 엑셀 원본에는 없는 문항: 2번. 이 문항은 분석하지 않아요.',
      '엑셀 원본에는 있지만 문항 파일에는 없는 열: 9번. 분석에서 빼요.',
    ]);
  });

  it('번호가 아주 많이 빠지면 앞의 10개만 적고 나머지는 개수로 줄인다', async () => {
    const questions = Array.from({ length: 15 }, (_, i) => [i + 1, `질문${i + 1}`]);
    const result = await loadSurvey(await makeXlsx([header(qh(1)), person('a')]), await makeXlsx(questions));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.survey.notes[0]).toBe('문항 파일에는 있지만 엑셀 원본에는 없는 문항: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 외 4개. 이 문항은 분석하지 않아요.');
  });

  it('읽다가 알게 된 점(읽지 못한 줄, 제목이 "문항번호N" 모양이 아닌 열)도 어느 파일인지 붙여서 알린다', async () => {
    const questions = [[1, '질문'], [null, '1. 예'], [null, '10년 이상'], [2, '질문2']];
    const raw = [header(qh(1), qh(2), '비고'), person('1', 'a', '메모')];
    const result = await loadSurvey(await makeXlsx(raw), await makeXlsx(questions));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.survey.notes.some((n) => n.startsWith('문항 파일 3행'))).toBe(true);
    expect(result.survey.notes.some((n) => n.startsWith('엑셀 원본 10번째 열'))).toBe(true);
  });

  it('알림이 너무 많으면 앞의 5개만 보여 주고 나머지는 개수로 줄인다', async () => {
    const questions = [[1, '질문'], [null, '1. 예'], ...Array.from({ length: 8 }, (_, i) => [null, `보기가 아닌 글 ${i}`])];
    const result = await loadSurvey(await makeXlsx([header(qh(1)), person('a')]), await makeXlsx(questions));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fromQuestionFile = result.survey.notes.filter((n) => n.startsWith('문항 파일'));
    expect(fromQuestionFile).toHaveLength(6); // 5개 + "3건 더 있어요"
    expect(fromQuestionFile[5]).toBe('문항 파일에서 알림이 3건 더 있어요.');
  });

  it('두 파일을 서로 바꿔 올리면 엉터리 결과 대신 분석을 막고, 어느 파일이 이상한지 알려 준다 (예시 파일로)', async () => {
    const result = await loadSurvey(fixture('예시 문항.xlsx'), fixture('예시 원본.xlsx')); // 원본 칸에 문항 파일, 문항 칸에 원본
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('설문 문항 파일에서 문항 번호와 질문을 찾지 못했어요'))).toBe(true);
      expect(result.errors.some((e) => e.includes('엑셀 원본에서 응답을 찾지 못했어요'))).toBe(true);
    }
  });

  it('문항 파일을 두 칸에 모두 올리면 원본에서 응답(A~G열 + 문항번호 열)을 찾지 못한다고 알려 준다', async () => {
    const result = await loadSurvey(fixture('예시 문항.xlsx'), fixture('예시 문항.xlsx'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('문항번호1');
  });

  it('원본을 두 칸에 모두 올리면 문항 파일에서 문항 번호와 질문을 찾지 못한다고 알려 준다', async () => {
    const result = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 원본.xlsx'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('문항 번호와 질문을 찾지 못했어요');
  });

  it('같은 번호가 한두 번 겹치는 정도는 오류가 아니라 알림이다', async () => {
    const questions = [[1, 'a'], [1, 'a 다시'], [2, 'b']];
    const result = await loadSurvey(await makeXlsx([header(qh(1), qh(2)), person('x', 'y')]), await makeXlsx(questions));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.survey.notes.some((n) => n.includes('중복'))).toBe(true);
  });

  it('파일 이름 확인: .xlsx만 통과, 한글·예전 엑셀·그 밖의 형식은 이유를 안내한다 (대소문자·앞뒤 공백 무시)', () => {
    expect(checkFileName('원본.xlsx')).toBeNull();
    expect(checkFileName(' 원본.XLSX ')).toBeNull();
    expect(checkFileName('문항.hwp')).toContain('한글 파일');
    expect(checkFileName('문항.HWPX')).toContain('한글 파일');
    expect(checkFileName('원본.xls')).toContain('.xls');
    expect(checkFileName('원본.csv')).toBe('엑셀(.xlsx) 파일만 올릴 수 있어요.');
    expect(checkFileName('원본')).toBe('엑셀(.xlsx) 파일만 올릴 수 있어요.');
  });
});

// =====================================================================
const loadedFixture = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loadedFixture.ok) throw new Error('예시 파일을 읽지 못했어요');
const fixtureAnalysis = analyzeSurvey(loadedFixture.survey);

describe('작업 11 · 읽은 결과를 분석으로 잇기 (analyze.ts)', () => {
  const analysis = fixtureAnalysis;
  const outcomeOf = (no: number) => analysis.questions.find((a) => a.question.no === no)?.outcome;

  /** 줄 목록으로 읽은 결과를 바로 만든다 (엑셀 파일 없이) */
  const surveyOf = (questionRows: unknown[][], rawRows: unknown[][]): LoadedSurvey => ({
    questions: parseQuestions(questionRows).questions,
    responses: parseResponses(rawRows),
    notes: [],
  });

  it('예시 파일: 응답자 40명, 분석에 쓰는 문항은 1~20번 20개이고 확인 필요는 0개', () => {
    expect(analysis.respondents).toBe(40);
    expect(analysis.questions.map((a) => a.question.no)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(analysis.reviewCount).toBe(0);
    expect(analysis.unnumbered).toEqual([]);
  });

  it('문항 유형이 정답표의 기대 유형과 같고, 유형에 맞는 집계 결과가 붙는다', () => {
    for (const a of analysis.questions) {
      expect(a.inference.type, `문항 ${a.question.no}`).toBe(expected.expectedTypes[String(a.question.no)]);
      expect(a.outcome.type).toBe(a.inference.type);
    }
  });

  it('객관식 결과(보기별 응답 수·비율, 응답자 수 등)가 정답표와 한 문항도 다르지 않다', () => {
    for (const q of expectedChoice) {
      const outcome = outcomeOf(q.no);
      expect(outcome?.type).toBe('choice');
      if (outcome?.type !== 'choice') continue;
      expect(outcome.result.rows, `문항 ${q.no}`).toEqual(q.rows);
      expect([outcome.result.respondents, outcome.result.noAnswer, outcome.result.totalSelections, outcome.result.multiAnswerCount]).toEqual([
        q.respondents,
        q.noAnswer,
        q.totalSelections,
        q.multiAnswerCount,
      ]);
    }
  });

  it('주관식·서술형 결과(응답 목록·무응답·나눈 관점 수)가 정답표와 같다', () => {
    for (const q of expectedText) {
      const outcome = outcomeOf(q.no);
      expect(outcome?.type).toBe('text');
      if (outcome?.type !== 'text') continue;
      expect(outcome.result.answers, `문항 ${q.no}`).toEqual(q.answers.map((a) => a.text));
      expect(outcome.result.noAnswer).toBe(q.noAnswer);
      expect(outcome.result.views).toHaveLength(q.totalViews);
    }
  });

  it('뺀 열 목록이 정답표의 "빠져야 하는 열"(문항번호21)과 같고, 뺀 열의 응답은 보관된다', () => {
    expect(analysis.excluded).toEqual(expected.excludedColumns);
    expect(analysis.removed.map((r) => r.column.no).sort((a, b) => a - b)).toEqual([21]);
    for (const r of analysis.removed) expect(r.column.answers).toHaveLength(40);
  });

  it('참여자 정보(이름·사번·부서·직급·직위·직책) 값이 분석 결과 어디에도 남지 않는다 — 반영을 고르지 않았을 때 (SC-8)', () => {
    const everything = JSON.stringify(analysis.questions);
    const infoValues = loadedFixture.survey.responses.participants.flatMap((p) => p.answers.filter((a): a is string => a !== null && a.length >= 3));
    expect(infoValues.length).toBeGreaterThan(100);
    for (const value of infoValues) expect(everything.includes(value), value).toBe(false);
  });

  it('문항은 열이 뒤섞여 있어도 문항 번호 순서로 나온다', () => {
    const survey = surveyOf([[1, 'a'], [null, '1. 예'], [2, 'b'], [null, '1. 예'], [3, 'c'], [null, '1. 예']], [header(qh(3), qh(1), qh(2)), person('1', '1', '1')]);
    expect(analyzeSurvey(survey).questions.map((a) => a.question.no)).toEqual([1, 2, 3]);
  });

  it('유형 판단이 애매한 문항(보기 번호 응답 80%)은 주관식·서술형으로 보고 확인 필요로 센다', () => {
    const answers = [...Array(8).fill('1'), '직접 쓴 글', '또 다른 글'].map((v) => [v]);
    const survey = surveyOf([[1, '질문'], [null, '1. 예'], [null, '2. 아니오']], [header(qh(1)), ...answers.map((a) => person(...a))]);
    const result = analyzeSurvey(survey);
    expect(result.reviewCount).toBe(1);
    expect(result.questions[0].inference).toMatchObject({ type: 'text', needsReview: true, reason: 'needs-review' });
    expect(result.questions[0].outcome.type).toBe('text');
  });

  it('열 제목이 "문항번호N" 모양이 아닌 열은 분석에서 빠지고, 뺀 열 목록의 맨 뒤에 이유와 함께 나온다', () => {
    const survey = surveyOf(
      [[1, 'a'], [null, '1. 예'], [2, 'b'], [null, '1. 예'], [3, 'c'], [null, '1. 예']],
      [header(qh(1), qh(2), qh(3), '메모', qh(9)), person('1', '1', '1', '비고 글', '10001'), person('1', '1', '1', null, '10002')],
    );
    const result = analyzeSurvey(survey);
    expect(result.questions.map((a) => a.question.no)).toEqual([1, 2, 3]);
    expect(result.excluded).toEqual([
      { no: 9, reason: 'not-in-questions' },
      { no: '메모', reason: 'header-not-number' },
    ]);
    expect(result.unnumbered).toEqual([{ header: '메모', answers: ['비고 글', null] }]);
  });
});

// =====================================================================
describe('작업 12 · 객관식 차트 설정 (chart-config.ts)', () => {
  const choiceOutcome = (no: number) => {
    const outcome = fixtureAnalysis.questions.find((a) => a.question.no === no)?.outcome;
    if (outcome?.type !== 'choice') throw new Error(`문항 ${no}는 객관식이 아니에요`);
    return outcome.result;
  };

  it('차트 데이터가 표의 비율과 같다 — 객관식 16문항 전부, 막대 수는 표의 줄 수와 같다', () => {
    for (const q of expectedChoice) {
      const data = choiceChartData(choiceOutcome(q.no).rows);
      expect(data.labels, `문항 ${q.no}`).toEqual(q.rows.map((r) => r.label));
      expect(data.datasets[0].data, `문항 ${q.no}`).toEqual(q.rows.map((r) => r.percent));
    }
  });

  it('"기타" 막대는 회색, 보기 막대는 파란색이다', () => {
    const data = choiceChartData(choiceOutcome(5).rows); // 문항 5: 보기 4개 + 기타
    expect(data.datasets[0].backgroundColor).toEqual([BAR_COLOR, BAR_COLOR, BAR_COLOR, BAR_COLOR, ETC_COLOR]);
  });

  it('가로축 끝은 가장 큰 비율보다 한 칸 넉넉하고 100을 넘지 않으며, 모두 0이면 100이다', () => {
    const rows = (...percents: number[]) => percents.map((percent, i) => ({ optionNo: i + 1, label: `${i + 1}`, count: 0, percent }));
    expect(chartAxisMax(rows(47.3, 20))).toBe(60);
    expect(chartAxisMax(rows(3.2))).toBe(20);
    expect(chartAxisMax(rows(10))).toBe(20);
    expect(chartAxisMax(rows(20))).toBe(30);
    expect(chartAxisMax(rows(95.5, 4.5))).toBe(100);
    expect(chartAxisMax(rows(100))).toBe(100);
    expect(chartAxisMax(rows(0, 0))).toBe(100);
    expect(chartAxisMax([])).toBe(100);
    for (const q of expectedChoice) expect(chartAxisMax(choiceOutcome(q.no).rows), `문항 ${q.no}`).toBeGreaterThanOrEqual(Math.max(...q.rows.map((r) => r.percent)));
  });

  it('차트 높이는 보기 줄 수에 맞춘다', () => {
    expect(chartHeight(5)).toBe(236);
    expect(chartHeight(2)).toBeLessThan(chartHeight(6));
  });

  it('축 글자가 18글자를 넘으면 줄이고, 그 이하는 그대로 둔다 (한글·이모지도 글자 수로)', () => {
    expect(truncateLabel('5. 전혀 그렇지 않다')).toBe('5. 전혀 그렇지 않다');
    expect(truncateLabel('가'.repeat(18))).toBe('가'.repeat(18));
    expect(truncateLabel('가'.repeat(19))).toBe(`${'가'.repeat(17)}…`);
    expect(truncateLabel('😀'.repeat(20))).toBe(`${'😀'.repeat(17)}…`);
    expect(truncateLabel('')).toBe('');
  });

  it('옵션: 가로 막대, 범례 없음, 마우스를 올리면 "N건 · 비율%"가 나온다', () => {
    const rows = choiceOutcome(1).rows;
    const options = choiceChartOptions(rows, false);
    expect(options.indexAxis).toBe('y');
    expect(options.plugins?.legend?.display).toBe(false);
    expect(options.animation).toBe(false);
    const x = options.scales?.x as { min: number; max: number; ticks: { callback: (v: number) => string } };
    expect([x.min, x.max]).toEqual([0, chartAxisMax(rows)]);
    expect(x.ticks.callback(40)).toBe('40%');
    const tooltip = options.plugins?.tooltip?.callbacks?.label as (c: { dataIndex: number }) => string;
    expect(tooltip({ dataIndex: 0 })).toBe('11건 · 28.2%');
    expect(tooltip({ dataIndex: 1 })).toBe('13건 · 33.4%');
  });

  it('옵션: 세로 눈금 글자는 길면 줄이고, 어두운 화면에서는 밝은 글자색이다', () => {
    const rows = choiceOutcome(1).rows;
    const light = choiceChartOptions(rows, false).scales?.y as { ticks: { color: string; callback: (this: Scale, v: number) => string } };
    const dark = choiceChartOptions(rows, true).scales?.y as { ticks: { color: string } };
    const fakeScale = { getLabelForValue: () => '가'.repeat(30) } as unknown as Scale;
    expect(light.ticks.callback.call(fakeScale, 0)).toBe(`${'가'.repeat(17)}…`);
    expect(light.ticks.color).not.toBe(dark.ticks.color);
  });

  it('막대 끝 글자 플러그인: 보기마다 "비율% (건수건)"을 막대 오른쪽에 적는다', () => {
    const rows = choiceOutcome(5).rows; // 기타 줄 포함
    const calls: [string, number, number][] = [];
    const fakeCtx = { save() {}, restore() {}, fillText: (t: string, x: number, y: number) => calls.push([t, x, y]), fillStyle: '', font: '', textBaseline: '' };
    const fakeChart = {
      ctx: fakeCtx,
      getDatasetMeta: () => ({ data: rows.map((_, i) => ({ getProps: () => ({ x: 100 + i * 10, y: 20 + i * 36 }) })) }),
    };
    const plugin = valueLabelPlugin(rows, false);
    (plugin.afterDatasetsDraw as (c: unknown, a: unknown, o: unknown) => void)(fakeChart, {}, {});
    expect(calls.map((c) => c[0])).toEqual(rows.map((r) => `${r.percent.toFixed(1)}% (${r.count}건)`));
    expect(calls.map((c) => c[0])).toContain('47.3% (18건)'); // 문항 5의 "3. 사내 공지"
    expect(calls[0].slice(1)).toEqual([106, 20]); // 막대 끝(x) + 6, 막대 가운데(y)
    expect(plugin.id).toBe('valueLabels');
  });
});
