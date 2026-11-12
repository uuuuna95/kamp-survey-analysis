// Design Ref: §2 ① 파일 올리기, §8 오류 처리 — 올린 두 파일을 읽고, 모양이 틀리면 이유를 알려 준다.
// Plan SC: 작업 10 — 문항 파일을 못 읽으면(문항 0개) 분석 시작을 막는다. (작업 5에서 "문항 0개면 모든 열이 빠지는" 문제를 여기서 막는다)
//
// 브라우저에서 호출한다. 파일은 서버로 보내지 않는다.

import { parseQuestions, parseResponses, readFirstSheet, readFirstSheetRows } from './parse';
import type { ParsedResponses } from './parse';
import type { Question } from './types';

/** 두 파일을 읽은 결과 */
export interface LoadedSurvey {
  questions: Question[];
  responses: ParsedResponses;
  /** 오류는 아니지만 담당자가 알아 두면 좋은 점 (짝이 없는 문항·열, 읽지 못한 줄 등) */
  notes: string[];
}

export type LoadResult = { ok: true; survey: LoadedSurvey } | { ok: false; errors: string[] };

type Data = ArrayBuffer | Uint8Array;

/** 파일 이름만 보고 올릴 수 없는 파일이면 안내 문구를, 괜찮으면 null을 돌려준다 */
export function checkFileName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith('.xlsx')) return null;
  if (lower.endsWith('.hwp') || lower.endsWith('.hwpx')) {
    return '한글 파일은 바로 읽을 수 없어요. 엑셀(.xlsx)로 옮겨서 올려 주세요.';
  }
  if (lower.endsWith('.xls')) return '예전 엑셀 형식(.xls)은 읽을 수 없어요. .xlsx로 저장해서 올려 주세요.';
  return '엑셀(.xlsx) 파일만 올릴 수 있어요.';
}

/** 문항 번호 목록을 "3, 5, 7번"처럼 적는다. 많으면 앞의 몇 개만 적고 나머지는 개수로 줄인다 */
function listNos(nos: number[]): string {
  const shown = nos.slice(0, 10).join(', ');
  return nos.length > 10 ? `${shown} 외 ${nos.length - 10}개` : `${shown}번`;
}

/** 같은 문항 번호가 이만큼 이상 중복되면 문항 파일이 아닌 파일(엑셀 원본 등)로 본다 */
const SUSPICIOUS_DUPLICATE_COUNT = 3;
/** 알림이 이보다 많으면 앞의 몇 개만 보여 주고 나머지는 개수로 줄인다 */
const MAX_NOTES_PER_SOURCE = 5;

/** 읽다가 생긴 알림이 많을 때 앞의 몇 개만 적고 나머지는 개수로 줄인다 */
function limitNotes(source: string, warnings: string[]): string[] {
  const shown = warnings.slice(0, MAX_NOTES_PER_SOURCE).map((w) => `${source} ${w}`);
  if (warnings.length > MAX_NOTES_PER_SOURCE) {
    shown.push(`${source}에서 알림이 ${warnings.length - MAX_NOTES_PER_SOURCE}건 더 있어요.`);
  }
  return shown;
}

const READ_FAILED = (label: string) =>
  `${label}을(를) 읽을 수 없어요. 엑셀(.xlsx) 파일이 맞는지, 파일이 손상되지 않았는지 확인해 주세요.`;

/**
 * 엑셀 원본과 설문 문항 파일을 읽고 확인한다.
 * 읽을 수 없거나 모양이 틀리면 { ok: false, errors }로 이유를 돌려주고, 읽을 수 있으면 알림(notes)과 함께 돌려준다.
 */
