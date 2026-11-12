// Design Ref: §5 지키는 것 — 요청 크기와 문항 수에 상한을 둔다. (공유 비밀번호와 함께 API 남용을 막는 PoC용 최소 보호)

/** 요청 본문 크기 상한: 1MB */
export const MAX_BODY_BYTES = 1_000_000;
/** 한 번에 해석을 요청할 수 있는 문항 수 */
export const MAX_QUESTIONS = 50;
/** 객관식 한 문항의 보기 줄 수 */
export const MAX_ROWS = 60;
/** 주관식·서술형 한 문항의 관점 수 */
export const MAX_VIEWS = 2000;
/** 글자 수 상한 */
export const MAX_TITLE_LENGTH = 500;
export const MAX_LABEL_LENGTH = 300;
export const MAX_VIEW_LENGTH = 1000;
/** AI를 동시에 부르는 개수 (한꺼번에 너무 많이 부르지 않도록) */
export const AI_CONCURRENCY = 4;
/** 한 문항 해석을 만들 때 시도하는 횟수 (처음 1번 + 다시 1번) */
export const AI_ATTEMPTS = 2;
