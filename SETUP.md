# 나만의 결정 인박스 만들기

이 안내서는 elonfeedback을 **내 Vercel 계정에, 나만 사용하는 인스턴스로** 배포하는 방법입니다. 기존 사용자의 서비스나 데이터에는 연결하지 않습니다. 처음부터 새로 복제한 이 폴더에서 진행하세요.

설정 도구는 현재 폴더에 연결된 Vercel 프로젝트만 다룹니다. 실행 중 예상하지 못한 프로젝트 이름이나 팀 이름이 보이면 즉시 중단하고, 올바른 계정과 새 프로젝트인지 확인하세요.

## 먼저 준비할 것

- **Node.js 20 이상**: [Node.js 다운로드](https://nodejs.org/ko/download)에서 LTS 버전을 설치하세요.
- **Vercel 계정**: 계정이 없다면 [Vercel 가입](https://vercel.com/signup)에서 만드세요.
- **Vercel CLI**: 터미널에서 다음 명령으로 설치하고 로그인하세요.

  ```bash
  npm install -g vercel
  vercel login
  ```

- **OpenAI API 키**: [OpenAI API Keys](https://platform.openai.com/api-keys)에서 새 키를 만드세요. 음성 답변을 글로 바꾸는 데 사용됩니다. ChatGPT 구독과 API 결제는 별개이므로, OpenAI API 계정의 결제 설정도 확인하세요.

OpenAI 키, 로그인 PIN, `ELONFEEDBACK_TOKEN`은 비밀번호입니다. Git에 커밋하거나 메신저·문서·스크린샷에 공개하지 마세요.

## 가장 쉬운 방법: AI 도우미에게 부탁하기

이 폴더에서 Claude Code를 연 다음 아래 문장을 그대로 입력하세요.

> 이 폴더의 SETUP.md 보고 나만의 인스턴스로 배포해줘

도우미가 사전 점검부터 진행합니다. Vercel 로그인, Blob 저장소 연결, OpenAI API 키 입력처럼 본인 확인이나 비밀값이 필요한 단계에서는 화면의 안내를 직접 따라 주세요. 도우미에게도 비밀값을 채팅으로 보내지 말고, 설정 스크립트가 요청하는 터미널 입력란에만 붙여 넣으세요.

## 직접 설정하기

### 1. 이 폴더에서 준비하기

터미널을 열고 새로 복제한 elonfeedback 폴더로 이동한 뒤 패키지를 설치하세요.

```bash
npm install
node scripts/setup.mjs --check
```

`--check`는 아무것도 만들거나 배포하지 않습니다. Node.js, Vercel CLI, 로그인 상태와 현재 프로젝트 연결 상태를 확인하고, 실제 실행 시 할 일을 보여 줍니다. 오류가 나오면 출력된 해결 명령을 먼저 실행하세요.

### 2. 설정 도구 실행하기

```bash
node scripts/setup.mjs
```

설정 도구는 다음 일을 순서대로 처리합니다.

1. Vercel CLI 설치와 로그인 상태를 확인합니다. 로그인이 필요하면 안전하게 종료하며 `vercel login`을 안내합니다.
2. 현재 폴더를 내 Vercel 프로젝트에 연결합니다. 화면에 표시된 계정·팀·프로젝트 이름이 모두 내 것인지 확인하세요.
3. Vercel Blob 저장소와 `BLOB_READ_WRITE_TOKEN`이 이미 연결되어 있는지 확인합니다.
4. 앱과 로컬 CLI가 통신할 강한 토큰과 로그인 PIN을 만들고, OpenAI API 키를 입력받습니다.
5. 필요한 환경 변수를 Production, Preview, Development 환경에 설정합니다.
6. 내 Vercel 프로젝트를 Production으로 배포합니다.
7. 접속 주소와 로컬 CLI 설정을 `./.elonfeedback.env`에 저장하고 다음 단계의 명령을 출력합니다.

OpenAI 키는 다음 두 방법 중 하나로 전달할 수 있습니다.

- 권장: 스크립트가 요청할 때 터미널 입력란에 붙여 넣기
- 자동화 환경: 실행 전에 `OPENAI_API_KEY` 환경 변수로 전달하기

설정 도구의 진행 로그에서는 비밀값을 마스킹합니다. 완료 시에는 복사할 수 있도록 접속 주소, 토큰, PIN을 현재 제어 터미널에 한 번 정확히 보여 주며, 같은 내용을 아래의 개인 파일에도 저장합니다. 터미널 화면을 공유하거나 녹화 중이라면 먼저 중단하세요.

### 3. Blob 연결 안내가 나오면

Vercel의 Blob 저장소 연결 과정은 대화형입니다. 자동으로 안전하게 처리할 수 없으면 설정 도구는 프롬프트에 매달린 채 기다리지 않고 종료하며, 실행할 정확한 명령을 보여 줍니다. 안내된 명령은 다음과 같은 형태입니다.

```bash
vercel blob store add <표시된-저장소-이름>
```

명령을 직접 실행해 다음을 선택하세요.

- 방금 만든 **내 프로젝트**에 저장소 연결
- 환경 선택 질문에서 **Production, Preview, Development 모두 선택**

연결이 끝나면 설정 도구를 다시 실행하세요.

```bash
node scripts/setup.mjs
```

이미 완료된 단계는 감지해서 건너뛰므로, 다시 실행해도 저장소나 프로젝트를 중복 생성하지 않습니다.

### 4. 완료 후 로컬 설정 연결하기

배포가 끝나면 프로젝트 루트에 `.elonfeedback.env`가 생깁니다. 설정 도구는 다른 사용자가 읽지 못하도록 이 파일의 권한을 `0600`으로 지정합니다. 파일은 재실행이 다른 Vercel 프로젝트의 비밀값을 섞지 않도록 내부 프로젝트 식별 정보도 함께 보관하며, CLI에 복사할 중요한 값은 다음 세 줄입니다.

```dotenv
ELONFEEDBACK_URL=https://내-프로젝트.vercel.app
ELONFEEDBACK_TOKEN=생성된-긴-토큰
ELON_PIN=생성된-PIN
```

설정 도구가 마지막에 출력하는 위 세 줄을 개인 컴퓨터의 `~/.env`에 직접 추가하세요. 기존 `~/.env` 내용을 지우지 말고 필요한 줄만 추가하거나 교체하세요. 설정 도구는 사용자의 선택을 존중하기 위해 `~/.env`나 `~/.claude`를 자동으로 수정하지 않습니다.

로컬 CLI는 이 저장소의 `bin/elonfeedback`에 포함되어 있습니다. **저장소 루트에서** 다음 명령으로 설치한 뒤 연결 상태를 확인하세요.

```bash
npm install --global .
elonfeedback doctor
```

CLI 코드를 자주 수정하는 개발 환경에서는 전역 설치 대신 `npm link`를 사용할 수 있습니다.

```bash
npm link
elonfeedback doctor
```

두 설치 방법 모두 이 저장소의 `package.json`에 등록된 `bin/elonfeedback`을 사용합니다. 설정 도구는 사용자의 선택을 존중하기 위해 `~/.env`와 `~/.claude`를 수정하지 않으며, CLI 설치도 자동 실행하지 않습니다. `command not found`가 나오면 npm의 전역 실행 파일 폴더가 `PATH`에 포함되어 있는지 확인하세요.

## 이름과 화면 제목 바꾸기(선택)

기본 화면을 그대로 사용해도 됩니다. 소유자 이름과 앱 제목을 바꾸고 싶다면 Vercel 프로젝트의 환경 변수에 다음 값을 추가하고 Production, Preview, Development를 모두 선택한 뒤 다시 배포하세요.

```dotenv
NEXT_PUBLIC_OWNER_NAME=내 이름
NEXT_PUBLIC_APP_TITLE=내 결정 인박스
```

두 값은 선택 사항입니다. 설정하지 않으면 앱의 기본 이름과 제목을 사용합니다.

## 다시 실행하거나 문제가 생겼을 때

- `node scripts/setup.mjs --check`: 변경 없이 현재 상태와 다음 작업을 확인합니다.
- `node scripts/setup.mjs`: 중단된 단계부터 이어서 진행합니다. 이미 있는 프로젝트, Blob 연결, 환경 변수와 로컬 설정을 재사용합니다.
- Vercel 로그인이 풀렸다면 `vercel login` 후 다시 실행하세요.
- Blob 안내가 반복되면 Vercel 프로젝트 설정에서 `BLOB_READ_WRITE_TOKEN`이 세 환경 모두에 연결되었는지 확인하세요.
- 음성 변환이 실패하면 OpenAI API 키와 API 결제 상태를 확인하세요.
- Vercel Dashboard에서 `ELONFEEDBACK_TOKEN`이나 `ELON_PIN`을 직접 교체했다면 세 환경의 값을 모두 같은 값으로 바꾸고, 그 값을 명시해 한 번 재실행하세요. Vercel의 Sensitive 값은 설정 도구가 다시 읽어 비교할 수 없습니다.

  ```bash
  read -rsp '새 ELONFEEDBACK_TOKEN: ' ELONFEEDBACK_TOKEN; echo
  read -rsp '새 ELON_PIN: ' ELON_PIN; echo
  export ELONFEEDBACK_TOKEN ELON_PIN
  node scripts/setup.mjs
  unset ELONFEEDBACK_TOKEN ELON_PIN
  ```

`.elonfeedback.env`와 `~/.env`는 개인 비밀 파일입니다. 공유하거나 Git에 추가하지 마세요. PIN이나 토큰이 노출되었다면 Vercel 환경 변수에서 새 값으로 교체한 뒤 다시 배포하세요.
