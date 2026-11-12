// Design Ref: §2 ② 한눈에 보기 "엑셀로 내려받기" — 파일 이름 정하기와, 만든 엑셀 내용을 브라우저에서 내려받게 하기.

import type { Analysis } from '../survey/analyze';
import type { Interpretation } from '../survey/types';
import { buildWorkbook } from './build-workbook';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 내려받는 파일 이름: "설문결과_2026-11-12.xlsx" (받는 사람의 날짜 기준) */
export function resultFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `설문결과_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xlsx`;
}

/** 엑셀 내용을 파일로 내려받게 한다 (브라우저에서만) */
export function saveBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 바로 지우면 일부 브라우저에서 내려받기가 끊긴다
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 지금 화면의 결과(바꾼 유형·되돌린 열 포함)와 AI 해석으로 엑셀을 만들어 내려받는다.
 * 차트 그림은 화면 차트와 같은 설정으로 만든다. 캔버스 부품은 필요할 때만 불러온다.
 */
export async function downloadResultWorkbook(
  analysis: Analysis,
  interpretations: Readonly<Record<number, Interpretation>>,
  now: Date = new Date(),
): Promise<string> {
  const { renderChoiceChartPng } = await import('./chart-image');
  const bytes = await buildWorkbook(analysis, { interpretations, renderChart: renderChoiceChartPng });
  const fileName = resultFileName(now);
  saveBytes(bytes, fileName);
  return fileName;
}
