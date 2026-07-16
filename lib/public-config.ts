const DEFAULT_OWNER_NAME = "나";
const DEFAULT_APP_TITLE = "결정 인박스";

function publicValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

export const OWNER_NAME = publicValue(
  process.env.NEXT_PUBLIC_OWNER_NAME,
  DEFAULT_OWNER_NAME,
);

export const APP_TITLE = publicValue(
  process.env.NEXT_PUBLIC_APP_TITLE,
  DEFAULT_APP_TITLE,
);

// Preserve the existing Korean/English brand labels for the default title while
// allowing a custom title to flow through every visible brand position.
export const APP_SHORT_BRAND =
  APP_TITLE === DEFAULT_APP_TITLE ? "결정함" : APP_TITLE;

export const DASHBOARD_BRAND =
  APP_TITLE === DEFAULT_APP_TITLE ? "Decision inbox" : APP_TITLE;

export const OWNER_COMPUTER_LABEL =
  OWNER_NAME === DEFAULT_OWNER_NAME ? "내 컴퓨터" : `${OWNER_NAME}님 컴퓨터`;

export const OWNER_UNLOCK_GREETING =
  OWNER_NAME === DEFAULT_OWNER_NAME
    ? "내 공간인지 확인할게요."
    : `${OWNER_NAME}님, 확인할게요.`;
