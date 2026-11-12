// Design Ref: §3 ⑥ 엑셀 만들기 / §6 — 결과를 시트 3개(문항별 요약 / 객관식 결과 / 주관식·서술형 결과)가 있는 엑셀 파일로 만든다.
// Plan SC: SC-6 — 화면과 100% 같은 숫자. 화면을 그리는 Analysis(집계 결과)에서 그대로 옮겨 적고 다시 계산하지 않는다.
//          PRD Must 3 — 분석에서 뺀 열(사번·이름·부서 등)은 넣지 않는다. 사용자가 "문항으로 되돌린" 열만 문항으로 들어간다.
//
// ExcelJS는 엑셀 고유 차트를 만들 수 없어서, 차트는 그림(PNG)으로 넣는다(renderChart가 그림을 만들어 준다. 화면 차트와 같은 설정).
// 그림 만들기는 브라우저에서만 되므로 밖에서 받는다. 없으면(자동 테스트 등) 그림 없이 만든다.

import type { Buffer as ExcelBuffer } from 'exceljs';
import type { AnalyzedQuestion, Analysis } from '../survey/analyze';
import { chartHeight } from '../survey/chart-config';
import type { ChoiceResult, Interpretation } from '../survey/types';

export const SHEET_SUMMARY = '문항별 요약';
export const SHEET_CHOICE = '객관식 결과';
export const SHEET_TEXT = '주관식·서술형 결과';

/** 엑셀 안 차트 그림의 가로 크기(px). 세로는 보기 줄 수에 맞춘 chartHeight */
export const CHART_IMAGE_WIDTH = 640;

export interface BuildOptions {
  /** AI 해석 (문항 번호별). 해석이 없는 문항은 해석 줄을 넣지 않는다 */
  interpretations?: Readonly<Record<number, Interpretation>>;
  /** 객관식 집계 결과를 차트 그림(PNG 바이트)으로 만든다. null이면 그 문항은 그림 없이 */
  renderChart?: (result: ChoiceResult) => Promise<Uint8Array | null>;
}

const TYPE_LABEL = { choice: '객관식', text: '주관식·서술형' } as const;
const ROW_PX = 20; // 엑셀 기본 줄 높이(15pt)를 px로 본 값 — 차트 그림이 덮는 줄 수를 셀 때 쓴다

/** 화면 표의 합계 줄과 같은 비율 합계 (소수 첫째 자리) */
export function percentSum(result: ChoiceResult): number {
  return Math.round(result.rows.reduce((sum, row) => sum + row.percent * 10, 0)) / 10;
}

/** 카드의 요약 줄과 같은 글 */
export function summaryLine(outcome: AnalyzedQuestion['outcome']): string {
  if (outcome.type === 'choice') {
    const r = outcome.result;
    return `응답자 ${r.respondents}명 · 응답 ${r.totalSelections}건 · 중복응답 ${r.multiAnswerCount}건 · 무응답 ${r.noAnswer}명`;
  }
  const r = outcome.result;
  return `응답자 ${r.respondents}명 · 응답 ${r.answers.length}건 · 무응답 ${r.noAnswer}명`;
}

/** 객관식 표(보기 | 응답 수 | 비율(%) + 합계 줄)를 row줄부터 쓰고, 다음에 쓸 줄 번호를 돌려준다. 화면 표와 같은 숫자다 */
function writeChoiceTable(sheet: import('exceljs').Worksheet, start: number, result: ChoiceResult): number {
  let row = start;
  ['보기', '응답 수', '비율(%)'].forEach((header, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.border = { bottom: { style: 'thin' } };
  });
  row++;
  for (const r of result.rows) {
    sheet.getCell(row, 1).value = r.label;
    sheet.getCell(row, 2).value = r.count;
    sheet.getCell(row, 3).value = r.percent;
    sheet.getCell(row, 3).numFmt = '0.0';
    row++;
  }
  const total: (string | number)[] = ['합계', result.totalSelections, percentSum(result)];
  total.forEach((value, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = value;
    cell.font = { bold: true };
    cell.border = { top: { style: 'thin' } };
    if (i === 2) cell.numFmt = '0.0';
  });
  return row + 1;
}

const title = (item: AnalyzedQuestion) => `Q${item.question.no}. ${item.question.title}`;

