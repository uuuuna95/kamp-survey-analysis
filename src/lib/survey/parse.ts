// Design Ref: §3 ① 읽기 — 문항 파일(parseQuestions)과 엑셀 원본(parseResponses)을 읽는다.
// Plan SC: SC-2 — 보기 번호는 "맨 왼쪽 아라비아 숫자"(예: "3. 보통이다"), 질문 끝 문구는 문항 유형 추정(작업 6)의 첫 번째 단서.
//
// 문항 파일 모양 (실제 KAMP 문항 파일):
//   - 문항 줄: 굵은 글씨로 "1. 질문" — 번호(1, 2…)가 엑셀 원본 열 제목 "문항번호1", "문항번호2"…의 숫자와 짝을 이룬다
//   - 보기 줄: 문항 줄 아래 굵지 않은 글씨로 한 줄에 보기 하나. 위에서부터 1, 2, 3…번 보기(원본의 응답 숫자)
//   - 주관식·서술형: 보기 줄 없이 바로 다음 굵은 글씨 문항 줄이 온다
// 굵은 글씨 문항 줄이 없는 파일은 예전 모양(A열 문항 번호, B열 질문, 그 아래 B열 "3. 보통이다")으로 읽는다.
//
// 엑셀 원본 모양:
//   - 첫 줄은 열 제목, 그 아래는 응답자 한 명당 한 줄
//   - A~G열: 참여일, 이름, 사번, 부서, 직급, 직위, 직책 — A열은 쓰지 않고, B~G열은 "참여자 정보"로 따로 보관한다
//     (분석에 반영할지는 사용자가 정한다. 기본은 반영하지 않는다)
//   - H열부터: 문항 열. 열 제목이 "문항번호1", "문항번호2"… (뒤의 숫자가 문항 번호)
//   - 객관식 응답은 보기 번호(중복응답은 "1,3"), 주관식·서술형은 글

import type { Column, ExcludedColumn, ParticipantColumn, ParticipantRole, Question, UnnumberedColumn } from './types';

export interface ParsedQuestions {
  questions: Question[];
  /** 읽지 못한 줄 같은 알림. 화면에서 담당자에게 보여 줄 수 있다 */
  warnings: string[];
  /** 문항 번호가 중복돼서 건너뛴 문항 줄 수. 많으면 문항 파일이 아닌 파일일 수 있다 */
  duplicateCount: number;
}

// 질문 끝에 이런 문구가 있으면 주관식·서술형으로 본다. 띄어쓰기는 무시하고 비교한다.
export const TEXT_CUES = [
  '입력해주세요',
  '입력해주십시오',
  '입력부탁드립니다',
  '작성해주세요',
  '작성해주십시오',
  '작성부탁드립니다',
];

/** 문항 번호 칸: "3", "Q3", "문항3", "3." 모두 3으로 읽는다 */
const QUESTION_NO_RE = /^\s*(?:Q|q|문항)?\s*(\d+)\s*[.)．:：]?\s*$/;
/** 보기 줄: 맨 왼쪽 아라비아 숫자 뒤에 점·괄호·공백이 와야 한다 ("10년 이상" 같은 글은 보기로 보지 않는다) */
const OPTION_RE = /^\s*(\d+)\s*(?:[.)．:：]|\s)\s*(\S.*)$/;

/** 엑셀 칸 값(글·숫자·서식 있는 글·수식)을 글로 바꾼다. 빈 칸은 '' */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString(); // 날짜 칸이 빈 칸으로 사라지지 않게 한다
  if (typeof value === 'object') {
    const v = value as {
      richText?: { text?: string }[];
      text?: unknown;
      result?: unknown;
    };
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text ?? '').join('');
    if (v.text !== undefined) return cellText(v.text);
    if (v.result !== undefined) return cellText(v.result);
  }
  return '';
}

/** 질문 끝이 "입력해주세요", "작성 부탁드립니다" 같은 문구인가 */
export function hasTextCue(title: string): boolean {
  const compact = title.replace(/\s+/g, '').replace(/[.!?。~:：)\]）］】」』"'”’]+$/, '');
  return TEXT_CUES.some((cue) => compact.endsWith(cue));
}

/** 굵은 글씨 문항 제목: "1. 질문", "12) 질문" (번호 뒤에 점·괄호가 오고 질문이 이어진다) */
const BOLD_TITLE_RE = /^\s*(?:Q|q|문항)?\s*(\d+)\s*[.)．]\s*(\S.*)$/;

