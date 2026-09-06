# ことばの街 · AI RPG

A classroom RPG where students describe characters in chat and immediately test their personalities, conversations and movement in a browser.

## Browser demo

- React + TypeScript + Phaser; Japanese classroom interface.
- Teacher login, one-hour student handover, persistent works and dialogue history.
- Amazon Nova Lite / Claude Haiku 4.5 selected by the teacher through Amazon Bedrock.
- Lambda Function URL + Cognito + DynamoDB + private S3. No CloudFront.
- Per-work undo, NPC memory, model usage accounting and shared AI budget.

  npm ci
  npm run dev

Local preview: http://127.0.0.1:5173, teacher / local-demo-only. Local AI is a labelled fixture and does not call AWS.

    npm run check
    AWS_PROFILE=default AWS_REGION=ap-northeast-1 npm run deploy
    AWS_PROFILE=default npx tsx scripts/provision-teacher.ts

See [Architecture and pricing](docs/ARCHITECTURE.md) and [Operations](docs/OPERATIONS.md) for AWS setup, student access, quotas, retained data and limits.

## Original desktop version

The Python game is preserved:

- source/: original Python source, editable JSON, music and requirements.
- installer/: Windows EXE build scripts.

One-click Windows build: installer\build_exe_one_click.bat. If Python is missing, it installs Python through winget. Output: installer\dist\oc_ai_rpg.exe with editable JSON files alongside the executable.