/** 분석 결과를 엑셀(.xlsx) 파일 내용으로 만든다 */
export async function buildWorkbook(analysis: Analysis, options: BuildOptions = {}): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KAMP 설문조사 결과 분석';
  workbook.created = new Date();
  const interpretations = options.interpretations ?? {};

  // ---------- 시트 1: 문항별 요약 ----------
  const summary = workbook.addWorksheet(SHEET_SUMMARY);
  summary.columns = [
    { header: '문항', key: 'no', width: 8 },
    { header: '질문', key: 'title', width: 60 },
    { header: '유형', key: 'type', width: 14 },
    { header: '응답자 수', key: 'respondents', width: 12 },
    { header: '응답 건수', key: 'answers', width: 12 },
    { header: '중복응답 건수', key: 'multi', width: 14 },
    { header: '무응답 수', key: 'noAnswer', width: 12 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: 'frozen', ySplit: 1 }];
  for (const item of analysis.questions) {
    const { outcome } = item;
    summary.addRow({
      no: item.question.no,
      title: item.question.title,
      type: TYPE_LABEL[outcome.type],
      respondents: outcome.result.respondents,
      answers: outcome.type === 'choice' ? outcome.result.totalSelections : outcome.result.answers.length,
      multi: outcome.type === 'choice' ? outcome.result.multiAnswerCount : null, // 객관식만 센다
      noAnswer: outcome.result.noAnswer,
    });
  }
  summary.getColumn('title').alignment = { wrapText: true, vertical: 'top' };
  summary.addRow([]);
  summary.addRow([`응답자 ${analysis.respondents}명 · 문항 ${analysis.questions.length}개`]);
  if (analysis.restorable.length > 0) {
    summary.addRow([`분석에서 뺀 열 ${analysis.restorable.length}개는 파일에 넣지 않았어요.`]);
  }

  // ---------- 시트 2: 객관식 결과 ----------
  const choiceSheet = workbook.addWorksheet(SHEET_CHOICE);
  choiceSheet.columns = [{ width: 40 }, { width: 12 }, { width: 12 }, { width: 3 }, { width: 12 }];
  const choiceItems = analysis.questions.filter((q) => q.outcome.type === 'choice');
  if (choiceItems.length === 0) choiceSheet.addRow(['객관식 문항이 없어요.']);

  let row = 1; // 다음에 쓸 줄
  for (const item of choiceItems) {
    if (item.outcome.type !== 'choice') continue;
    const result = item.outcome.result;
    const start = row;

    choiceSheet.getCell(row, 1).value = title(item);
    choiceSheet.getCell(row, 1).font = { bold: true, size: 12 };
    row++;
    choiceSheet.getCell(row, 1).value = summaryLine(item.outcome);
    row++;

    if (result.totalSelections === 0) {
      choiceSheet.getCell(row, 1).value = '응답한 사람이 없어서 보여 줄 결과가 없어요.';
      row++;
    } else {
      row = writeChoiceTable(choiceSheet, row, result);
    }

    const text = interpretations[item.question.no]?.text;
    if (text) {
      choiceSheet.mergeCells(row, 1, row, 3);
      const cell = choiceSheet.getCell(row, 1);
      cell.value = `AI 해석: ${text}`;
      cell.alignment = { wrapText: true, vertical: 'top' };
      choiceSheet.getRow(row).height = Math.max(1, Math.ceil(text.length / 30)) * 15;
      row++;
    }

    // 차트 그림: 표 오른쪽에 놓고, 그림이 덮는 줄만큼 다음 문항을 아래로 민다
    const image = result.totalSelections > 0 && options.renderChart ? await options.renderChart(result) : null;
    if (image) {
      const height = chartHeight(result.rows.length);
      const imageId = workbook.addImage({ buffer: image as unknown as ExcelBuffer, extension: 'png' });
      choiceSheet.addImage(imageId, { tl: { col: 4, row: start - 1 }, ext: { width: CHART_IMAGE_WIDTH, height } });
      row = Math.max(row, start + Math.ceil(height / ROW_PX) + 1);
    }
    // 집단별 결과 (부서·직급을 골랐을 때만): 그림 아래에 집단마다 같은 모양의 표를 쓴다
    for (const grouped of item.outcome.groups ?? []) {
      row++;
      choiceSheet.getCell(row, 1).value = `${grouped.label}별 결과`;
      choiceSheet.getCell(row, 1).font = { bold: true };
      row++;
      for (const g of grouped.groups) {
        choiceSheet.getCell(row, 1).value = `${grouped.label}: ${g.name} (응답자 ${g.result.respondents}명 · 응답 ${g.result.totalSelections}건)`;
        choiceSheet.getCell(row, 1).font = { italic: true };
        row++;
        row = writeChoiceTable(choiceSheet, row, g.result) + 1;
      }
    }
    row++; // 문항 사이 빈 줄
  }

  // ---------- 시트 3: 주관식·서술형 결과 ----------
  const textSheet = workbook.addWorksheet(SHEET_TEXT);
  textSheet.columns = [{ width: 10 }, { width: 80 }, { width: 14 }];
  textSheet.addRow(['응답 원문이 그대로 들어 있어요. 이름 같은 개인정보가 있는지 공유 전에 확인하세요.']);
  textSheet.getRow(1).font = { color: { argb: 'FF92400E' } };
  const textItems = analysis.questions.filter((q) => q.outcome.type === 'text');
  if (textItems.length === 0) textSheet.addRow(['주관식·서술형 문항이 없어요.']);
  for (const item of textItems) {
    if (item.outcome.type !== 'text') continue;
    const result = item.outcome.result;
    textSheet.addRow([]);
    textSheet.addRow([title(item)]).font = { bold: true, size: 12 };
    textSheet.addRow([summaryLine(item.outcome)]);

    const opinions = interpretations[item.question.no]?.opinions;
    if (opinions && opinions.length > 0) {
      textSheet.addRow(['주요 의견', '요약 (AI 정리)', '응답자 수']).font = { bold: true };
      opinions.forEach((o, i) => {
        const r = textSheet.addRow([`의견 ${i + 1}`, o.summary, o.count]);
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      });
      textSheet.addRow(['', '건수는 그 의견을 말한 서로 다른 응답자 수예요.']);
    }

    if (result.answers.length === 0) {
      textSheet.addRow(['응답한 사람이 없어서 보여 줄 응답이 없어요.']);
      continue;
    }
    textSheet.addRow(['번호', `응답 목록 (${result.answers.length}건)`]).font = { bold: true };
    result.answers.forEach((answer, i) => {
      const r = textSheet.addRow([i + 1, answer]);
      r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