/** 줄에서 첫 번째로 글이 있는 칸의 위치. 없으면 -1 */
function firstFilledCell(row: unknown[]): number {
  return row.findIndex((cell) => cellText(cell).trim() !== '');
}

/** 굵은 글씨 표시가 있고, 굵은 칸 중에 "1. 질문" 모양이 하나라도 있으면 굵은 글씨 모양의 문항 파일로 본다 */
function isBoldLayout(rows: unknown[][], bold: boolean[][] | undefined): bold is boolean[][] {
  if (!bold) return false;
  return rows.some((row, r) => {
    const c = firstFilledCell(row);
    return c >= 0 && bold[r]?.[c] === true && BOLD_TITLE_RE.test(cellText(row[c]).trim());
  });
}

/**
 * 굵은 글씨 모양의 문항 파일을 읽는다 (실제 KAMP 문항 파일 모양).
 *   - 문항 줄: 굵은 글씨로 "1. 질문" (번호 뒤의 글이 질문)
 *   - 보기 줄: 문항 줄 아래 굵지 않은 글씨로 한 줄에 보기 하나. 보기 번호는 위에서부터 1, 2, 3…
 *   - 주관식·서술형: 문항 줄 아래에 보기 없이 바로 다음 굵은 글씨 문항 줄이 온다
 */
function parseBoldQuestions(rows: unknown[][], bold: boolean[][]): ParsedQuestions {
  const questions: Question[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  let duplicateCount = 0;
  let current: Question | null = null;
  let skipping = false; // 중복 번호 문항의 보기 줄은 건너뛴다

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const c = firstFilledCell(row);
    if (c < 0) return;
    const text = cellText(row[c]).trim();

    if (bold[index]?.[c] === true) {
      const match = BOLD_TITLE_RE.exec(text);
      if (!match) {
        // 번호가 없는 굵은 글씨: 첫 문항 앞이면 머리글, 그 뒤면 알림
        if (current || skipping) warnings.push(`${rowNo}행: 굵은 글씨지만 "1. 질문" 모양이 아니라 읽지 못했어요 ("${text}").`);
        current = null;
        skipping = questions.length > 0;
        return;
      }
      const no = Number(match[1]);
      if (seen.has(no)) {
        warnings.push(`${rowNo}행: 문항 번호 ${no}이(가) 중복돼요. 먼저 나온 문항만 사용해요.`);
        duplicateCount++;
        current = null;
        skipping = true;
        return;
      }
      seen.add(no);
      skipping = false;
      current = { no, title: match[2].trim(), options: [], endsWithTextCue: false };
      questions.push(current);
      return;
    }

    if (!current) return; // 첫 문항 앞의 제목·안내 글, 또는 건너뛰는 문항의 보기 줄
    // 보기 줄: 위에서부터 1, 2, 3… 보기 앞에 같은 번호가 이미 적혀 있으면("3. 보통이다") 번호는 떼고 쓴다
    const optionNo = current.options.length + 1;
    const numbered = OPTION_RE.exec(text);
    const label = numbered && Number(numbered[1]) === optionNo ? numbered[2].trim() : text;
    current.options.push({ no: optionNo, label });
  });

  for (const q of questions) q.endsWithTextCue = hasTextCue(q.title);
  return { questions, warnings, duplicateCount };
}

/**
 * 문항 파일을 읽는다.
 * bold(칸마다 굵은 글씨인지)를 주고 굵은 글씨 "1. 질문" 줄이 있으면 굵은 글씨 모양(parseBoldQuestions)으로 읽고,
 * 아니면 예전 모양(A열 문항 번호, B열 질문, 그 아래 B열 "3. 보통이다")으로 읽는다.
 */
export function parseQuestions(rows: unknown[][], bold?: boolean[][]): ParsedQuestions {
  if (isBoldLayout(rows, bold)) return parseBoldQuestions(rows, bold);
  return parseNumberedQuestions(rows);
}

