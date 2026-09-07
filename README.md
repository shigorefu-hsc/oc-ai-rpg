# AIたいけん · AI RPG classroom lab

A one-hour Japanese classroom experience: solve the same lost-key mission with a fixed program, an AI chat assistant, and an agent that chooses tools and observes their actual results.

- Three modes, two map scenarios, editable instructions, memory and tool permissions.
- Step / run / stop / restart; a visible action log, predictions, reflections and experiment comparisons.
- Amazon Nova Lite and Claude Haiku 4.5 through Bedrock. Students can compare both within the teacher's budgets.
- Teacher login, one-hour student access, persistent experiment archives and exports.
- Regional API Gateway + streaming Lambda + Cognito + DynamoDB; external CNAME and ACM for HTTPS. No CloudFront or always-on server.
- Existing Function URL remains usable. Original desktop game and previous work data are preserved.

  npm ci
  npm run dev

Local preview: http://127.0.0.1:5173 — teacher / local-demo-only. Local AI is an explicitly labelled fixture; it never calls AWS.

    npm run check
    AWS_PROFILE=default AWS_REGION=ap-northeast-1 npm run deploy
    AWS_PROFILE=default npx tsx scripts/provision-teacher.ts
    AWS_PROFILE=default npx tsx scripts/configure-domain.ts

See [Architecture and pricing](docs/ARCHITECTURE.md), [Operations](docs/OPERATIONS.md), [DNS setup](docs/DNS.md), and the [Japanese lesson guide](docs/LESSON.md).

## Original desktop version

The Python source in source/ and the Windows scripts in installer/ are unchanged. The former NPC-editing API remains compatible with saved work, but the browser's main experience is now the experiment lab.
