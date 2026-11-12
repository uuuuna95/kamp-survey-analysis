// Design Ref: §4 — 앱이 쓰는 데이터 모양. 집계 규칙(lib/survey)과 화면이 함께 쓴다.
// Plan SC: 이후 작업 3~8(읽기·빼기·유형 추정·집계·관점 나누기)이 모두 이 모양을 주고받는다.
// 세는 기준(응답자 수, 무응답, 기타, 중복응답)은 DESIGN §3.3을 따른다.

/** 문항 유형: 객관식 | 주관식·서술형 (두 가지) */
export type QuestionType = 'choice' | 'text';

/** 문항 파일에서 읽은 문항 하나 */
export interface Question {
  /** 문항 번호 */
  no: number;
  /** 질문 */
  title: string;
  /** 보기. 번호는 문항 파일에서 각 보기 맨 왼쪽의 아라비아 숫자. 주관식·서술형이면 빈 배열 */
  options: { no: number; label: string }[];
  /** 질문 끝이 "입력해주세요", "작성 부탁드립니다" 같은 문구인가 */
  endsWithTextCue: boolean;
}

/** 참여자 정보 열의 종류: 엑셀 원본 B~G열 (A열 참여일은 쓰지 않는다) */
export type ParticipantRole = 'name' | 'id' | 'department' | 'rank' | 'position' | 'duty';

/** 참여자 정보 열 하나 (엑셀 원본 B~G열). 응답자 순서대로의 값이고, 빈 칸·공백만 있는 칸은 null */
export interface ParticipantColumn {
  role: ParticipantRole;
  /** 열 제목 (엑셀에 적힌 글. 비어 있으면 종류의 기본 이름) */
  header: string;
  answers: (string | null)[];
}

/** 엑셀 원본의 문항 열 하나 (H열부터, 열 제목이 "문항번호1", "문항번호2"…) */
export interface Column {
  /** 열 제목의 숫자 ("문항번호3"이면 3, 문항 번호와 짝짓는 기준) */
  no: number;
  /** 응답자 순서대로의 응답. 빈 칸·공백만 있는 칸은 null */
  answers: (string | null)[];
}

/**
 * 열 제목이 숫자가 아니라서(또는 중복이라서) 문항과 짝지을 수 없는 열.
 * 나중에 "문항으로 되돌리기"(Must 4)를 하려면 응답이 필요해서 함께 보관한다.
 */
export interface UnnumberedColumn {
  /** 열 제목 그대로 (제목이 없으면 "3번째 열 (제목 없음)"처럼 위치로 적는다) */
  header: string;
  /** 응답자 순서대로의 응답. 빈 칸·공백만 있는 칸은 null */
  answers: (string | null)[];
}

/** 분석에서 뺀 열 */
export interface ExcludedColumn {
  /** 열 제목 (숫자가 아니면 글 그대로) */
  no: number | string;
  reason: 'id-number' | 'department' | 'name' | 'not-in-questions' | 'header-not-number';
}

/** 객관식 문항의 집계 결과 */
export interface ChoiceResult {
  /** 보기별 한 줄. "기타"(직접 입력)는 있을 때만 optionNo가 'etc'인 줄로 들어간다 */
  rows: { optionNo: number | 'etc'; label: string; count: number; percent: number }[];
  /** 응답자 수 (무응답인 사람 포함) */
  respondents: number;
  /** 전체 선택 건수 (비율의 분모, 무응답 제외) */
  totalSelections: number;
  /** 중복응답 건수 (2개 이상 고른 응답자 수) */
  multiAnswerCount: number;
  /** 무응답 (빈 칸인 응답자 수) */
  noAnswer: number;
}

/** 주관식·서술형 문항의 정리 결과 */
export interface TextResult {
  /** 응답자 수 (무응답인 사람 포함) */
  respondents: number;
  /** 무응답 (빈 칸인 응답자 수) */
  noAnswer: number;
  /** 응답 목록 (원문) */
  answers: string[];
  /** 나눈 관점들. respondent는 응답자 순번이며 AI에는 보내지 않는다 */
  views: { id: number; text: string; respondent: number }[];
}

/** AI 해석 결과 */
export interface Interpretation {
  /** 객관식 해석 */
  text?: string;
  /** 주관식·서술형 의견. count는 viewIds의 서로 다른 응답자 수로 앱이 센다 */
  opinions?: { summary: string; viewIds: number[]; count: number }[];
}