/** 예전 모양의 문항 파일: 줄은 [A열, B열, ...] 모양이다 */
function parseNumberedQuestions(rows: unknown[][]): ParsedQuestions {
  const questions: Question[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  let duplicateCount = 0;
  let current: Question | null = null;

  rows.forEach((row, index) => {
    const rowNo = index + 1;
    const a = cellText(row[0]).trim();
    const b = cellText(row[1]).trim();
    if (a === '' && b === '') return;

    const questionMatch = a !== '' ? QUESTION_NO_RE.exec(a) : null;
    if (questionMatch) {
      const no = Number(questionMatch[1]);
      if (seen.has(no)) {
        warnings.push(`${rowNo}행: 문항 번호 ${no}이(가) 중복돼요. 먼저 나온 문항만 사용해요.`);
        duplicateCount++;
        current = null;
        return;
      }
      if (b === '') warnings.push(`${rowNo}행: 문항 ${no}의 질문이 비어 있어요.`);
      seen.add(no);
      current = { no, title: b, options: [], endsWithTextCue: false };
      questions.push(current);
      return;
    }

    if (a !== '') {
      // A열에 문항 번호가 아닌 글: 첫 문항 앞이면 머리글로 보고 넘어간다
      if (current) warnings.push(`${rowNo}행: 읽지 못한 줄이에요 ("${a}").`);
      return;
    }

    // A열이 비어 있고 B열에만 글이 있는 줄
    if (!current) return; // 첫 문항 앞의 제목·머리글
    const optionMatch = OPTION_RE.exec(b);
    if (optionMatch) {
      current.options.push({ no: Number(optionMatch[1]), label: optionMatch[2].trim() });
    } else if (current.options.length === 0) {
      current.title = `${current.title} ${b}`.trim(); // 여러 줄로 적힌 질문
    } else {
      warnings.push(`${rowNo}행: 문항 ${current.no}의 보기로 읽지 못했어요 ("${b}").`);
    }
  });

  for (const q of questions) q.endsWithTextCue = hasTextCue(q.title);
  return { questions, warnings, duplicateCount };
}

export interface ParsedResponses {
  /** H열부터 열 제목이 "문항번호N"인 열 (파일에 나온 순서). N이 문항 번호와 짝짓는 기준 */
  columns: Column[];
  /** 참여자 정보 열 (B~G열: 이름·사번·부서·직급·직위·직책). 분석에 반영할지는 사용자가 정한다 */
  participants: ParticipantColumn[];
  /** H열부터인데 열 제목이 "문항번호N" 모양이 아니거나 중복이라 문항과 짝지을 수 없는 열 (응답도 보관) */
  unnumbered: UnnumberedColumn[];
  /** unnumbered 열을 "뺀 열 목록"에 이유와 함께 보여 주기 위한 표시 */
  excluded: ExcludedColumn[];
  /** 응답자 수 = 응답자 줄 수 (모두 무응답인 사람도 포함, 끝에 붙은 빈 줄은 제외) */
  respondents: number;
  /** 읽으면서 알게 된 점. 화면에서 담당자에게 보여 줄 수 있다 */
  warnings: string[];
}

const isBlankLine = (row: unknown[]): boolean => row.every((cell) => cellText(cell).trim() === '');

/** 엑셀 원본의 A~G열은 참여자 정보 칸이고, 문항은 H열(8번째 열)부터 시작한다 */
export const INFO_COLUMN_COUNT = 7;
/** A~G열의 제목 (A열 참여일은 쓰지 않는다) */
export const INFO_HEADERS = ['참여일', '이름', '사번', '부서', '직급', '직위', '직책'] as const;
/** B~G열이 가리키는 참여자 정보의 종류 */
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['name', 'id', 'department', 'rank', 'position', 'duty'];
/** 문항 열의 제목: "문항번호1", "문항번호 2" (뒤의 숫자가 문항 번호) */
export const QUESTION_COLUMN_RE = /^문항번호\s*(\d+)$/;

/** 줄(행) 목록에서 엑셀 원본을 읽는다. 첫 번째로 내용이 있는 줄을 열 제목 줄로 본다 */
export function parseResponses(rows: unknown[][]): ParsedResponses {
  const result: ParsedResponses = { columns: [], participants: [], unnumbered: [], excluded: [], respondents: 0, warnings: [] };
  const headerIndex = rows.findIndex((row) => !isBlankLine(row));
  if (headerIndex < 0) return result;

  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1);
  while (body.length > 0 && isBlankLine(body[body.length - 1])) body.pop(); // 끝에 붙은 빈 줄은 응답자가 아니다
  result.respondents = body.length;
  body.forEach((row, i) => {
    if (isBlankLine(row)) {
      result.warnings.push(`${headerIndex + 2 + i}행이 모두 비어 있어요. 응답자 1명(모두 무응답)으로 세요.`);
    }
  });

  const answersOf = (c: number): (string | null)[] =>
    body.map((row) => {
      const text = cellText(row[c]).trim();
      return text === '' ? null : text;
    });

  // A~G열: 위치로 읽는다. A열(참여일)은 쓰지 않고, B~G열은 참여자 정보로 따로 보관한다
  const differentHeaders: string[] = [];
  INFO_HEADERS.forEach((expected, c) => {
    const text = cellText(header[c]).trim();
    if (text !== expected) differentHeaders.push(`${String.fromCharCode(65 + c)}열 "${text === '' ? '(비어 있음)' : text}"`);
  });
  if (differentHeaders.length > 0 && (header.length > INFO_COLUMN_COUNT || differentHeaders.length < INFO_COLUMN_COUNT)) {
    result.warnings.push(
      `A~G열 제목이 "${INFO_HEADERS.join(', ')}"과(와) 달라요 (${differentHeaders.join(', ')}). 제목과 상관없이 A~G열은 참여자 정보 칸으로, H열부터는 문항으로 읽어요.`,
    );
  }
  PARTICIPANT_ROLES.forEach((role, i) => {
    const c = i + 1;
    result.participants.push({ role, header: cellText(header[c]).trim() || INFO_HEADERS[c], answers: answersOf(c) });
  });

  // H열부터: 열 제목이 "문항번호N"인 열이 문항 열
  const width = body.reduce((max, row) => Math.max(max, row.length), header.length);
  const seen = new Set<number>();
  for (let c = INFO_COLUMN_COUNT; c < width; c++) {
    const headerText = cellText(header[c]).trim();
    const answers = answersOf(c);
    if (headerText === '' && answers.every((a) => a === null)) continue; // 아무것도 없는 열

    const position = `${c + 1}번째 열`;
    const match = QUESTION_COLUMN_RE.exec(headerText);
    if (match) {
      const no = Number(match[1]);
      if (!seen.has(no)) {
        seen.add(no);
        result.columns.push({ no, answers });
        continue;
      }
      const label = `${headerText} (중복)`;
      result.warnings.push(`${position}의 제목 "${headerText}"이(가) 중복돼요. 이 열은 문항으로 쓰지 않고 뺀 열에 넣어요.`);
      result.unnumbered.push({ header: label, answers });
      result.excluded.push({ no: label, reason: 'header-not-number' });
      continue;
    }

    const label = headerText === '' ? `${position} (제목 없음)` : headerText;
    result.warnings.push(
      headerText === ''
        ? `${position}에 제목이 없어요. 문항으로 쓰지 않고 뺀 열에 넣어요.`
        : `${position}의 제목 "${headerText}"이(가) "문항번호1"처럼 "문항번호"+숫자 모양이 아니에요. 문항으로 쓰지 않고 뺀 열에 넣어요.`,
    );
    result.unnumbered.push({ header: label, answers });
    result.excluded.push({ no: label, reason: 'header-not-number' });
  }
  return result;
}

