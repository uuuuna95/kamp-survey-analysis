// Design Ref: §5 서버 API — POST /api/interpret 의 요청·응답 모양과 AI 호출 약속(AiClient).
// 서버에서만 쓰는 코드다. 요청에는 집계된 숫자와 응답자 정보 열을 뺀 주관식 관점 글만 들어온다.

/** 객관식 문항: 보기별 집계 숫자만 보낸다 */
export interface ChoiceQuestionInput {
  no: number;
  type: 'choice';
  title: string;
  rows: { label: string; count: number; percent: number }[];
}

/** 주관식·서술형 문항: 나눈 관점 글만 보낸다 (응답자 순번은 보내지 않는다) */
export interface TextQuestionInput {
  no: number;
  type: 'text';
  title: string;
  views: { id: number; text: string }[];
}

export type QuestionInput = ChoiceQuestionInput | TextQuestionInput;

export interface InterpretRequest {
  questions: QuestionInput[];
}

/** 문항 하나의 AI 해석. 의견별 건수는 AI가 아니라 화면(브라우저)이 viewIds로 센다 */
export interface QuestionInterpretation {
  /** 객관식 해석 (2~3문장) */
  text?: string;
  /** 주관식·서술형 의견 (3~5개) */
  opinions?: { summary: string; viewIds: number[] }[];
}

export interface InterpretResponse {
  /** 문항 번호(글)별 해석. 보낼 데이터가 없는 문항은 빈 객체 */
  interpretations: Record<string, QuestionInterpretation>;
  /** AI 해석을 만들지 못한 문항 번호 (다시 시도 버튼용). 집계 결과는 그대로 보인다 */
  failed: number[];
}

export interface ErrorBody {
  error: { code: string; message: string };
}

/** AI를 부르는 약속. 실제 서비스(openai.ts)와 시험용 가짜가 같은 모양을 쓴다 */
export interface AiClient {
  complete(args: { system: string; prompt: string }): Promise<string>;
}