export async function loadSurvey(rawData: Data, questionData: Data): Promise<LoadResult> {
  const errors: string[] = [];

  let questionSheet: { rows: unknown[][]; bold: boolean[][] } = { rows: [], bold: [] };
  let rawRows: unknown[][] = [];
  try {
    questionSheet = await readFirstSheet(questionData);
  } catch {
    errors.push(READ_FAILED('설문 문항 파일'));
  }
  try {
    rawRows = await readFirstSheetRows(rawData);
  } catch {
    errors.push(READ_FAILED('엑셀 원본'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const parsedQuestions = parseQuestions(questionSheet.rows, questionSheet.bold);
  const responses = parseResponses(rawRows);
  const { questions } = parsedQuestions;

  if (questions.length === 0) {
    errors.push(
      '설문 문항 파일에서 문항 번호와 질문을 찾지 못했어요. 문항 제목이 굵은 글씨로 "1. 질문"처럼 적혀 있고, 그 아래 줄마다 보기가 하나씩 이어지는 파일이 맞는지 확인해 주세요.',
    );
  }
  if (responses.respondents === 0 || responses.columns.length === 0) {
    errors.push(
      '엑셀 원본에서 응답을 찾지 못했어요. 첫 줄이 열 제목이고, A~G열은 참여일·이름·사번·부서·직급·직위·직책, H열부터는 "문항번호1", "문항번호2"… 열이 이어지며, 그 아래에 응답자 한 명당 한 줄이 있는 파일이 맞는지 확인해 주세요.',
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  // 두 파일을 서로 바꿔 올린 경우를 막는다: 문항 칸에 응답 파일이 들어오면 같은 번호가 줄줄이 중복되고,
  // 원본 칸에 문항 파일이 들어오면 H열부터의 열 제목이 "문항번호N" 모양이 아닌 글이 된다
  const questionFileLooksWrong = parsedQuestions.duplicateCount >= SUSPICIOUS_DUPLICATE_COUNT;
  const rawFileLooksWrong = responses.unnumbered.length > 0 && responses.unnumbered.length >= responses.columns.length;
  if (questionFileLooksWrong && rawFileLooksWrong) {
    return {
      ok: false,
      errors: ['두 파일이 서로 바뀐 것 같아요. “엑셀 원본” 칸에는 응답이 담긴 파일을, “설문 문항 파일” 칸에는 문항과 보기가 적힌 파일을 올려 주세요.'],
    };
  }
  if (questionFileLooksWrong) {
    return {
      ok: false,
      errors: ['설문 문항 파일에 같은 문항 번호가 여러 번 나와요. 엑셀 원본을 문항 파일 칸에 올리지 않았는지 확인해 주세요.'],
    };
  }
  if (rawFileLooksWrong) {
    return {
      ok: false,
      errors: ['엑셀 원본의 H열부터 열 제목이 "문항번호1", "문항번호2"…로 되어 있지 않아요. 문항 파일을 엑셀 원본 칸에 올리지 않았는지 확인해 주세요.'],
    };
  }

  const questionNos = new Set(questions.map((q) => q.no));
  const columnNos = new Set(responses.columns.map((c) => c.no));
  const matched = [...columnNos].filter((no) => questionNos.has(no));
  if (matched.length === 0) {
    return {
      ok: false,
      errors: ['두 파일의 문항 번호가 하나도 맞지 않아요. 같은 설문의 엑셀 원본과 문항 파일인지, 서로 바꿔 올리지 않았는지 확인해 주세요.'],
    };
  }

  const notes: string[] = [];
  const missingInRaw = questions.map((q) => q.no).filter((no) => !columnNos.has(no));
  if (missingInRaw.length > 0) {
    notes.push(`문항 파일에는 있지만 엑셀 원본에는 없는 문항: ${listNos(missingInRaw)}. 이 문항은 분석하지 않아요.`);
  }
  const missingInQuestions = [...columnNos].filter((no) => !questionNos.has(no));
  if (missingInQuestions.length > 0) {
    notes.push(`엑셀 원본에는 있지만 문항 파일에는 없는 열: ${listNos(missingInQuestions)}. 분석에서 빼요.`);
  }
  notes.push(...limitNotes('문항 파일', parsedQuestions.warnings));
  notes.push(...limitNotes('엑셀 원본', responses.warnings));

  return { ok: true, survey: { questions, responses, notes } };
}