/** 칸이 굵은 글씨인가: 칸 전체가 굵거나, 서식 있는 글이면 글이 있는 부분이 모두 굵다 */
function isBoldCell(cell: { font?: { bold?: boolean }; value: unknown }): boolean {
  if (cell.font?.bold) return true;
  const value = cell.value as { richText?: { text?: string; font?: { bold?: boolean } }[] } | null;
  if (value && typeof value === 'object' && Array.isArray(value.richText)) {
    const parts = value.richText.filter((part) => (part.text ?? '').trim() !== '');
    return parts.length > 0 && parts.every((part) => part.font?.bold === true);
  }
  return false;
}

/** 첫 번째 시트의 줄 목록과, 칸마다 굵은 글씨인지를 함께 읽는다 */
export async function readFirstSheet(data: ArrayBuffer | Uint8Array): Promise<{ rows: unknown[][]; bold: boolean[][] }> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], bold: [] };
  const rows: unknown[][] = [];
  const bold: boolean[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: unknown[] = [];
    const flags: boolean[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = row.getCell(c);
      cells.push(cell.value);
      flags.push(isBoldCell(cell));
    }
    rows.push(cells);
    bold.push(flags);
  }
  return { rows, bold };
}

/** 엑셀(.xlsx) 파일의 첫 번째 시트를 줄 목록으로 읽는다. 브라우저·Node 모두 쓸 수 있다 */
export async function readFirstSheetRows(data: ArrayBuffer | Uint8Array): Promise<unknown[][]> {
  return (await readFirstSheet(data)).rows;
}
